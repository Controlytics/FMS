/**
 * ldapService directory paths with the `ldapts` client mocked (2026-10-21).
 *
 * No directory server exists, so the ONLY mocked boundary is the ldapts
 * `Client`; the stored config is supplied by stubbing `ldapService.getConfig`
 * (never by enabling LDAP in the shared test database). Each test asserts what
 * the directory would have been asked (bind DN, escaped search filter,
 * TLS / timeout options) and what the caller gets back.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

type Behaviour = {
  bind?: (dn: string, pw: string) => Promise<void>;
  search?: (base: string, opts: any) => Promise<{ searchEntries: any[] }>;
  unbind?: () => Promise<void>;
};

const ldap = vi.hoisted(() => {
  const instances: Array<{ opts: any; bind: any; search: any; unbind: any }> = [];
  const queue: Behaviour[] = [];
  return { instances, queue };
});

vi.mock('ldapts', () => ({
  // A real class: `new Client(opts)` must yield the instance the service calls.
  Client: class {
    opts: any; bind: any; search: any; unbind: any;
    constructor(opts: any) {
      const b: Behaviour = ldap.queue.shift() ?? {};
      this.opts = opts;
      this.bind = vi.fn(b.bind ?? (async () => undefined));
      this.search = vi.fn(b.search ?? (async () => ({ searchEntries: [] })));
      this.unbind = vi.fn(b.unbind ?? (async () => undefined));
      ldap.instances.push(this);
    }
  },
}));

const { ldapService } = await import('../ldap.service.js');
const { prisma } = await import('../../../lib/prisma.js');
const { deleteUsers, runSuffix } = await import('../../../e2e/support/owned-fixtures.js');

const BASE = {
  enabled: true,
  serverUrl: 'ldaps://dir.cvo.local:636',
  bindDN: 'cn=svc,dc=cvo,dc=local',
  bindPassword: 'svc-pw',
  searchBase: 'dc=cvo,dc=local',
  searchFilter: '(&(objectClass=user)(sAMAccountName={{username}}))',
  usernameAttribute: 'sAMAccountName',
  emailAttribute: 'mail',
  fullNameAttribute: 'displayName',
  departmentAttribute: 'department',
  groupAttribute: 'memberOf',
  tlsRejectUnauthorized: true,
  connectionTimeout: 2500,
  roleMappings: [] as Array<{ ldapGroup: string; role: string }>,
  defaultRole: 'OPERATOR',
  syncAttributes: true,
};

function useConfig(over: Partial<typeof BASE> | Record<string, unknown> = {}) {
  vi.spyOn(ldapService, 'getConfig').mockResolvedValue({ ...BASE, ...over } as any);
}

beforeEach(() => { ldap.instances.length = 0; ldap.queue.length = 0; });
afterEach(() => { vi.restoreAllMocks(); });

describe('authenticateUser', () => {
  it('returns null without touching the directory when LDAP is disabled', async () => {
    useConfig({ enabled: false });
    expect(await ldapService.authenticateUser('jdoe', 'pw')).toBeNull();
    expect(ldap.instances).toHaveLength(0);
  });

  it('binds as the service account, searches with an ESCAPED filter, then binds as the user', async () => {
    useConfig();
    const entry = {
      dn: 'cn=j*doe,ou=users,dc=cvo,dc=local',
      displayName: ['J Doe', 'ignored'],
      mail: 'jdoe@cvo.local',
      memberOf: ['CN=Cleanroom Admins,OU=Groups,DC=cvo,DC=local', 'CN=QA,OU=Groups,DC=cvo,DC=local'],
    };
    ldap.queue.push({ search: async () => ({ searchEntries: [entry] }) }, {});
    const res = await ldapService.authenticateUser('j*doe(x)\\', 'user-pw');

    expect(res).toEqual({
      success: true,
      userDn: entry.dn,
      attributes: { fullName: 'J Doe', email: 'jdoe@cvo.local', department: '' },
      groups: entry.memberOf,
    });
    const [svc, user] = ldap.instances;
    expect(svc.opts).toEqual({ url: BASE.serverUrl, connectTimeout: 2500, tlsOptions: { rejectUnauthorized: true } });
    expect(svc.bind).toHaveBeenCalledWith(BASE.bindDN, 'svc-pw');
    const [base, opts] = svc.search.mock.calls[0];
    expect(base).toBe(BASE.searchBase);
    // RFC 4515: \ first, then * ( ) — injection characters never reach the filter raw.
    expect(opts.filter).toBe('(&(objectClass=user)(sAMAccountName=j\\2adoe\\28x\\29\\5c))');
    expect(opts.scope).toBe('sub');
    expect(opts.attributes).toEqual(['sAMAccountName', 'mail', 'displayName', 'department', 'memberOf', 'dn']);
    expect(svc.unbind).toHaveBeenCalledTimes(1);
    expect(user.bind).toHaveBeenCalledWith(entry.dn, 'user-pw');
    expect(user.unbind).toHaveBeenCalledTimes(1);
  });

  it('a single (non-array) group value and plain-string attributes are read too; defaults fill timeout + TLS', async () => {
    useConfig({ connectionTimeout: 0, tlsRejectUnauthorized: undefined as any });
    ldap.queue.push({ search: async () => ({ searchEntries: [{ dn: 'cn=a', displayName: 'A', department: 'Eng', memberOf: 'CN=Ops,DC=x' }] }) }, {});
    const res = await ldapService.authenticateUser('a', 'pw');
    expect(res!.groups).toEqual(['CN=Ops,DC=x']);
    expect(res!.attributes).toEqual({ fullName: 'A', email: '', department: 'Eng' });
    expect(ldap.instances[0].opts).toMatchObject({ connectTimeout: 5000, tlsOptions: { rejectUnauthorized: true } });
  });

  it('an empty first value of a multi-valued attribute reads as blank', async () => {
    useConfig();
    ldap.queue.push({ search: async () => ({ searchEntries: [{ dn: 'cn=z', displayName: [''], mail: ['z@cvo.local'] }] }) }, {});
    expect((await ldapService.authenticateUser('z', 'pw'))!.attributes).toEqual({ fullName: '', email: 'z@cvo.local', department: '' });
  });

  it('no groups attribute → empty group list', async () => {
    useConfig();
    ldap.queue.push({ search: async () => ({ searchEntries: [{ dn: 'cn=b' }] }) }, {});
    expect((await ldapService.authenticateUser('b', 'pw'))!.groups).toEqual([]);
  });

  it('an unknown user (no search hits) is null and the service bind is released', async () => {
    useConfig();
    ldap.queue.push({ search: async () => ({ searchEntries: [] }) });
    expect(await ldapService.authenticateUser('ghost', 'pw')).toBeNull();
    expect(ldap.instances).toHaveLength(1);
    expect(ldap.instances[0].unbind).toHaveBeenCalledTimes(1);
  });

  it('a wrong user password (user bind rejected) is null', async () => {
    useConfig();
    ldap.queue.push({ search: async () => ({ searchEntries: [{ dn: 'cn=c' }] }) }, { bind: async () => { throw new Error('49 invalid credentials'); } });
    expect(await ldapService.authenticateUser('c', 'bad')).toBeNull();
    expect(ldap.instances[1].unbind).not.toHaveBeenCalled();
  });

  it('a directory failure is null, and the best-effort unbind is attempted', async () => {
    useConfig();
    ldap.queue.push({ bind: async () => { throw new Error('ECONNREFUSED'); } });
    expect(await ldapService.authenticateUser('d', 'pw')).toBeNull();
    expect(ldap.instances[0].unbind).toHaveBeenCalledTimes(1);
  });

  it('an unbind that also fails after a directory error still yields null (no throw)', async () => {
    useConfig();
    ldap.queue.push({
      bind: async () => undefined,
      search: async () => { throw new Error('search timed out'); },
      unbind: async () => { throw new Error('client is not connected'); },
    });
    await expect(ldapService.authenticateUser('e', 'pw')).resolves.toBeNull();
  });
});

describe('testConnection', () => {
  it('binds and unbinds with the merged config and reports success', async () => {
    useConfig({ tlsRejectUnauthorized: false });
    const res = await ldapService.testConnection({ bindPassword: 'typed-pw' });
    expect(res).toEqual({ success: true, message: 'Successfully connected and authenticated to LDAP server' });
    expect(ldap.instances[0].opts).toEqual({ url: BASE.serverUrl, connectTimeout: 2500, tlsOptions: { rejectUnauthorized: false } });
    expect(ldap.instances[0].bind).toHaveBeenCalledWith(BASE.bindDN, 'typed-pw');
    expect(ldap.instances[0].unbind).toHaveBeenCalledTimes(1);
  });

  it('with no body it tests the stored config, defaulting timeout and TLS', async () => {
    useConfig({ connectionTimeout: 0, tlsRejectUnauthorized: undefined as any });
    expect((await ldapService.testConnection()).success).toBe(true);
    expect(ldap.instances[0].opts).toMatchObject({ connectTimeout: 5000, tlsOptions: { rejectUnauthorized: true } });
    expect(ldap.instances[0].bind).toHaveBeenCalledWith(BASE.bindDN, 'svc-pw');
  });

  it('a bind error is reported, including a non-Error rejection', async () => {
    useConfig();
    ldap.queue.push({ bind: async () => { throw 'plain string failure'; } });
    expect(await ldapService.testConnection()).toEqual({ success: false, message: 'LDAP connection failed: plain string failure' });
  });
});

describe('mapGroupsToRole', () => {
  const cfg = (over: Record<string, unknown>) => ({ ...BASE, ...over }) as any;

  it('first matching mapping wins (RDN match), SUPER_ADMIN mappings are skipped', () => {
    const c = cfg({ roleMappings: [
      { ldapGroup: 'Cleanroom Admins', role: 'SUPER_ADMIN' },
      { ldapGroup: 'cleanroom admins', role: 'ADMIN' },
      { ldapGroup: 'QA', role: 'SUPERVISOR' },
    ] });
    expect(ldapService.mapGroupsToRole(['CN=QA,DC=x', 'CN=Cleanroom Admins,OU=G,DC=x'], c)).toBe('ADMIN');
  });

  it('a group value that is a plain comma list (no RDN "=") still matches a component exactly', () => {
    const c = cfg({ roleMappings: [{ ldapGroup: 'QA', role: 'SUPERVISOR' }] });
    expect(ldapService.mapGroupsToRole(['Ops Team, QA'], c)).toBe('SUPERVISOR');
    expect(ldapService.mapGroupsToRole(['Ops Team, QA Leads'], c)).toBe('OPERATOR');
  });

  it('no match falls back to defaultRole; a SUPER_ADMIN or blank default falls back to OPERATOR', () => {
    const maps = [{ ldapGroup: 'Admins', role: 'ADMIN' }];
    expect(ldapService.mapGroupsToRole(['CN=BackupAdmins,DC=x'], cfg({ roleMappings: maps, defaultRole: 'SUPERVISOR' }))).toBe('SUPERVISOR');
    expect(ldapService.mapGroupsToRole([], cfg({ roleMappings: [], defaultRole: 'SUPER_ADMIN' }))).toBe('OPERATOR');
    expect(ldapService.mapGroupsToRole([], cfg({ roleMappings: undefined, defaultRole: '' }))).toBe('OPERATOR');
  });
});

describe('syncUserAttributes', () => {
  it('does nothing at all when attribute sync is off (an unknown user id is never touched)', async () => {
    await expect(ldapService.syncUserAttributes('00000000-0000-0000-0000-000000000000', {
      success: true, userDn: 'cn=x', attributes: { fullName: 'X', email: 'x@y', department: 'D' }, groups: [],
    }, { ...BASE, syncAttributes: false } as any)).resolves.toBeUndefined();
  });
});

describe('provisionUser + syncUserAttributes against the database', () => {
  const uname = `cvoldp${runSuffix()}`.toLowerCase();
  let uid = '';
  const qaMap = { ...BASE, roleMappings: [{ ldapGroup: 'QA', role: 'SUPERVISOR' }], defaultRole: 'OPERATOR' } as any;
  const result = (over: Record<string, unknown> = {}, groups = ['CN=QA,OU=Groups,DC=cvo']) =>
    ({ success: true as const, userDn: 'cn=ldp,ou=users,dc=cvo', attributes: { fullName: '', email: '', department: '' }, groups, ...over });

  afterAll(async () => { await deleteUsers([uid]); }, 60_000);

  it('provisions a directory user with the fallbacks a sparse entry needs, and audits USER_CREATED', async () => {
    const u = await ldapService.provisionUser(uname, result() as any, qaMap);
    uid = u.id;
    const row = await prisma.user.findUnique({ where: { id: uid } });
    expect(row).toMatchObject({
      username: uname, fullName: uname, email: `${uname}@ldap.local`, department: null, role: 'SUPERVISOR',
      authSource: 'ldap', ldapDn: 'cn=ldp,ou=users,dc=cvo', passwordHash: 'LDAP_EXTERNAL_AUTH', status: 'ENABLED',
    });
    const audit = await prisma.auditTrail.findFirst({ where: { action: 'USER_CREATED', targetId: uid } });
    expect(audit!.afterValue).toMatchObject({ username: uname, role: 'SUPERVISOR', authSource: 'ldap', ldapGroups: ['CN=QA,OU=Groups,DC=cvo'] });
    expect(audit!.signatureMeaning).toBe(`User "${uname}" auto-provisioned from LDAP with role "SUPERVISOR"`);
  });

  it('sync audits only real changes: attributes, then nothing, then a role change', async () => {
    const synced = () => prisma.auditTrail.findMany({ where: { action: 'USER_UPDATED', targetId: uid }, orderBy: { chainPosition: 'asc' } });
    await ldapService.syncUserAttributes(uid, result({ attributes: { fullName: 'Ldap Person', email: '', department: 'QA' } }) as any, qaMap);
    let rows = await synced();
    expect(rows).toHaveLength(1);
    expect(rows[0].beforeValue).toEqual({ fullName: uname, department: null });
    expect(rows[0].afterValue).toEqual({ fullName: 'Ldap Person', department: 'QA' });
    expect(rows[0].signatureMeaning).toBe(`User "${uname}" attributes synced from LDAP`);

    await ldapService.syncUserAttributes(uid, result({ attributes: { fullName: 'Ldap Person', email: '', department: 'QA' } }) as any, qaMap);
    expect(await synced()).toHaveLength(1);

    await ldapService.syncUserAttributes(uid, result({ attributes: { fullName: 'Ldap Person', email: 'p@cvo.local', department: 'QA' } }, []) as any, qaMap);
    rows = await synced();
    expect(rows).toHaveLength(2);
    expect(rows[1].afterValue).toEqual({ email: 'p@cvo.local', role: 'OPERATOR' });
    expect(rows[1].signatureMeaning).toBe(`User "${uname}" role changed "SUPERVISOR" → "OPERATOR" by LDAP group mapping`);
    expect((await prisma.user.findUnique({ where: { id: uid } }))).toMatchObject({ role: 'OPERATOR', email: 'p@cvo.local', fullName: 'Ldap Person' });
  });
});
