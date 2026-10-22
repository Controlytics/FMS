/**
 * OD-01 (operator decision 2026-10-22): actions that destroy a record, rewrite
 * a record or change the rules ALWAYS take the password — the 21 CFR Part 11
 * electronic signature — for EVERY user, SUPER_ADMIN included, and the
 * re-auth policy cannot switch that off.
 *
 * Before this, each of these routes used the policy-driven `enforceReauth`,
 * which asks only the roles listed in system_config['action-reauth']. Per the
 * OD-01 finding the live policy named SUPER_ADMIN on 2 of 84 actions, so the
 * role that can delete audit records signed almost nothing.
 *
 * Each route is checked three ways, with a policy that does NOT list the caller:
 *   1. no password      → 401 REAUTH_REQUIRED, nothing written;
 *   2. wrong password   → 401 REAUTH_FAILED, one audited failed signature, nothing else;
 *   3. right password   → done, and the row it wrote points at its REAUTH_SUCCESS
 *                          row through `signature_audit_id`.
 * Plus a non-SUPER_ADMIN role the policy has never heard of, which must be asked too.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import { isReauthRequired } from '../lib/reauth-check.js';
import { dateRangeGuard } from '../lib/date-range-guard.js';
import superAdminRoutes from '../modules/super-admin/routes.js';
import hierarchyRoutes from '../modules/hierarchy/routes.js';
import adminRequestRoutes from '../modules/admin-requests/routes.js';
import ldapRoutes from '../modules/ldap/routes.js';
import { randomUUID } from 'node:crypto';
import {
  runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, cleanupAll,
  createHierarchy, createFilter, deleteFilters, deleteHierarchy,
} from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `od01_sa_${SUF}`.toLowerCase();
const SA_PW = 'Od01Sa@2026x';
const LOW = `od01_low_${SUF}`.toLowerCase();
const LOW_PW = 'Od01Low@2026x';
const LOW_ROLE = `OD01L_${SUF}`;
/** The role a role-change request asks for (an active, low-level role this file owns). */
const NEW_ROLE = `OD01T_${SUF}`;
const WRONG = 'Definitely@Wrong9';
const REASON = 'OD-01 always-reauth test';

let app: FastifyInstance;
let saToken = '';
let lowToken = '';
const userIds: string[] = [];
const roleNames: string[] = [LOW_ROLE, NEW_ROLE];
const notificationIds: string[] = [];
const adminRequestIds: string[] = [];
const filterIds: string[] = [];
let h: Awaited<ReturnType<typeof createHierarchy>> | undefined;

type Call = {
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE'; url: string; payload?: Record<string, unknown>;
  /** A raw (multipart) body, for an upload route. */
  raw?: { body: Buffer; contentType: string };
};

const send = (token: string, c: Call, password?: string) => app.inject({
  method: c.method,
  url: c.url,
  headers: {
    authorization: `Bearer ${token}`, ...(password ? { 'x-reauth-password': password } : {}),
    ...(c.raw ? { 'content-type': c.raw.contentType } : {}),
  },
  ...(c.payload ? { payload: c.payload } : c.raw ? { payload: c.raw.body } : {}),
});

/** A multipart body carrying one small file — passes the restore route's
 * pre-gate checks (D03-09: body present, file present, not truncated). */
function oneFileUpload(): { body: Buffer; contentType: string } {
  const b = `----od01${SUF}`;
  return {
    contentType: `multipart/form-data; boundary=${b}`,
    body: Buffer.from([
      `--${b}`,
      'Content-Disposition: form-data; name="file"; filename="b.json"',
      'Content-Type: application/json',
      '',
      '{}',
      `--${b}--`,
      '',
    ].join('\r\n')),
  };
}

/** Audit rows my user wrote after `since`, other than signature attempts. */
const myWrites = (username: string, since: Date) => prisma.auditTrail.findMany({
  where: { userId: username, timestamp: { gte: since }, action: { notIn: ['REAUTH_SUCCESS', 'REAUTH_FAILED'] } },
  select: { action: true, targetId: true },
});
const signatureRows = (username: string, action: 'REAUTH_SUCCESS' | 'REAUTH_FAILED', reauthAction: string, since: Date) =>
  prisma.auditTrail.findMany({
    where: { userId: username, action, timestamp: { gte: since }, afterValue: { path: ['reauthAction'], equals: reauthAction } },
    select: { id: true },
  });

