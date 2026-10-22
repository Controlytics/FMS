/**
 * ldap:// vs ldaps:// against REAL listeners (2026-10-22).
 *
 * ldapts treats a Client as TLS whenever ANY `tlsOptions` value is defined
 * (`secure = isLdaps || hasTlsOptions`), and the service always passed
 * `{ rejectUnauthorized }`. So every ldap:// URL opened with a TLS handshake: a
 * plain LDAP directory on 389 received a TLS ClientHello and the login could
 * never succeed. Pre-existing (the options were passed the same way before the
 * 2026-10-22 SEC-08/14 work).
 *
 * Fixed contract:
 *   ldaps://                    → TLS from the first byte
 *   ldap:// (startTls default)  → plain connect, StartTLS, THEN bind (secure by default)
 *   ldap:// + startTls: false   → plain LDAP, the admin's explicit choice
 *   ldap:// to a server that refuses StartTLS → refused, never silently plain
 *
 * The listeners are a few dozen lines of BER below: they answer a simple bind,
 * the StartTLS extended operation and unbind, and record what they saw. They
 * listen on this PC's LAN address because loopback is refused by the SEC-08
 * destination check. TLS uses the local mkcert pair (certs/, git-ignored); the
 * suite is skipped where either is missing.
 */
import { describe, it, expect, afterAll } from 'vitest';
import net from 'node:net';
import tls from 'node:tls';
import { networkInterfaces } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ldapService } from '../modules/ldap/ldap.service.js';

const lanIp = Object.values(networkInterfaces()).flat()
  .find((i) => i && i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address;
const certDir = join(__dirname, '..', '..', '..', '..', 'certs');
const haveCert = existsSync(join(certDir, 'server.key')) && existsSync(join(certDir, 'server.crt'));
const tlsCreds = () => ({ key: readFileSync(join(certDir, 'server.key')), cert: readFileSync(join(certDir, 'server.crt')) });

const STARTTLS_OID = Buffer.from('1.3.6.1.4.1.1466.20037', 'ascii');

/** LDAPMessage { messageID, protocolOp } with a short-form length (all ours are < 128 bytes). */
const message = (id: number, op: number, body: Buffer) => Buffer.concat([
  Buffer.from([0x30, 3 + 2 + body.length, 0x02, 0x01, id, op, body.length]), body,
]);
/** LDAPResult { resultCode, matchedDN "", diagnosticMessage "" } (+ extra tail). */
const result = (code: number, tail = Buffer.alloc(0)) => Buffer.concat([Buffer.from([0x0a, 0x01, code, 0x04, 0x00, 0x04, 0x00]), tail]);

type Seen = { firstByte: number; ops: string[]; tlsUpgraded: boolean; bindCode?: number };
/** What the directory saw, without the unbind (the client may close before it is read). */
const ops = (seen: Seen) => seen.ops.filter((o) => o !== 'UNBIND');

function serve(socket: net.Socket, seen: Seen, opts: { startTls: boolean }) {
  socket.on('error', () => undefined);
  socket.once('data', (b: Buffer) => { if (!seen.firstByte) seen.firstByte = b[0]; });
  const onData = (buf: Buffer) => {
    if (buf[0] !== 0x30) { socket.destroy(); return; } // not LDAP (e.g. a TLS ClientHello on a plain port)
    let i = 1;
    const len = buf[i++];
    if (len & 0x80) i += len & 0x7f;
    const id = buf[i + 2];
    const op = buf[i + 3];
    if (op === 0x60) { // BindRequest → success (or the configured result code)
      seen.ops.push('BIND');
      socket.write(message(id, 0x61, result(seen.bindCode ?? 0)));
    } else if (op === 0x77) { // ExtendedRequest (StartTLS)
      seen.ops.push('STARTTLS');
      if (!opts.startTls) { socket.write(message(id, 0x78, result(2))); return; } // protocolError
      socket.removeListener('data', onData);
      socket.write(message(id, 0x78, result(0, Buffer.concat([Buffer.from([0x8a, STARTTLS_OID.length]), STARTTLS_OID]))), () => {
        const secure = new tls.TLSSocket(socket, { isServer: true, ...tlsCreds() });
        seen.tlsUpgraded = true;
        serve(secure as unknown as net.Socket, seen, { startTls: false });
      });
    } else if (op === 0x63) { // SearchRequest → SearchResultDone, no entries
      seen.ops.push('SEARCH');
      socket.write(message(id, 0x65, result(0)));
    } else if (op === 0x42) { // UnbindRequest
      seen.ops.push('UNBIND');
      socket.end();
    }
  };
  socket.on('data', onData);
}

const servers: net.Server[] = [];
async function listen(kind: 'plain' | 'tls', startTls = false, bindCode = 0): Promise<{ port: number; seen: Seen; server: net.Server }> {
  const seen: Seen = { firstByte: 0, ops: [], tlsUpgraded: false, bindCode };
  const server = kind === 'tls'
    ? tls.createServer(tlsCreds(), (s) => serve(s as unknown as net.Socket, seen, { startTls: false }))
    : net.createServer((s) => serve(s, seen, { startTls }));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, lanIp, () => r()));
  return { port: (server.address() as net.AddressInfo).port, seen, server };
}
/** Connections the directory still holds, once the client has had a moment to close. */
async function openConnections(server: net.Server): Promise<number> {
  let n = 0;
  for (let i = 0; i < 20; i++) {
    n = await new Promise<number>((r) => server.getConnections((_e, c) => r(c)));
    if (n === 0) return 0;
    await new Promise((r) => setTimeout(r, 50));
  }
  return n;
}
// Every case asserts its own socket was released, so close() has nothing to wait for.
afterAll(async () => { await Promise.all(servers.map((s) => new Promise((r) => s.close(() => r(null))))); });

