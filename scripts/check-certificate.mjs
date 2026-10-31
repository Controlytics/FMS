// check-certificate.mjs - checks an HTTPS certificate + key BEFORE the FMS server
// is switched to them (set-certificate.ps1, Start menu "Change SSL certificate").
// Runs on the FMS's own node.exe; no packages.
//
//   node check-certificate.mjs check --cert <file> [--key <file>] [--root-ca <file>]
//        [--extra-roots <file>] [--names a,b,c] [--allow-unmatched-names]
//        [--current <cert file>] [--out <dir>] [--warn-days 30]
//     Prints ONE line of JSON (see `result` below). Exit 0 = usable, 2 = refused
//     (errors[] says why), 1 = the checker itself failed.
//     A password-protected key is opened with DIGILOG_KEY_PASSPHRASE (never an
//     argument, so it is not visible in the process list).
//     --out writes server.key (unencrypted PKCS#8), server.crt (the certificate,
//     then its intermediates, in order) and root-ca.pem (the root the tablets
//     must trust).
//
//   node check-certificate.mjs served --port 3000
//     Prints the certificate the server on 127.0.0.1:<port> is serving right now.
//
// What "usable" means, and why each rule exists:
//   - the key belongs to the certificate (a mismatch stops the API from starting);
//   - it is a server certificate, not a CA, valid today, made for servers (EKU);
//   - the file holds every INTERMEDIATE between it and the root. Android does not
//     fetch missing intermediates, so a chain that works in a Windows browser
//     (which does) is refused by every tablet;
//   - the chain ends at a root this PC trusts, or the root given with --root-ca;
//   - it names at least one address the server is reached by (--names), unless
//     --allow-unmatched-names: a certificate for another name is refused by every
//     browser and tablet;
//   - Node itself can load the pair (the same call the API makes at boot).
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { X509Certificate, createPrivateKey } from 'node:crypto';

const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';
const ANY_EKU = '2.5.29.37.0';

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { out._.push(a); continue; }
    const k = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[k] = true;
    else { out[k] = next; i++; }
  }
  return out;
}

// ---- reading files ----------------------------------------------------------
const PEM_CERT = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
const PEM_KEY = /-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----[\s\S]+?-----END \1-----/;

function readCerts(file) {
  const buf = fs.readFileSync(file);
  const text = buf.toString('latin1');
  const blocks = text.match(PEM_CERT);
  if (blocks) return blocks.map((b) => new X509Certificate(b));
  return [new X509Certificate(buf)]; // DER (.cer)
}

function readKey(file) {
  const buf = fs.readFileSync(file);
  const text = buf.toString('latin1');
  const m = text.match(PEM_KEY);
  const passphrase = process.env.DIGILOG_KEY_PASSPHRASE || undefined;
  if (m) {
    const encrypted = m[1] === 'ENCRYPTED PRIVATE KEY' || /Proc-Type:\s*4,ENCRYPTED/.test(m[0]);
    if (encrypted && !passphrase) return { encrypted: true };
    return { key: createPrivateKey({ key: m[0], format: 'pem', passphrase }), encrypted };
  }
  for (const type of ['pkcs8', 'pkcs1', 'sec1']) {
    try { return { key: createPrivateKey({ key: buf, format: 'der', type }), encrypted: false }; } catch { /* next */ }
  }
  return { none: true };
}

// ---- certificate facts ------------------------------------------------------
const oneLine = (dn) => (dn || '').split('\n').filter(Boolean).join(', ');
const isSelfSigned = (c) => c.checkIssued(c) && safeVerify(c, c);
function safeVerify(child, issuer) { try { return child.verify(issuer.publicKey); } catch { return false; } }
const issuedBy = (child, issuer) => child.checkIssued(issuer) && safeVerify(child, issuer);

