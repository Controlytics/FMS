import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { serverIdFromCertPem } from '../server-id.js';

/**
 * scripts/check-certificate.mjs decides whether set-certificate.ps1 (Start menu
 * "Change SSL certificate", 2026-10-31) may switch the FMS server to a company
 * certificate. A wrong "yes" stops every browser and tablet; a missing
 * intermediate is the classic one (Windows browsers fetch it, Android does not).
 *
 * Certificates are made here with OpenSSL (Git for Windows, or the staged copy
 * of a build). Without OpenSSL the chain tests skip; the name rules still run.
 */
const REPO = join(__dirname, '..', '..', '..', '..', '..');
const CHECKER = join(REPO, 'scripts', 'check-certificate.mjs');
const OPENSSL = [
  join(REPO, 'dist', 'stage', 'openssl', 'openssl.exe'),
  'C:\\Program Files\\Git\\usr\\bin\\openssl.exe',
  'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe',
].find((p) => existsSync(p));

let dir = '';
// The staged OpenSSL has no usable compiled-in config: `req`/`x509` need
// OPENSSL_CONF (install.ps1 sets it the same way).
const sslEnv = () => {
  const cnf = join(OPENSSL!, '..', 'openssl.cnf');
  return existsSync(cnf) ? { ...process.env, OPENSSL_CONF: cnf } : process.env;
};
const ssl = (...args: string[]) => execFileSync(OPENSSL!, args, { cwd: dir, stdio: 'pipe', env: sslEnv() });
const f = (name: string) => join(dir, name);
function check(...args: string[]) {
  const r = spawnSync(process.execPath, [CHECKER, 'check', ...args], { cwd: dir, encoding: 'utf8' });
  return { code: r.status, ...JSON.parse(r.stdout.trim().split('\n').pop()!) };
}
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