const test = (serverUrl: string, extra: Record<string, unknown> = {}) => ldapService.testConnection({
  serverUrl, bindDN: 'cn=svc,dc=cvl,dc=lan', bindPassword: 'typed-pw', connectionTimeout: 3000,
  tlsRejectUnauthorized: false, // the mkcert root is not in Node's store
  ...extra,
} as any);
const OK = { success: true, message: 'Successfully connected and authenticated to LDAP server' };

describe.skipIf(!lanIp || !haveCert)('ldap:// and ldaps:// against real listeners', () => {
  it('ldap:// with startTls: false speaks PLAIN LDAP to a plain directory', async () => {
    const { port, seen } = await listen('plain');
    expect(await test(`ldap://${lanIp}:${port}`, { startTls: false })).toEqual(OK);
    expect(seen.firstByte).toBe(0x30); // an LDAPMessage, not a TLS ClientHello (0x16)
    expect(ops(seen)).toEqual(['BIND']);
  });

  it('ldap:// by default upgrades with StartTLS BEFORE the bind, so the password never travels in clear', async () => {
    const { port, seen } = await listen('plain', true);
    expect(await test(`ldap://${lanIp}:${port}`)).toEqual(OK);
    expect(seen.firstByte).toBe(0x30);
    expect(ops(seen)).toEqual(['STARTTLS', 'BIND']);
    expect(seen.tlsUpgraded).toBe(true);
  });

  it('ldap:// by default refuses a server without StartTLS instead of falling back to a cleartext bind', async () => {
    const { port, seen, server } = await listen('plain', false);
    const res = await test(`ldap://${lanIp}:${port}`);
    expect(res.success).toBe(false);
    expect(res.message).toBe('LDAP connection failed: the server answered with LDAP result code 2.');
    expect(seen.ops).toEqual(['STARTTLS']); // no BIND was ever sent
    // …and the refused connection is released, not left open on the directory.
    expect(await openConnections(server)).toBe(0);
  });

  it('a refused bind (invalid credentials) is reported and its connection released', async () => {
    const { port, server } = await listen('plain', false, 49);
    const res = await test(`ldap://${lanIp}:${port}`, { startTls: false });
    expect(res).toEqual({ success: false, message: 'LDAP connection failed: the server rejected the bind credentials.' });
    expect(await openConnections(server)).toBe(0);
  });

  it('ldaps:// is TLS from the first byte', async () => {
    const { port, seen } = await listen('tls');
    expect(await test(`ldaps://${lanIp}:${port}`)).toEqual(OK);
    expect(ops(seen)).toEqual(['BIND']);
  });

  it('the login bind follows the same rules (plain directory, startTls: false)', async () => {
    const { port, seen } = await listen('plain');
    const getConfig = ldapService.getConfig;
    (ldapService as any).getConfig = async () => ({
      ...(await getConfig.call(ldapService)), enabled: true, serverUrl: `ldap://${lanIp}:${port}`, startTls: false,
      bindDN: 'cn=svc,dc=cvl,dc=lan', bindPassword: 'svc-pw', searchBase: 'dc=cvl,dc=lan',
    });
    try {
      // The fake directory has no search support: the service bind must at least
      // reach it as plain LDAP (before the fix it sent a TLS ClientHello).
      await ldapService.authenticateUser('jdoe', 'pw');
      expect(seen.firstByte).toBe(0x30);
      expect(seen.ops[0]).toBe('BIND');
    } finally {
      (ldapService as any).getConfig = getConfig;
    }
  });
});