// Same reading as apps/api/src/lib/server-id.ts (the tablet's server identity =
// the served certificate's authorityKeyIdentifier). Kept in step by
// apps/api/src/lib/__tests__/check-certificate-script.test.ts.
const AKI_OID = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x23]);
function derLength(buf, at) {
  const first = buf[at];
  if (first < 0x80) return [first, at + 1];
  const n = first & 0x7f;
  if (n === 0 || n > 4) throw new Error('unsupported DER length');
  let len = 0;
  for (let i = 1; i <= n; i++) len = len * 256 + buf[at + i];
  return [len, at + 1 + n];
}
export function authorityKeyIdFromDer(der) {
  const at = der.indexOf(AKI_OID);
  if (at < 0) return null;
  let p = at + AKI_OID.length;
  if (der[p] === 0x01) p += 3;
  if (der[p] !== 0x04) return null;
  [, p] = derLength(der, p + 1);
  if (der[p] !== 0x30) return null;
  [, p] = derLength(der, p + 1);
  if (der[p] !== 0x80) return null;
  const [len, start] = derLength(der, p + 1);
  if (len === 0 || start + len > der.length) return null;
  return der.subarray(start, start + len).toString('hex');
}

function sans(cert) {
  const raw = cert.subjectAltName || '';
  const out = [];
  for (const part of raw.split(/,\s*/)) {
    const m = /^(DNS|IP Address):(.+)$/.exec(part.trim());
    if (m) out.push({ type: m[1] === 'DNS' ? 'dns' : 'ip', value: m[2].trim().toLowerCase() });
  }
  return out;
}
function normIp(ip) {
  return ip.includes(':') ? ip.toLowerCase().replace(/(^|:)0+(?=[0-9a-f])/g, '$1') : ip.split('.').map(Number).join('.');
}
function nameMatches(san, name) {
  const n = name.toLowerCase();
  const isIp = /^[\d.]+$/.test(n) || n.includes(':');
  if (san.type === 'ip') return isIp && normIp(san.value) === normIp(n);
  if (isIp) return false;
  if (san.value.startsWith('*.')) {
    const rest = san.value.slice(2);
    const dot = n.indexOf('.');
    return dot > 0 && n.slice(dot + 1) === rest;
  }
  return san.value === n;
}

function describe(cert) {
  return {
    subject: oneLine(cert.subject),
    issuer: oneLine(cert.issuer),
    validFrom: new Date(cert.validFrom).toISOString(),
    validTo: new Date(cert.validTo).toISOString(),
    fingerprint256: cert.fingerprint256,
  };
}

// Root candidates: self-signed only. The Windows store as Node reads it also
// holds intermediates and stray leaf certificates (18 of 94 on the dev PC,
// 2026-10-31); an intermediate found there is still MISSING from the file.
function rootSources(opts) {
  const sources = [];
  const add = (pems, source) => {
    for (const p of pems) {
      try { sources.push({ cert: new X509Certificate(p), source }); } catch { /* unreadable entry */ }
    }
  };
  if (opts.rootCa) add(readCerts(opts.rootCa).map((c) => c.toString()), 'given');
  if (opts.extraRoots) add(readCerts(opts.extraRoots).map((c) => c.toString()), 'extra');
  try { add(tls.getCACertificates('system'), 'windows'); } catch { /* older Node */ }
  add(tls.rootCertificates, 'public');
  return sources;
}

/** Walks leaf -> intermediates (from the file) -> root. */
function buildChain(leaf, fileCerts, sources) {
  const chain = [];
  const used = new Set([leaf.fingerprint256]);
  let current = leaf;
  for (let depth = 0; depth < 10; depth++) {
    if (isSelfSigned(current)) {
      return { chain, root: current, rootSource: current === leaf ? 'leaf' : 'file' };
    }
    const next = fileCerts.find((c) => !used.has(c.fingerprint256) && issuedBy(current, c));
    if (next) {
      chain.push(next);
      used.add(next.fingerprint256);
      current = next;
      continue;
    }
    const found = sources.find((s) => issuedBy(current, s.cert));
    if (found && isSelfSigned(found.cert)) return { chain, root: found.cert, rootSource: found.source };
    return { chain, root: null, missingIssuer: oneLine(current.issuer), missingIsIntermediate: !!found };
  }
  return { chain, root: null, missingIssuer: oneLine(current.issuer), tooDeep: true };
}