/**
 * A throwaway audit row for the audit-record routes to act on. Authored by a
 * non-SUPER_ADMIN marker so the non-SA role below can SEE it: since D03-09 an
 * invisible row is refused 404 before the gate, which would hide the gate.
 */
const newAuditRow = (tag: string) => auditLog({
  userId: `od01_mark_${SUF}`.toLowerCase(), userRole: 'OPERATOR', action: 'CONFIG_CHANGED',
  targetType: 'od01-test', targetId: `od01-${SUF}-${tag}`,
  afterValue: { tag }, signatureMeaning: `OD-01 fixture ${tag}`,
});

interface Case {
  action: string;
  /** Test name when one action is gated on more than one route. */
  name?: string;
  /** Build a fresh target and the call that acts on it. */
  setup: () => Promise<{ call: Call; untouched: () => Promise<boolean> }>;
  /** The row the signed handler writes; must carry signature_audit_id. */
  writes?: string;
  /** Set when a signed call cannot run against the shared test DB; says why. */
  refusalOnly?: string;
}

/** A pending admin request asking to change one field of `username`. */
async function modifyUserRequest(username: string, modifyField: string, newValue: string) {
  const r = await prisma.adminRequest.create({
    data: { requestType: 'MODIFY_USER', requesterName: 'OD-01 test', requestData: { username, modifyField, newValue } },
  });
  adminRequestIds.push(r.id);
  return r.id;
}

const auditRowExists = (id: string) => async () => {
  const row = await prisma.auditTrail.findUnique({ where: { id }, select: { afterValue: true, signatureMeaning: true } });
  return !!row && (row.afterValue as any)?.tag !== undefined && row.signatureMeaning?.startsWith('OD-01 fixture') === true;
};

