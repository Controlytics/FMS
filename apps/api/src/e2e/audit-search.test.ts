/**
 * Audit Trail search finds what the rows SAY (functional test, 2026-10-22).
 *
 * The search matched only userId / action / targetType / targetId / userRole,
 * so a filter name ("QA03-F1", "PF-B5/AHU-29") found nothing although the row's
 * description names it: the name lives in the stored payload (afterValue /
 * beforeValue: name, filterName, ahuName, username, ...) or in user_name.
 *
 * Names inside the records are matched only within a date range of at most
 * VALUE_SEARCH_MAX_DAYS (31): at one-year volume (7.4 M rows) a whole-table
 * value scan took 37 s. The column match still covers all time.
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

const DAY = 86_400_000;
/** A bounded range around now: the rows below were written during this run. */
const WEEK = () => `&startDate=${new Date(Date.now() - 7 * DAY).toISOString()}&endDate=${new Date(Date.now() + DAY).toISOString()}`;
type SearchResponse = { data: Array<{ id: string }>; total: number; valueSearch?: string; valueSearchMaxDays?: number };
const search = async (token: string, term: string, extra: string = WEEK()) => {
  const res = await app.inject({
    method: 'GET', url: `/api/audit?search=${encodeURIComponent(term)}&limit=100${extra}`,
    headers: { authorization: `Bearer ${token}` },
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json() as SearchResponse;
};
const foundIds = async (token: string, term: string, extra: string = WEEK()) => (await search(token, term, extra)).data.map((r) => r.id).sort();

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
    expect(await foundIds(saToken, FILTER_NAME, '&startDate=2000-01-01T00:00:00.000Z&endDate=2000-01-15T23:59:59.999Z')).toEqual([]);
    expect((await search(saToken, FILTER_NAME)).total).toBe(2);
  });

  it('names inside the records are matched only within a range of at most 31 days, and the response says which', async () => {
    const inRange = await search(saToken, FILTER_NAME);
    expect(inRange).toMatchObject({ valueSearch: 'applied', valueSearchMaxDays: 31 });
    // No range at all (the page's default): column matches only.
    const noRange = await search(saToken, FILTER_NAME, '');
    expect(noRange.data).toEqual([]);
    expect(noRange).toMatchObject({ valueSearch: 'skipped', valueSearchMaxDays: 31 });
    // A range longer than 31 days: skipped too.
    const long = `&startDate=${new Date(Date.now() - 40 * DAY).toISOString()}&endDate=${new Date(Date.now() + DAY).toISOString()}`;
    expect((await search(saToken, FILTER_NAME, long)).valueSearch).toBe('skipped');
    // A period chip sets only its start (to = now): "week" is within the bound, "year" is not.
    expect((await search(saToken, FILTER_NAME, '&period=week')).valueSearch).toBe('applied');
    expect(await foundIds(saToken, FILTER_NAME, '&period=week')).toEqual([ids.filter, ids.saRow].sort());
    expect((await search(saToken, FILTER_NAME, '&period=all')).valueSearch).toBe('skipped');
  });

  it('without a range the column match still covers all time (user id, user name, target id)', async () => {
    expect(await foundIds(saToken, `emp-${SUF}`, '')).toEqual([ids.person]);
    expect(await foundIds(saToken, PERSON, '')).toEqual([ids.person]);
    expect(await foundIds(saToken, `k-${SUF}`, '')).toEqual([ids.keyOnly]);
  });

  it('a list without a search carries no valueSearch field', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/audit?limit=1', headers: { authorization: `Bearer ${saToken}` } });
    expect(res.json()).not.toHaveProperty('valueSearch');
  });

  it('the old column matches keep working (action, target id, user id)', async () => {
    expect(await foundIds(saToken, `emp-${SUF}`)).toEqual([ids.person]);
    expect(await foundIds(saToken, `k-${SUF}`)).toEqual([ids.keyOnly]);
  });
});
