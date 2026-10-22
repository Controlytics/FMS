/**
 * /api/ldap routes — behaviour through the real routes (2026-10-21).
 *
 * No directory server exists, so this file never ENABLES LDAP in the database
 * (an enabled row would send every unknown-username login in the shared test
 * DB to a directory bind). It drives every refusal/validation path, the masked
 * reads, the secret-preserving save, the re-auth gate (on this file's own role)
 * and a real connection attempt to a closed localhost port.
 *
 * The `ldap` system_config row is snapshotted and restored exactly in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, internalErrors, authGet, authPost, authPut } from '../../../e2e/test-helper.js';
import ldapRoutes from '../routes.js';
import { prisma } from '../../../lib/prisma.js';
import {
  cleanupAll, createRole, createUser, deleteRoles, deleteUsers, login, runSuffix, addReauth, removeReauth, type ReauthGrant,
} from '../../../e2e/support/owned-fixtures.js';

const S = runSuffix();
const PW = 'CvoLdap@2026!x';
const ROLE_CFG = `cvoLC${S}`;    // CONFIG_READ + CONFIG_UPDATE, re-auth required for UPDATE_LDAP_CONFIG
const ROLE_READ = `cvoLR${S}`;   // CONFIG_READ only
const U = { cfg: `cvolcf${S}`.toLowerCase(), read: `cvolrd${S}`.toLowerCase() };
const ids: Record<string, string> = {};
const tok: Record<string, string> = {};
let app: FastifyInstance;
let snapshot: { configValue: unknown; configType: string; requiresReauth: boolean } | null = null;
let added: ReauthGrant = [];
const CLOSED = 'ldap://127.0.0.1:1';

const storedLdap = async () => (await prisma.systemConfig.findUnique({ where: { configKey: 'ldap' } }))?.configValue as Record<string, any> | undefined;

beforeAll(async () => {
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'ldap' } });
  snapshot = row ? { configValue: row.configValue, configType: row.configType, requiresReauth: row.requiresReauth } : null;
  // Must never be enabled here — see the header.
  expect((row?.configValue as any)?.enabled ?? false).toBe(false);

  await createRole(ROLE_CFG, ['CONFIG_READ', 'CONFIG_UPDATE']);
  await createRole(ROLE_READ, ['CONFIG_READ']);
  ids.cfg = await createUser(U.cfg, ROLE_CFG, PW);
  ids.read = await createUser(U.read, ROLE_READ, PW);
  added = await addReauth([['UPDATE_LDAP_CONFIG', ROLE_CFG]]);
  app = await buildApp([{ plugin: ldapRoutes, prefix: '/api/ldap' }]);
  for (const k of Object.keys(U) as Array<keyof typeof U>) tok[k] = await login(app, U[k], PW);
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['ldap row', async () => {
      if (snapshot) {
        await prisma.systemConfig.update({ where: { configKey: 'ldap' }, data: { configValue: snapshot.configValue as any, configType: snapshot.configType, requiresReauth: snapshot.requiresReauth } });
      } else {
        await prisma.systemConfig.deleteMany({ where: { configKey: 'ldap' } });
      }
    }],
    ['reauth', () => removeReauth(added)],
    ['users', () => deleteUsers(Object.values(ids))],
    ['roles', () => deleteRoles([ROLE_CFG, ROLE_READ])],
    ['app', () => app?.close()],
  ]);
}, 60_000);

beforeEach(() => { internalErrors.length = 0; });

describe('PUT /api/ldap/config — re-auth, merge, masking, audit', () => {
  it('without the password the save is refused (REAUTH_REQUIRED) and nothing is written', async () => {
    const before = await storedLdap();
    const res = await authPut(app, '/api/ldap/config', tok.cfg, { serverUrl: CLOSED });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'UPDATE_LDAP_CONFIG' });
    expect(await storedLdap()).toEqual(before);
  });

  it('a wrong password is REAUTH_FAILED and writes nothing', async () => {
    const before = await storedLdap();
    const res = await authPut(app, '/api/ldap/config', tok.cfg, { serverUrl: CLOSED }, 'wrong-password');
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('REAUTH_FAILED');
    expect(await storedLdap()).toEqual(before);
    await prisma.user.update({ where: { id: ids.cfg }, data: { failedLoginAttempts: 0 } });
  });

  it('saves (merged over defaults), audits with secrets redacted, and links the audit row to its signature', async () => {
    const body = {
      enabled: false, serverUrl: CLOSED, bindDN: 'cn=svc,dc=cvo,dc=local', bindPassword: 'BindS3cret!',
      searchBase: 'dc=cvo,dc=local', roleMappings: [{ ldapGroup: 'Cleanroom Admins', role: 'ADMIN' }], apiToken: 'tok-123',
    };
    const res = await authPut(app, '/api/ldap/config', tok.cfg, body, PW);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, message: 'LDAP configuration updated' });

    const stored = await storedLdap();
    expect(stored).toMatchObject({ ...body, searchFilter: '(sAMAccountName={{username}})', tlsRejectUnauthorized: true, defaultRole: 'OPERATOR' });
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'ldap' } });
    expect(row!.updatedBy).toBe(U.cfg);

    const audit = await prisma.auditTrail.findFirst({ where: { action: 'LDAP_CONFIG_UPDATED', userId: U.cfg }, orderBy: { chainPosition: 'desc' } });
    expect(audit).toBeTruthy();
    const after = audit!.afterValue as Record<string, unknown>;
    expect(after.bindPassword).toBe('[redacted]');
    expect(after.apiToken).toBe('[redacted]');
    expect(after.serverUrl).toBe(CLOSED);
    expect(after.roleMappings).toEqual([{ ldapGroup: 'Cleanroom Admins', role: 'ADMIN' }]);
    expect(JSON.stringify(audit!.beforeValue)).not.toContain('BindS3cret!');
    expect(JSON.stringify(audit!.afterValue)).not.toContain('BindS3cret!');
    const sig = await prisma.auditTrail.findFirst({ where: { action: 'REAUTH_SUCCESS', userId: U.cfg }, orderBy: { chainPosition: 'desc' } });
    expect((audit as any).signatureAuditId).toBe(sig!.id);
    const prev = await prisma.auditTrail.findFirst({ where: { chainPosition: { lt: audit!.chainPosition! } }, orderBy: { chainPosition: 'desc' } });
    expect(audit!.previousChecksum).toBe(prev!.checksum);
  });

  it('the masked placeholder keeps the stored bind password', async () => {
    const res = await authPut(app, '/api/ldap/config', tok.cfg, { bindPassword: '********', searchBase: 'ou=x,dc=cvo,dc=local' }, PW);
    expect(res.statusCode).toBe(200);
    const stored = await storedLdap();
    expect(stored!.bindPassword).toBe('BindS3cret!');
    expect(stored!.searchBase).toBe('ou=x,dc=cvo,dc=local');
  });

  it('needs CONFIG_UPDATE', async () => {
    const res = await authPut(app, '/api/ldap/config', tok.read, { serverUrl: 'ldap://evil' }, PW);
    expect(res.statusCode).toBe(403);
    expect((await storedLdap())!.serverUrl).toBe(CLOSED);
  });
});

describe('GET /api/ldap/config + /status', () => {
  it('masks the bind password and reports status', async () => {
    const cfg = await authGet(app, '/api/ldap/config', tok.read);
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json()).toMatchObject({ serverUrl: CLOSED, bindDN: 'cn=svc,dc=cvo,dc=local', bindPassword: '********', enabled: false });
    const st = await authGet(app, '/api/ldap/status', tok.read);
    expect(st.json()).toEqual({ enabled: false, serverUrl: CLOSED });
  });

  it('with no stored row the defaults are served and the empty password stays empty', async () => {
    const saved = await prisma.systemConfig.findUnique({ where: { configKey: 'ldap' } });
    await prisma.systemConfig.delete({ where: { configKey: 'ldap' } });
    try {
      const cfg = await authGet(app, '/api/ldap/config', tok.read);
      expect(cfg.json()).toMatchObject({ enabled: false, serverUrl: '', bindPassword: '', tlsRejectUnauthorized: true, connectionTimeout: 5000 });
      expect((await authGet(app, '/api/ldap/status', tok.read)).json()).toEqual({ enabled: false, serverUrl: null });
    } finally {
      await prisma.systemConfig.create({ data: { configKey: 'ldap', configValue: saved!.configValue as any, configType: saved!.configType, requiresReauth: saved!.requiresReauth, updatedBy: saved!.updatedBy } });
    }
  });

  it('a caller without CONFIG_READ is refused', async () => {
    const noperm = `cvoLN${S}`;
    await createRole(noperm, []);
    const uid = await createUser(`cvolnn${S}`.toLowerCase(), noperm, PW);
    try {
      const t = await login(app, `cvolnn${S}`.toLowerCase(), PW);
      expect((await authGet(app, '/api/ldap/config', t)).statusCode).toBe(403);
      expect((await authGet(app, '/api/ldap/status', t)).statusCode).toBe(403);
    } finally {
      await deleteUsers([uid]);
      await deleteRoles([noperm]);
    }
  });
});

describe('POST /api/ldap/test-connection', () => {
  const test = (body: Record<string, unknown>) => authPost(app, '/api/ldap/test-connection', tok.cfg, body);

  // SEC-08 (2026-10-22): a loopback server is refused before any socket is opened.
  it('an empty body tests the STORED config — a stored loopback server is refused cleanly', async () => {
    const res = await test({});
    expect(res.statusCode).toBe(200);
    expect(res.json().success).toBe(false);
    expect(res.json().message).toBe('LDAP connection failed: the server address is not allowed (loopback and link-local addresses are refused).');
    expect(internalErrors).toEqual([]);
  });

  it('refuses when server / bind DN / password are missing', async () => {
    const res = await test({ bindDN: '' });
    expect(res.json()).toEqual({ success: false, message: 'Server URL, Bind DN, and Bind Password are required' });
  });

  it('refuses any scheme other than ldap:// or ldaps://', async () => {
    const res = await test({ serverUrl: 'http://127.0.0.1:80', bindPassword: 'p' });
    expect(res.json()).toEqual({ success: false, message: 'Server URL must start with ldap:// or ldaps://' });
  });

  it('will not send the STORED password to a different server', async () => {
    for (const bindPassword of [undefined, '********']) {
      const res = await test({ serverUrl: 'ldap://attacker.example:389', ...(bindPassword ? { bindPassword } : {}) });
      expect(res.json()).toEqual({ success: false, message: 'Enter the Bind Password to test a different server URL or with TLS verification disabled.' });
    }
  });

  it('will not send the STORED password with TLS verification switched off', async () => {
    const res = await test({ tlsRejectUnauthorized: false });
    expect(res.json().message).toBe('Enter the Bind Password to test a different server URL or with TLS verification disabled.');
  });

  it('a different server WITH a typed password passes the password guard (and a loopback one is then refused)', async () => {
    const res = await test({ serverUrl: 'ldap://127.0.0.1:2', bindPassword: 'typed', connectionTimeout: 1000 });
    expect(res.json().success).toBe(false);
    expect(res.json().message).toBe('LDAP connection failed: the server address is not allowed (loopback and link-local addresses are refused).');
  });

  it('needs CONFIG_UPDATE', async () => {
    const res = await authPost(app, '/api/ldap/test-connection', tok.read, {});
    expect(res.statusCode).toBe(403);
  });
});