const CASES: Case[] = [
  {
    action: 'REDACT_AUDIT_RECORD', writes: 'AUDIT_RECORD_REDACTED',
    setup: async () => {
      const id = await newAuditRow('redact');
      return { call: { method: 'POST', url: `/api/audit/${id}/redact`, payload: { reason: REASON } }, untouched: auditRowExists(id) };
    },
  },
  {
    action: 'BULK_REDACT_AUDIT_RECORDS', writes: 'AUDIT_RECORDS_BULK_REDACTED',
    setup: async () => {
      const id = await newAuditRow('bulk-redact');
      return { call: { method: 'POST', url: '/api/audit/bulk-redact', payload: { ids: [id], reason: REASON } }, untouched: auditRowExists(id) };
    },
  },
  {
    action: 'UPDATE_AUDIT_RECORD', writes: 'AUDIT_RECORD_UPDATED',
    setup: async () => {
      const id = await newAuditRow('edit');
      return { call: { method: 'PUT', url: `/api/audit/${id}`, payload: { reason: REASON, signatureMeaning: 'edited by OD-01 test' } }, untouched: auditRowExists(id) };
    },
  },
  {
    action: 'DELETE_AUDIT_RECORD', writes: 'AUDIT_RECORD_DELETED',
    setup: async () => {
      const id = await newAuditRow('delete');
      return { call: { method: 'DELETE', url: `/api/audit/${id}`, payload: { reason: REASON } }, untouched: auditRowExists(id) };
    },
  },
  {
    action: 'BULK_DELETE_AUDIT_RECORDS', writes: 'AUDIT_RECORDS_BULK_DELETED',
    setup: async () => {
      const id = await newAuditRow('bulk-delete');
      return { call: { method: 'POST', url: '/api/audit/bulk-delete', payload: { ids: [id], reason: REASON } }, untouched: auditRowExists(id) };
    },
  },
  {
    action: 'SUPER_ADMIN_DATA_EDIT', writes: 'MANUAL_RECORD_UPDATED',
    setup: async () => {
      const n = await prisma.notification.create({ data: { type: 'ACCOUNT_LOCKED', title: `OD-01 ${SUF}`, message: 'fixture' } });
      notificationIds.push(n.id);
      return {
        call: { method: 'PUT', url: `/api/super-admin/data/notifications/${n.id}`, payload: { title: `OD-01 ${SUF} edited`, _changeReason: REASON } },
        untouched: async () => (await prisma.notification.findUnique({ where: { id: n.id } }))?.title === `OD-01 ${SUF}`,
      };
    },
  },
  {
    action: 'DELETE_USER', writes: 'USER_DELETED',
    setup: async () => {
      const id = await createUser(`od01_del_${runSuffix()}`.toLowerCase(), 'OPERATOR', 'Od01Del@2026x');
      userIds.push(id);
      return { call: { method: 'DELETE', url: `/api/users/${id}` }, untouched: async () => !!(await prisma.user.findUnique({ where: { id } })) };
    },
  },
  {
    action: 'BULK_DELETE_USERS', writes: 'BULK_USER_DELETED',
    setup: async () => {
      const id = await createUser(`od01_bdel_${runSuffix()}`.toLowerCase(), 'OPERATOR', 'Od01Del@2026x');
      userIds.push(id);
      return { call: { method: 'POST', url: '/api/users/bulk-delete', payload: { userIds: [id] } }, untouched: async () => !!(await prisma.user.findUnique({ where: { id } })) };
    },
  },
  {
    action: 'CREATE_ROLE', writes: 'ROLE_CREATED',
    setup: async () => {
      const name = `OD01C_${runSuffix()}`;
      roleNames.push(name);
      return {
        call: { method: 'POST', url: '/api/roles', payload: { name, displayName: name, hierarchyLevel: 1, permissions: [] } },
        untouched: async () => !(await prisma.role.findUnique({ where: { name } })),
      };
    },
  },
  {
    action: 'UPDATE_ROLE', writes: 'ROLE_UPDATED',
    setup: async () => {
      const name = `OD01U_${runSuffix()}`;
      roleNames.push(name);
      await createRole(name, []);
      return {
        call: { method: 'PUT', url: `/api/roles/${name}`, payload: { description: 'edited by OD-01 test' } },
        untouched: async () => (await prisma.role.findUnique({ where: { name } }))?.description !== 'edited by OD-01 test',
      };
    },
  },
  {
    action: 'DELETE_ROLE', writes: 'ROLE_DELETED',
    setup: async () => {
      const name = `OD01D_${runSuffix()}`;
      roleNames.push(name);
      await createRole(name, []);
      return { call: { method: 'DELETE', url: `/api/roles/${name}` }, untouched: async () => !!(await prisma.role.findUnique({ where: { name } })) };
    },
  },
  {
    action: 'UPDATE_ROLE_CONFIG', writes: 'CONFIG_CHANGED',
    setup: async () => {
      const name = `OD01R_${runSuffix()}`;
      roleNames.push(name);
      await createRole(name, []);
      return {
        call: { method: 'PUT', url: `/api/config/roles/${name}`, payload: { homeWidgets: ['od01-widget'] } },
        untouched: async () => !((await prisma.roleConfig.findUnique({ where: { role: name } }))?.homeWidgets as string[] | undefined)?.includes('od01-widget'),
      };
    },
  },
  // ── OD-01 extras (operator, 2026-10-22) ──
  {
    action: 'UPDATE_USER_CONFIG', writes: 'CONFIG_CHANGED',
    setup: async () => {
      const id = await createUser(`od01_ucfg_${runSuffix()}`.toLowerCase(), 'OPERATOR', 'Od01Cfg@2026x');
      userIds.push(id);
      return {
        call: { method: 'PUT', url: `/api/config/users/${id}`, payload: { homeWidgets: ['od01-widget'] } },
        untouched: async () => !((await prisma.userConfig.findUnique({ where: { userId: id } }))?.homeWidgets as string[] | undefined)?.includes('od01-widget'),
      };
    },
  },
  {
    action: 'UPDATE_USER', writes: 'USER_UPDATED',
    setup: async () => {
      const id = await createUser(`od01_upd_${runSuffix()}`.toLowerCase(), 'OPERATOR', 'Od01Upd@2026x', 'OD01 Before');
      userIds.push(id);
      return {
        call: { method: 'PUT', url: `/api/users/${id}`, payload: { fullName: 'OD01 After' } },
        untouched: async () => (await prisma.user.findUnique({ where: { id } }))?.fullName === 'OD01 Before',
      };
    },
  },
  {
    action: 'APPROVE_ADMIN_REQUEST', name: 'APPROVE_ADMIN_REQUEST (a request that changes a ROLE)', writes: 'USER_UPDATED',
    setup: async () => {
      const username = `od01_arq_${runSuffix()}`.toLowerCase();
      userIds.push(await createUser(username, 'OPERATOR', 'Od01Arq@2026x'));
      const id = await modifyUserRequest(username, 'role', NEW_ROLE);
      return {
        call: { method: 'POST', url: `/api/admin-requests/${id}/process`, payload: { action: 'approve', adminRemarks: REASON } },
        untouched: async () => (await prisma.adminRequest.findUnique({ where: { id } }))?.status === 'PENDING'
          && (await prisma.user.findUnique({ where: { username } }))?.role === 'OPERATOR',
      };
    },
  },
  {
    action: 'DELETE_ASSET', name: 'DELETE_ASSET / DELETE_FILTER / DELETE_HIERARCHY_NODE (DELETE /api/assets/instances/:id)', writes: 'ASSET_DELETED',
    setup: async () => {
      const id = await createFilter(h!.ahuId, `OD01-${runSuffix()}`);
      filterIds.push(id);
      return {
        call: { method: 'DELETE', url: `/api/assets/instances/${id}` },
        untouched: async () => (await prisma.assetInstance.findUnique({ where: { id } }))?.isActive === true,
      };
    },
  },
  {
    action: 'DELETE_ASSET', name: 'DELETE_ASSET / DELETE_FILTER (DELETE /api/hierarchy/filters/:id)',
    setup: async () => {
      const id = await createFilter(h!.ahuId, `OD01-${runSuffix()}`);
      filterIds.push(id);
      return {
        call: { method: 'DELETE', url: `/api/hierarchy/filters/${id}` },
        untouched: async () => (await prisma.assetInstance.findUnique({ where: { id } }))?.isActive === true,
      };
    },
  },
  {
    action: 'UPDATE_FILTER_LIFECYCLE',
    refusalOnly: 'a signed manual lifecycle move rewrites a filter mid-pipeline; the refusal cases prove the gate',
    // A real, approved filter and an operational target: since D03-09 an unknown
    // filter or a refused move is answered BEFORE the gate, so the probe must pass
    // every pre-gate check to reach it.
    setup: async () => {
      const id = await createFilter(h!.ahuId, `OD01-LC-${runSuffix()}`);
      filterIds.push(id);
      return {
        call: { method: 'PATCH', url: `/api/assets/instances/${id}/lifecycle-state`, payload: { lifecycleState: 'INSTALLED', remarks: REASON } },
        untouched: async () => (await prisma.filterEvent.count({ where: { filterId: id } })) === 0,
      };
    },
  },
  {
    action: 'RESTORE_BACKUP',
    refusalOnly: 'a signed restore would overwrite the shared test DB; the gate runs before the file is parsed',
    // A real file: since D03-09 an upload with no file is refused BEFORE the gate.
    setup: async () => ({ call: { method: 'POST', url: '/api/backup/restore', raw: oneFileUpload() }, untouched: async () => true }),
  },
  {
    action: 'UPDATE_LDAP_CONFIG',
    refusalOnly: 'the LDAP config row is shared with the LDAP suites running beside this one',
    setup: async () => ({ call: { method: 'PUT', url: '/api/ldap/config', payload: {} }, untouched: async () => true }),
  },
  {
    action: 'UPDATE_REAUTH_CONFIG', writes: 'CONFIG_CHANGED',
    setup: async () => ({
      // Built at send time: the success case writes the policy back unchanged,
      // and reading it as late as possible keeps the window in which another
      // test's grant could be overwritten to one request.
      call: { method: 'PUT', url: '/api/config/action-reauth', payload: undefined },
      untouched: async () => true, // covered by "no write rows" — the row itself is shared with other suites
    }),
  },
];