function check(opts) {
  const errors = [];
  const warnings = [];
  const err = (code, message) => errors.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });
  const result = { ok: false, errors, warnings, leaf: null, chain: [], root: null, serverId: null, current: null,
    namesMatched: [], rootChanged: null, serverIdChanged: null };

  let certs;
  try { certs = readCerts(opts.cert); } catch (e) { err('CERT_UNREADABLE', `The certificate file could not be read as a certificate (${e.message}).`); return result; }
  const keyFile = opts.key || opts.cert;
  let keyRes;
  try { keyRes = readKey(keyFile); } catch (e) {
    const wrongPass = /bad decrypt|passphrase|interrupted/i.test(String(e.message));
    err(wrongPass ? 'KEY_PASSWORD_WRONG' : 'KEY_UNREADABLE', wrongPass ? 'The password for the private key is wrong.' : `The private key could not be read (${e.message}).`);
    return result;
  }
  if (keyRes.none) { err('KEY_MISSING', opts.key ? 'The key file holds no private key.' : 'No private key given (and none inside the certificate file).'); return result; }
  if (keyRes.encrypted && !keyRes.key) { err('KEY_ENCRYPTED', 'The private key is protected by a password.'); return result; }
  const key = keyRes.key;

  const leaf = certs.find((c) => { try { return c.checkPrivateKey(key); } catch { return false; } });
  if (!leaf) {
    err('KEY_MISMATCH', 'The private key does not belong to this certificate (or to any certificate in the file). Ask IT for the matching pair.');
    return result;
  }
  result.leaf = { ...describe(leaf), sans: sans(leaf).map((s) => s.value) };
  const now = Date.now();
  const from = new Date(leaf.validFrom).getTime();
  const to = new Date(leaf.validTo).getTime();
  result.leaf.daysLeft = Math.floor((to - now) / 86400000);
  if (leaf.ca) err('LEAF_IS_CA', 'This is a certificate AUTHORITY (CA) certificate, not a server certificate. Use the server certificate IT issued for this PC.');
  if (now < from) err('NOT_YET_VALID', `The certificate only becomes valid on ${result.leaf.validFrom}.`);
  if (now > to) err('EXPIRED', `The certificate EXPIRED on ${result.leaf.validTo}.`);
  else if (result.leaf.daysLeft < Number(opts['warn-days'] ?? 30)) warn('EXPIRES_SOON', `The certificate expires in ${result.leaf.daysLeft} day(s), on ${result.leaf.validTo}.`);
  const eku = leaf.keyUsage;
  if (Array.isArray(eku) && eku.length && !eku.includes(SERVER_AUTH) && !eku.includes(ANY_EKU)) {
    err('NOT_FOR_SERVERS', 'The certificate is not made for web servers (no "Server Authentication" use). Ask IT for a server certificate.');
  }
  const pub = leaf.publicKey;
  if (pub.asymmetricKeyType === 'rsa' && pub.asymmetricKeyDetails?.modulusLength < 2048) {
    err('KEY_TOO_SMALL', `The RSA key is ${pub.asymmetricKeyDetails.modulusLength} bits; tablets and browsers need at least 2048.`);
  }

  const leafSans = sans(leaf);
  if (!leafSans.length) err('NO_NAMES', 'The certificate names no address (no Subject Alternative Name). Browsers and tablets refuse it.');
  const names = String(opts.names || '').split(',').map((s) => s.trim()).filter(Boolean);
  result.namesMatched = names.filter((n) => leafSans.some((s) => nameMatches(s, n)));
  if (leafSans.length && names.length && !result.namesMatched.length) {
    const msg = `The certificate names ${leafSans.map((s) => s.value).join(', ')}, but this server is reached as ${names.join(', ')}. ` +
      'Browsers and tablets would refuse it.';
    if (opts['allow-unmatched-names']) warn('NAMES_NOT_MATCHED', msg);
    else err('NAMES_NOT_MATCHED', msg + ' If the server will be reached by one of the certificate\'s names, add it under [server] in digilog-addresses.ini first (Start menu: Edit server addresses).');
  }

  const sources = rootSources(opts);
  const others = certs.filter((c) => c !== leaf);
  const built = buildChain(leaf, others, sources);
  result.chain = built.chain.map(describe);
  for (const c of built.chain) {
    if (now > new Date(c.validTo).getTime()) err('CHAIN_EXPIRED', `The intermediate certificate "${oneLine(c.subject)}" expired on ${new Date(c.validTo).toISOString()}.`);
  }
  if (built.root) {
    result.root = { ...describe(built.root), source: built.rootSource };
    if (built.rootSource === 'leaf') err('SELF_SIGNED', 'The certificate is self-signed. Tablets cannot be told to trust it safely; use one issued by the company CA.');
    if (now > new Date(built.root.validTo).getTime()) err('ROOT_EXPIRED', `The root certificate "${result.root.subject}" expired on ${result.root.validTo}.`);
  } else if (built.missingIsIntermediate) {
    err('CHAIN_INCOMPLETE', `The file is missing the intermediate certificate "${built.missingIssuer}". Tablets do not download it themselves. Ask IT for the certificate WITH its full chain (all intermediates).`);
  } else {
    err('CHAIN_INCOMPLETE', `The file does not contain the certificate that issued "${oneLine((built.chain.at(-1) ?? leaf).subject)}" ("${built.missingIssuer}"), and this PC does not trust it as a root. ` +
      'Ask IT for the full chain, or give the company ROOT certificate too.');
  }
  const unused = others.filter((c) => !built.chain.includes(c) && c !== built.root);
  if (unused.length) warn('EXTRA_CERTS', `${unused.length} certificate(s) in the file are not part of this chain and are left out: ${unused.map((c) => oneLine(c.subject)).join('; ')}.`);

  result.serverId = authorityKeyIdFromDer(leaf.raw);
  const chainPem = [leaf, ...built.chain].map((c) => c.toString().trim()).join('\n') + '\n';
  const keyPem = key.export({ type: 'pkcs8', format: 'pem' });
  try { tls.createSecureContext({ key: keyPem, cert: chainPem, minVersion: 'TLSv1.2' }); }
  catch (e) { err('LOAD_FAILED', `The FMS server could not load this certificate and key (${e.message}).`); }

  if (opts.current && fs.existsSync(opts.current)) {
    try {
      const cur = readCerts(opts.current);
      const curBuilt = buildChain(cur[0], cur.slice(1), sources);
      result.current = { ...describe(cur[0]), rootFingerprint256: curBuilt.root?.fingerprint256 ?? null, rootSubject: curBuilt.root ? oneLine(curBuilt.root.subject) : null,
        serverId: authorityKeyIdFromDer(cur[0].raw) };
      if (result.root && result.current.rootFingerprint256) result.rootChanged = result.root.fingerprint256 !== result.current.rootFingerprint256;
      result.serverIdChanged = result.serverId !== result.current.serverId;
    } catch (e) { warn('CURRENT_UNREADABLE', `The certificate in use now could not be read (${e.message}).`); }
  }

  result.ok = errors.length === 0;
  if (result.ok && opts.out) {
    fs.mkdirSync(opts.out, { recursive: true });
    fs.writeFileSync(path.join(opts.out, 'server.key'), keyPem, { mode: 0o600 });
    fs.writeFileSync(path.join(opts.out, 'server.crt'), chainPem);
    if (built.root) fs.writeFileSync(path.join(opts.out, 'root-ca.pem'), built.root.toString().trim() + '\n');
  }
  return result;
}

