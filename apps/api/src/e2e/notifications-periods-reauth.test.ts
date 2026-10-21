/**
 * /api/notifications — the period filters, an unparseable end date, and the
 * re-auth gate on (bulk) delete (coverage campaign 2026-10-21). Complements
 * e2e/notifications.test.ts with a throwaway, NON-admin user, so every list is
 * scoped to that user's own rows and the shared `admin` session is untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { isVisible } from '../modules/notifications/visibility.js';
import {
  uniq, ensureRole, ensureUser, deleteUsersAndRoles, login, addReauthRole, removeReauthRole,
} from '../modules/notification-delivery/__tests__/cov-fixtures.js';

const TAG = uniq();
const U = `covnp_u_${TAG}`;
const PW = 'CovNotifPer@2026';
const ROLE = `CNP_${TAG}`.slice(0, 20);
const ACTIONS = ['DELETE_NOTIFICATION', 'BULK_DELETE_NOTIFICATIONS'];
const DAY = 24 * 60 * 60 * 1000;

let app: FastifyInstance;
let token = '';
const ids: Record<string, string> = {};

const list = async (qs: string) =>
  (await app.inject({ method: 'GET', url: `/api/notifications?${qs}`, headers: { authorization: `Bearer ${token}` } })).json();
const idsOf = (body: any) => body.data.map((n: any) => n.id).sort();

beforeAll(async () => {
  app = await buildApp();
  await ensureRole(ROLE, ['NOTIFICATION_DELETE']);
  await ensureUser({ username: U, password: PW, role: ROLE });
  token = await login(app, U, PW);
  const mk = async (key: string, ageDays: number) => {
    ids[key] = (await prisma.notification.create({
      data: { type: 'USER_LOGIN', title: `cov ${key}`, message: `cov ${key} ${TAG}`, forUserId: U, createdAt: new Date(Date.now() - ageDays * DAY) },
    })).id;
  };
  await mk('now', 0);
  await mk('d100', 100);   // outside "quarter" (90 d)
  await mk('d800', 800);   // a previous calendar year
  await addReauthRole(ACTIONS, ROLE);
}, 60_000);

afterAll(async () => {
  await removeReauthRole(ACTIONS, ROLE);
  await prisma.notification.deleteMany({ where: { forUserId: U } });
  await deleteUsersAndRoles([U], [ROLE]);
  await app?.close();
}, 60_000);

describe('period / date filters', () => {
  it('week = the last 7 days; month = since the 1st of this month', async () => {
    expect(idsOf(await list('period=week'))).toEqual([ids.now]);
    expect(idsOf(await list('period=month'))).toEqual([ids.now]);
  });

  it('isRead filters on the read flag', async () => {
    await prisma.notification.update({ where: { id: ids.d100 }, data: { isRead: true, readAt: new Date() } });
    try {
      expect(idsOf(await list('isRead=true'))).toEqual([ids.d100]);
      expect(idsOf(await list('isRead=false'))).toEqual([ids.now, ids.d800].sort());
      expect((await list('isRead=false')).unreadCount).toBe(2);
    } finally {
      await prisma.notification.update({ where: { id: ids.d100 }, data: { isRead: false, readAt: null } });
    }
  });

  it('quarter = the last 90 days', async () => {
    expect(idsOf(await list('period=quarter'))).toEqual([ids.now]);
  });

  it('year = since 1 January of the current year', async () => {
    const jan1 = new Date(new Date().getFullYear(), 0, 1).getTime();
    const expected = [ids.now, ...(Date.now() - 100 * DAY >= jan1 ? [ids.d100] : [])].sort();
    expect(idsOf(await list('period=year'))).toEqual(expected);
  });

  it('all = no lower bound', async () => {
    expect(idsOf(await list('period=all'))).toEqual([ids.now, ids.d100, ids.d800].sort());
  });

  it('an end date that is not a date leaves the range open instead of matching nothing', async () => {
    expect(idsOf(await list('endDate=not-a-date'))).toEqual([ids.now, ids.d100, ids.d800].sort());
    const from = new Date(Date.now() - 200 * DAY).toISOString();
    expect(idsOf(await list(`startDate=${from}&endDate=garbage`))).toEqual([ids.now, ids.d100].sort());
  });

  it('rejects an unknown period', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/notifications?period=decade', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
  });
});

describe('delete re-auth (PA-REAUTH-4)', () => {
  it('single and bulk delete demand the password for a role the policy names, and delete nothing without it', async () => {
    const one = await app.inject({ method: 'DELETE', url: `/api/notifications/${ids.d800}`, headers: { authorization: `Bearer ${token}` } });
    expect(one.statusCode).toBe(401);
    expect(one.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'DELETE_NOTIFICATION' });
    const bulk = await app.inject({
      method: 'POST', url: '/api/notifications/bulk-delete', headers: { authorization: `Bearer ${token}` }, payload: { ids: [ids.d100, ids.d800] },
    });
    expect(bulk.statusCode).toBe(401);
    expect(bulk.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'BULK_DELETE_NOTIFICATIONS' });
    expect(await prisma.notification.count({ where: { forUserId: U } })).toBe(3);

    const ok = await app.inject({
      method: 'DELETE', url: `/api/notifications/${ids.d800}`, headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PW },
    });
    expect(ok.statusCode).toBe(200);
    expect(await prisma.notification.findUnique({ where: { id: ids.d800 } })).toBeNull();
  });
});

describe('isVisible', () => {
  it('an addressed row is never visible to a caller with no username', () => {
    expect(isVisible({ type: 'USER_LOGIN', forUserId: 'someone' }, 'OPERATOR', undefined, [])).toBe(false);
    expect(isVisible({ type: 'USER_LOGIN', forUserId: 'someone' }, 'OPERATOR', 'someone', [])).toBe(true);
  });
});
