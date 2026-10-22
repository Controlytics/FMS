/**
 * Audit Trail search finds what the rows SAY (functional test, 2026-10-22).
 *
 * The search matched only userId / action / targetType / targetId / userRole,
 * so a filter name ("QA03-F1", "PF-B5/AHU-29") found nothing although the row's
 * description names it: the name lives in the stored payload (afterValue /
 * beforeValue: name, filterName, ahuName, username, ...) or in user_name.
 *
 * Real Fastify + Prisma on digilog_test_db. Every row searched for carries a
 * per-run tag, so other agents' rows cannot match.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { auditLog } from '../lib/audit.js';
import { runSuffix, createRole, createUser, login, deleteUsers, deleteRoles, cleanupAll } from './support/owned-fixtures.js';

const SUF = runSuffix();
const PW = 'CovAuditSearch@26';
const SA = `cv_asrch_sa_${SUF}`.toLowerCase();
const READER = `cv_asrch_rd_${SUF}`.toLowerCase();
const ROLE = `CVASR_${SUF}`.slice(0, 20);

// Names as the field data really looks, plus regex metacharacters that must be literal.
const FILTER_NAME = `QA03-F1-${SUF}`;
const SLASH_NAME = `PF-B5/AHU-29-${SUF}`;
const META_NAME = `F(${SUF})[1]*+?.`;
const DELETED_NAME = `OLD-AHU-${SUF}`;
const PERSON = `Ravi Kumar ${SUF}`;
const KEY_ONLY = `zzkey${SUF}`.toLowerCase();

let app: FastifyInstance;
let saToken = '';
let readerToken = '';
const userIds: string[] = [];
const ids: Record<string, string> = {};

const search = async (token: string, term: string, extra = '') => {
  const res = await app.inject({
    method: 'GET', url: `/api/audit?search=${encodeURIComponent(term)}&limit=100${extra}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as { data: Array<{ id: string }>; total: number };
};
const foundIds = async (token: string, term: string, extra = '') => (await search(token, term, extra)).data.map((r) => r.id).sort();

beforeAll(async () => {
  app = await buildApp();
  await createRole(ROLE, ['AUDIT_READ']);
  userIds.push(await createUser(SA, 'SUPER_ADMIN', PW));
  userIds.push(await createUser(READER, ROLE, PW));
  saToken = await login(app, SA, PW);
  readerToken = await login(app, READER, PW);

  const base = { userRole: 'OPERATOR', ipAddress: '10.1.2.3', userAgent: 'vitest' } as const;
  ids.filter = await auditLog({ ...base, userId: `op-${SUF}`, action: 'CYCLE_STARTED', targetType: 'cleaning_cycle', targetId: `cyc-${SUF}`, afterValue: { filterName: FILTER_NAME, cycleCode: `C-${SUF}` } });
  ids.slash = await auditLog({ ...base, userId: `op-${SUF}`, action: 'FILTER_CREATED', targetType: 'filter', targetId: `f-${SUF}`, afterValue: { name: SLASH_NAME, nested: { parentName: 'Block 1' } } });
  ids.meta = await auditLog({ ...base, userId: `op-${SUF}`, action: 'FILTER_CREATED', targetType: 'filter', targetId: `g-${SUF}`, afterValue: { name: META_NAME } });
  ids.deleted = await auditLog({ ...base, userId: `op-${SUF}`, action: 'ASSET_DELETED', targetType: 'asset_instance', targetId: `a-${SUF}`, beforeValue: { name: DELETED_NAME, templateKind: 'AHU' } });
  ids.person = await auditLog({ ...base, userId: `emp-${SUF}`, userName: PERSON, action: 'LOGIN_SUCCESS', targetType: 'user', targetId: `emp-${SUF}` });
  ids.keyOnly = await auditLog({ ...base, userId: `op-${SUF}`, action: 'CONFIG_CHANGED', targetType: 'config', targetId: `k-${SUF}`, afterValue: { [KEY_ONLY]: 'value' } });
  // Same filter name, but written by a SUPER_ADMIN: hidden from lower roles.
  ids.saRow = await auditLog({ userId: SA, userRole: 'SUPER_ADMIN', action: 'FILTER_UPDATED', targetType: 'filter', targetId: `f-${SUF}`, afterValue: { filterName: FILTER_NAME } });
}, 120_000);

afterAll(async () => {
  await cleanupAll([
    ['users', () => deleteUsers(userIds)],
    ['role', () => deleteRoles([ROLE])],
    ['app', () => app?.close()],
  ]);
}, 120_000);

describe('GET /api/audit?search= matches the names a row carries', () => {
  it('a filter name stored in the payload (afterValue.filterName) is found, case-insensitively', async () => {
    expect(await foundIds(saToken, FILTER_NAME)).toEqual([ids.filter, ids.saRow].sort());
    expect(await foundIds(saToken, FILTER_NAME.toLowerCase())).toEqual([ids.filter, ids.saRow].sort());
  });

  it('a name with "/" (PF-B5/AHU-29) and a nested value are found; a part of a name is enough', async () => {
    expect(await foundIds(saToken, SLASH_NAME)).toEqual([ids.slash]);
    expect(await foundIds(saToken, `B5/AHU-29-${SUF}`)).toEqual([ids.slash]);
  });

  it('the term is literal, not a pattern: regex characters match themselves and "." does not match "-"', async () => {
    expect(await foundIds(saToken, META_NAME)).toEqual([ids.meta]);
    expect(await foundIds(saToken, `QA03.F1-${SUF}`)).toEqual([]);
  });

  it('a name only in beforeValue (a deleted record) is found', async () => {
    expect(await foundIds(saToken, DELETED_NAME)).toEqual([ids.deleted]);
  });

  it('the stored user name (user_name) is found', async () => {
    expect(await foundIds(saToken, PERSON)).toEqual([ids.person]);
  });

  it('a payload KEY is not a match - only values are', async () => {
    expect(await foundIds(saToken, KEY_ONLY)).toEqual([]);
  });

  it('the visibility rules still apply: a lower role finds the OPERATOR row, never the SUPER_ADMIN one', async () => {
    expect(await foundIds(readerToken, FILTER_NAME)).toEqual([ids.filter]);
    expect((await search(readerToken, FILTER_NAME)).total).toBe(1);
  });

  it('the date range still applies on top of the search', async () => {
    expect(await foundIds(saToken, FILTER_NAME, '&startDate=2000-01-01T00:00:00.000Z&endDate=2000-12-31T23:59:59.999Z')).toEqual([]);
    expect((await search(saToken, FILTER_NAME)).total).toBe(2);
  });

  it('the old column matches keep working (action, target id, user id)', async () => {
    expect(await foundIds(saToken, `emp-${SUF}`)).toEqual([ids.person]);
    expect(await foundIds(saToken, `k-${SUF}`)).toEqual([ids.keyOnly]);
  });
});