/**
 * The stored policy as the PUT will accept it. Other suites share this row and
 * some leave grants for roles they have since deleted, which the PUT refuses
 * (A-02: unknown role) — so those dangling names are dropped, nothing else.
 */
const currentPolicy = async () => {
  const stored = ((await prisma.systemConfig.findUnique({ where: { configKey: 'action-reauth' } }))?.configValue ?? {}) as Record<string, string[]>;
  const live = new Set((await prisma.role.findMany({ select: { name: true } })).map((r) => r.name));
  return Object.fromEntries(Object.entries(stored).map(([a, roles]) => [a, (Array.isArray(roles) ? roles : []).filter((r) => live.has(r))]));
};
const withPayload = async (action: string, call: Call): Promise<Call> =>
  action === 'UPDATE_REAUTH_CONFIG' ? { ...call, payload: await currentPolicy() } : call;

beforeAll(async () => {
  app = await buildApp([
    { prefix: '/api/super-admin', plugin: async (a) => { a.addHook('preHandler', dateRangeGuard); await a.register(superAdminRoutes); } },
    { prefix: '/api/hierarchy', plugin: hierarchyRoutes },
    { prefix: '/api/admin-requests', plugin: adminRequestRoutes },
    { prefix: '/api/ldap', plugin: ldapRoutes },
  ]);
  h = await createHierarchy(`OD01-${SUF}`);
  userIds.push(await createUser(SA, 'SUPER_ADMIN', SA_PW));
  await createRole(LOW_ROLE, ['ROLE_MANAGE', 'AUDIT_DELETE', 'AUDIT_READ', 'CONFIG_READ', 'ADMIN_REQUEST_APPROVE']);
  // Above the level-1 roles it creates: a create refused for privilege (checked
  // before the signature since D03-09) would never reach the gate.
  await prisma.role.update({ where: { name: LOW_ROLE }, data: { hierarchyLevel: 5 } });
  await createRole(NEW_ROLE, []);
  userIds.push(await createUser(LOW, LOW_ROLE, LOW_PW));
  saToken = await login(app, SA, SA_PW);
  lowToken = await login(app, LOW, LOW_PW);
});

