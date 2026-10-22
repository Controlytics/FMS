/**
 * SEC-08 through the real route, real ldapts and real sockets — the exact
 * probes of the security assessment (2026-10-22, §5):
 *
 *   ldap://127.0.0.1:5432        → "read ECONNRESET"      221 ms (Postgres: port open)
 *   ldap://127.0.0.1:1           → "connect ECONNREFUSED"  66 ms (port closed)
 *   ldap://169.254.169.254:389   → "Connection timeout"     3 s (link-local, filtered)
 *
 * Three different answers made POST /api/ldap/test-connection a port scanner
 * for any holder of CONFIG_UPDATE (no password needed). After the fix all three
 * are refused before a socket is opened, with one identical body, at once.
 *
 * Own role + user; the stored `ldap` config row is never written (every probe
 * carries its own URL and typed bind password).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { networkInterfaces } from 'node:os';
import type { FastifyInstance } from 'fastify';
import { buildApp, authPost } from './test-helper.js';
import ldapRoutes from '../modules/ldap/routes.js';
import { cleanupAll, createRole, createUser, deleteRoles, deleteUsers, login, runSuffix } from './support/owned-fixtures.js';

const S = runSuffix();
const ROLE = `secLd${S}`;
const USER = `secld${S}`.toLowerCase();
const PW = 'SecLdap@2026!x';
let app: FastifyInstance;
let token = '';
let userId = '';

beforeAll(async () => {
  await createRole(ROLE, ['CONFIG_READ', 'CONFIG_UPDATE']);
  userId = await createUser(USER, ROLE, PW);
  app = await buildApp([{ plugin: ldapRoutes, prefix: '/api/ldap' }]);
  token = await login(app, USER, PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['users', () => deleteUsers([userId].filter(Boolean))],
    ['roles', () => deleteRoles([ROLE])],
    ['app', async () => { await app?.close(); }],
  ]);
}, 60_000);

const probe = async (serverUrl: string) => {
  const started = Date.now();
  const res = await authPost(app, '/api/ldap/test-connection', token, {
    serverUrl, bindDN: 'cn=probe,dc=x', bindPassword: 'typed-password', connectionTimeout: 3000,
  });
  return { status: res.statusCode, body: res.json(), ms: Date.now() - started };
};

describe('POST /api/ldap/test-connection is not a port scanner (SEC-08)', () => {
  it('open port, closed port and link-local all get the same refusal, without a connection attempt', async () => {
    const open = await probe('ldap://127.0.0.1:5432');   // the test DB's own Postgres
    const closed = await probe('ldap://127.0.0.1:1');
    const metadata = await probe('ldap://169.254.169.254:389');

    for (const r of [open, closed, metadata]) {
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        success: false,
        message: 'LDAP connection failed: the server address is not allowed (loopback and link-local addresses are refused).',
      });
      // No socket: a link-local probe used to wait out the 3 s connect timeout.
      expect(r.ms).toBeLessThan(1500);
    }
  });

  it('localhost by name and IPv6 loopback are refused the same way', async () => {
    for (const url of ['ldap://localhost:389', 'ldaps://[::1]:636']) {
      const r = await probe(url);
      expect(r.body.message, url).toBe('LDAP connection failed: the server address is not allowed (loopback and link-local addresses are refused).');
    }
  });

  // The private LAN stays allowed (instruments, on-prem directories) — and this
  // PC's own LAN address is part of it. Measured 2026-10-22 before the fix,
  // through that address: open port 5432 → 112 ms "read ECONNRESET", closed
  // port 1 → 2024 ms "connect ECONNREFUSED". Now: the same sentence, in the
  // same time.
  const lanIp = Object.values(networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(i.address))?.address;
  it.skipIf(!lanIp)('through this PC\'s own LAN address, an open and a closed port answer alike and in the same time', async () => {
    const open = await probe(`ldap://${lanIp}:5432`);
    const closed = await probe(`ldap://${lanIp}:1`);
    const unreachable = 'LDAP connection failed: could not reach the LDAP server. Check the address and port, and that the server is reachable from this machine.';
    expect(open.body).toEqual({ success: false, message: unreachable });
    expect(closed.body).toEqual({ success: false, message: unreachable });
    // Both wait out the 5 s floor (the 3 s connect timeout is shorter).
    for (const r of [open, closed]) expect(r.ms).toBeGreaterThanOrEqual(4900);
    expect(Math.abs(open.ms - closed.ms)).toBeLessThan(1000);
  }, 30_000);

  it('an unauthenticated caller is refused before anything is resolved', async () => {
    const res = await authPost(app, '/api/ldap/test-connection', 'not-a-token', { serverUrl: 'ldap://127.0.0.1:1' });
    expect(res.statusCode).toBe(401);
  });
});