function makeCa(name: string, subject: string, issuer?: string) {
  ssl('genrsa', '-out', `${name}.key`, '2048');
  if (!issuer) {
    ssl('req', '-x509', '-new', '-key', `${name}.key`, '-sha256', '-days', '3650', '-subj', subject,
      '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-out', `${name}.pem`);
    return;
  }
  writeFileSync(f('ca.ext'), 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n');
  ssl('req', '-new', '-key', `${name}.key`, '-subj', subject, '-out', `${name}.csr`);
  ssl('x509', '-req', '-in', `${name}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-days', '1825', '-sha256', '-extfile', 'ca.ext', '-out', `${name}.pem`);
}
function makeLeaf(name: string, issuer: string, san: string) {
  ssl('genrsa', '-out', `${name}.key`, '2048');
  writeFileSync(f(`${name}.ext`), `basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\nsubjectAltName=${san}\n`);
  ssl('req', '-new', '-key', `${name}.key`, '-subj', `/CN=${name}`, '-out', `${name}.csr`);
  ssl('x509', '-req', '-in', `${name}.csr`, '-CA', `${issuer}.pem`, '-CAkey', `${issuer}.key`, '-CAcreateserial', '-days', '60', '-sha256', '-extfile', `${name}.ext`, '-out', `${name}.crt`);
}

describe('check-certificate.mjs name rules', () => {
  it('matches IPs exactly and a wildcard to ONE label only', async () => {
    const { nameMatches } = await import(pathToFileURL(CHECKER).href);
    expect(nameMatches({ type: 'ip', value: '10.9.8.7' }, '10.9.8.7')).toBe(true);
    expect(nameMatches({ type: 'ip', value: '10.9.8.7' }, '10.9.8.70')).toBe(false);
    expect(nameMatches({ type: 'dns', value: 'fms.example.test' }, 'FMS.example.test')).toBe(true);
    expect(nameMatches({ type: 'dns', value: '*.example.test' }, 'fms.example.test')).toBe(true);
    expect(nameMatches({ type: 'dns', value: '*.example.test' }, 'a.b.example.test')).toBe(false);
    expect(nameMatches({ type: 'dns', value: '*.example.test' }, 'example.test')).toBe(false);
    expect(nameMatches({ type: 'dns', value: 'fms.example.test' }, '10.9.8.7')).toBe(false);
  });
});

describe.skipIf(!OPENSSL)('check-certificate.mjs on a real chain (root > intermediate > server)', () => {
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'fms-checkcert-'));
    makeCa('root', '/O=Test Co/CN=Test Root CA');
    makeCa('inter', '/O=Test Co/CN=Test Issuing CA', 'root');
    makeLeaf('leaf', 'inter', 'DNS:fms.example.test,IP:10.9.8.7');
    ssl('genrsa', '-out', 'wrong.key', '2048');
    writeFileSync(f('chain.pem'), readFileSync(f('leaf.crt'), 'utf8') + readFileSync(f('inter.pem'), 'utf8'));
    writeFileSync(f('reversed.pem'), readFileSync(f('inter.pem'), 'utf8') + readFileSync(f('leaf.crt'), 'utf8'));
  }, 60_000);
  afterAll(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  const base = () => ['--root-ca', f('root.pem'), '--names', '10.9.8.7'];

  it('accepts the full chain and writes leaf-first server.crt + root-ca.pem', () => {
    const r = check('--cert', f('reversed.pem'), '--key', f('leaf.key'), ...base(), '--out', f('out'));
    expect(r.code).toBe(0);
    expect(codes(r)).toEqual([]);
    expect(r.chain).toHaveLength(1);
    expect(r.root.subject).toMatch(/Test Root CA/);
    const out = readFileSync(f('out/server.crt'), 'utf8').match(/-----BEGIN CERTIFICATE-----/g);
    expect(out).toHaveLength(2);
    // Leaf first, whatever order the file came in (fingerprints: OpenSSL writes CRLF, Node LF).
    const first = new X509Certificate(readFileSync(f('out/server.crt'), 'utf8').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/)![0]);
    expect(first.fingerprint256).toBe(new X509Certificate(readFileSync(f('leaf.crt'))).fingerprint256);
    expect(readFileSync(f('out/server.key'), 'utf8')).toMatch(/^-----BEGIN PRIVATE KEY-----/);
    expect(existsSync(f('out/root-ca.pem'))).toBe(true);
  });

  it('refuses a file without its intermediate - tablets never fetch one', () => {
    const r = check('--cert', f('leaf.crt'), '--key', f('leaf.key'), ...base());
    expect(r.code).toBe(2);
    expect(codes(r)).toContain('CHAIN_INCOMPLETE');
  });

  it('refuses a key that is not the certificate\'s', () => {
    expect(codes(check('--cert', f('chain.pem'), '--key', f('wrong.key'), ...base()))).toEqual(['KEY_MISMATCH']);
  });

  it('refuses a CA certificate used as the server certificate', () => {
    expect(codes(check('--cert', f('inter.pem'), '--key', f('inter.key'), ...base()))).toContain('LEAF_IS_CA');
  });

  it('refuses a certificate naming none of the server\'s addresses, unless allowed', () => {
    const args = ['--cert', f('chain.pem'), '--key', f('leaf.key'), '--root-ca', f('root.pem'), '--names', '192.168.1.5,fms2.example.test'];
    expect(codes(check(...args))).toEqual(['NAMES_NOT_MATCHED']);
    const allowed = check(...args, '--allow-unmatched-names');
    expect(allowed.code).toBe(0);
    expect(allowed.warnings.map((w: { code: string }) => w.code)).toContain('NAMES_NOT_MATCHED');
  });

  it('refuses an unknown root unless it is given', () => {
    expect(codes(check('--cert', f('chain.pem'), '--key', f('leaf.key'), '--names', '10.9.8.7'))).toContain('CHAIN_INCOMPLETE');
  });

  it('serverId is the API\'s own reading of the certificate (lib/server-id.ts)', () => {
    const r = check('--cert', f('chain.pem'), '--key', f('leaf.key'), ...base());
    expect(r.serverId).toBeTruthy();
    expect(r.serverId).toBe(serverIdFromCertPem(readFileSync(f('leaf.crt'))));
  });

  it('a renewal under the same root reports rootChanged=false', () => {
    makeLeaf('renewed', 'inter', 'DNS:fms.example.test');
    writeFileSync(f('renewed-chain.pem'), readFileSync(f('renewed.crt'), 'utf8') + readFileSync(f('inter.pem'), 'utf8'));
    const r = check('--cert', f('renewed-chain.pem'), '--key', f('renewed.key'), '--root-ca', f('root.pem'), '--names', 'fms.example.test', '--current', f('chain.pem'));
    expect(r.code).toBe(0);
    expect(r.rootChanged).toBe(false);
    expect(r.serverIdChanged).toBe(false);
  });
});