afterAll(async () => {
  await cleanupAll([
    ['notifications', () => prisma.notification.deleteMany({ where: { id: { in: notificationIds } } })],
    ['admin requests', () => prisma.adminRequest.deleteMany({ where: { id: { in: adminRequestIds } } })],
    ['filters', () => deleteFilters(filterIds)],
    ['hierarchy', () => deleteHierarchy(h)],
    ['user configs', () => prisma.userConfig.deleteMany({ where: { userId: { in: userIds } } })],
    ['users', () => deleteUsers(userIds)],
    ['roles', () => deleteRoles(roleNames)],
    ['app', () => app?.close()],
  ]);
});

describe('OD-01: record-destroying, record-rewriting and rule-changing actions always take the password', () => {
  for (const c of CASES) {
    describe(c.name ?? c.action, () => {
      it('the policy does not list this test\'s roles (so a refusal below can only come from the always-on gate)', async () => {
        expect(await isReauthRequired(c.action, LOW_ROLE)).toBe(false);
      });

      it('SUPER_ADMIN without a password: 401 REAUTH_REQUIRED, nothing written', async () => {
        const { call, untouched } = await c.setup();
        const since = new Date();
        const res = await send(saToken, await withPayload(c.action, call));
        expect(res.statusCode, res.body).toBe(401);
        expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: c.action });
        expect(await untouched()).toBe(true);
        expect(await myWrites(SA, since)).toEqual([]);
      });

      it('SUPER_ADMIN with a wrong password: 401 REAUTH_FAILED, one audited failed signature, nothing else', async () => {
        const { call, untouched } = await c.setup();
        const since = new Date();
        const res = await send(saToken, await withPayload(c.action, call), WRONG);
        expect(res.statusCode, res.body).toBe(401);
        expect(res.json().error).toBe('REAUTH_FAILED');
        expect(await untouched()).toBe(true);
        expect(await myWrites(SA, since)).toEqual([]);
        expect(await signatureRows(SA, 'REAUTH_FAILED', c.action, since)).toHaveLength(1);
      });

      it.skipIf(!!c.refusalOnly)(`SUPER_ADMIN with the password: done, and the written row is linked to its signature${c.refusalOnly ? ` (not run: ${c.refusalOnly})` : ''}`, async () => {
        const { call, untouched } = await c.setup();
        const since = new Date();
        const res = await send(saToken, await withPayload(c.action, call), SA_PW);
        expect(res.statusCode, res.body).toBe(200);
        if (c.action !== 'UPDATE_REAUTH_CONFIG') expect(await untouched()).toBe(false);
        const [sig, ...more] = await signatureRows(SA, 'REAUTH_SUCCESS', c.action, since);
        expect(sig).toBeDefined();
        expect(more).toEqual([]);
        const signed = await prisma.auditTrail.findMany({ where: { signatureAuditId: sig.id }, select: { action: true } });
        if (c.writes) expect(signed.map((r) => r.action)).toContain(c.writes);
        else expect(signed.length).toBeGreaterThan(0);
      });
    });
  }

  // Routes a non-SUPER_ADMIN can reach. The policy has never heard of LOW_ROLE,
  // so under the old policy-driven gate every one of these went through unsigned.
  for (const action of ['CREATE_ROLE', 'UPDATE_ROLE_CONFIG', 'UPDATE_REAUTH_CONFIG', 'DELETE_AUDIT_RECORD', 'APPROVE_ADMIN_REQUEST']) {
    it(`${action}: a role absent from the policy is still asked for the password`, async () => {
      const c = CASES.find((x) => x.action === action)!;
      const { call, untouched } = await c.setup();
      const since = new Date();
      const res = await send(lowToken, await withPayload(action, call));
      expect(res.statusCode, res.body).toBe(401);
      expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action });
      expect(await untouched()).toBe(true);
      expect(await myWrites(LOW, since)).toEqual([]);
    });
  }
});