function served(port) {
  return new Promise((resolve) => {
    const s = tls.connect({ host: '127.0.0.1', port: Number(port), rejectUnauthorized: false, timeout: 5000 }, () => {
      const c = s.getPeerX509Certificate();
      s.end();
      resolve(c ? { ok: true, ...describe(c) } : { ok: false, error: 'no certificate' });
    });
    s.on('timeout', () => { s.destroy(); resolve({ ok: false, error: 'timeout' }); });
    s.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

// fileURLToPath, not URL.pathname: the install path has a space (%20).
const isMain = !!process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) {
  const a = args(process.argv.slice(2));
  try {
    if (a._[0] === 'check') {
      if (!a.cert) throw new Error('--cert is required');
      const r = check({ cert: a.cert, key: a.key, rootCa: a['root-ca'], extraRoots: a['extra-roots'], names: a.names,
        'allow-unmatched-names': a['allow-unmatched-names'], current: a.current, out: a.out, 'warn-days': a['warn-days'] });
      process.stdout.write(JSON.stringify(r) + '\n');
      process.exitCode = r.ok ? 0 : 2;
    } else if (a._[0] === 'served') {
      const r = await served(a.port);
      process.stdout.write(JSON.stringify(r) + '\n');
      process.exitCode = r.ok ? 0 : 2;
    } else {
      throw new Error('usage: check-certificate.mjs check --cert <file> [--key <file>] ... | served --port <n>');
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, fatal: String(e?.message ?? e) }) + '\n');
    process.exitCode = 1;
  }
}

export { check, buildChain, sans, nameMatches };