// The admin-request gate is always-on ONLY for an approval that changes a role
// (operator, 2026-10-22). Every other decision stays policy-driven.
describe('APPROVE_ADMIN_REQUEST: only a role change is signed always', () => {
  it('approving a request that changes a user\'s FULL NAME follows the policy (not listed here: no password asked)', async () => {
    expect(await isReauthRequired('APPROVE_ADMIN_REQUEST', 'SUPER_ADMIN')).toBe(false);
    const username = `od01_arn_${runSuffix()}`.toLowerCase();
    userIds.push(await createUser(username, 'OPERATOR', 'Od01Arn@2026x', 'OD01 Name'));
    const id = await modifyUserRequest(username, 'fullName', 'OD01 Renamed');
    const res = await send(saToken, { method: 'POST', url: `/api/admin-requests/${id}/process`, payload: { action: 'approve', adminRemarks: REASON } });
    expect(res.statusCode, res.body).toBe(200);
    expect((await prisma.user.findUnique({ where: { username } }))?.fullName).toBe('OD01 Renamed');
  });

  it('REJECTING a role-change request changes no role and follows the policy', async () => {
    const username = `od01_arr_${runSuffix()}`.toLowerCase();
    userIds.push(await createUser(username, 'OPERATOR', 'Od01Arr@2026x'));
    const id = await modifyUserRequest(username, 'role', NEW_ROLE);
    const res = await send(saToken, { method: 'POST', url: `/api/admin-requests/${id}/process`, payload: { action: 'reject', adminRemarks: REASON } });
    expect(res.statusCode, res.body).toBe(200);
    expect((await prisma.user.findUnique({ where: { username } }))?.role).toBe('OPERATOR');
  });

  it('the role-change gate reads the STORED request: a body claiming otherwise changes nothing', async () => {
    const username = `od01_arb_${runSuffix()}`.toLowerCase();
    userIds.push(await createUser(username, 'OPERATOR', 'Od01Arb@2026x'));
    const id = await modifyUserRequest(username, 'role', NEW_ROLE);
    const res = await send(saToken, {
      method: 'POST', url: `/api/admin-requests/${id}/process`,
      payload: { action: 'approve', adminRemarks: REASON, requestType: 'UNLOCK', modifyField: 'fullName' },
    });
    expect(res.statusCode, res.body).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'APPROVE_ADMIN_REQUEST' });
    expect((await prisma.user.findUnique({ where: { username } }))?.role).toBe('OPERATOR');
  });
});
