/**
 * A date range means the server's LOCAL calendar days, at both ends (2026-10-23).
 *
 * The start of a bare `yyyy-mm-dd` range was read as UTC midnight while the end
 * was local end-of-day. On the customer server (India, UTC+5:30) "from 1 Feb"
 * therefore began at 05:30 IST, so records made between 00:00 and 05:30 on the
 * first day — night-shift cleanings — dropped out of the filtered list. For a
 * `@db.Date` column (PM planned dates) the instant the web sends for local
 * midnight (31 Jan 18:30 UTC in India) was compared as 31 Jan, so 31 Jan's
 * visits were listed under "from 1 Feb".
 *
 * Measured through the real routes, under a pinned zone east of UTC and one
 * west. Owns its SUPER_ADMIN user, notifications and PM schedule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs } from './test-helper.js';
import superAdminRoutes from '../modules/super-admin/routes.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { pinTimeZone } from '../lib/__tests__/pin-time-zone.js';

const USERNAME = 'dr_local_day_sa';
const PASSWORD = 'DrLocalDay@2026';
let app: FastifyInstance;
let token = '';
let scheduleId = '';
const notif: Record<string, string> = {};
const entry: Record<string, string> = {};

const get = async (url: string) => {
  const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
/** Which of `mine` came back, by key. */
const keysIn = (body: any, mine: Record<string, string>) => {
  const back = new Set(body.data.map((r: any) => r.id));
  return Object.keys(mine).filter((k) => back.has(mine[k])).sort();
};

beforeAll(async () => {
  const passwordHash = await hashPassword(PASSWORD);
  await prisma.user.upsert({
    where: { username: USERNAME },
    update: { passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
    create: { username: USERNAME, fullName: 'Date range local day', passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'dr-local-day-test' },
  });
  // Instants around 1 Feb 2026 in India (+05:30) and New York (-05:00).
  const at: Record<string, string> = {
    istPrevEvening: '2026-01-31T23:30:00+05:30',
    istNight: '2026-02-01T01:00:00+05:30', // the night-shift record of the finding
    istLate: '2026-02-01T23:30:00+05:30',
    istNextNight: '2026-02-02T00:30:00+05:30',
    nyPrevEvening: '2026-01-31T20:00:00-05:00',
    nyNight: '2026-02-01T00:30:00-05:00',
    nyLate: '2026-02-01T23:30:00-05:00',
  };
  for (const [k, iso] of Object.entries(at)) {
    notif[k] = (await prisma.notification.create({
      data: { type: 'USER_LOGIN', title: `dr ${k}`, message: `dr local day ${k}`, forUserId: USERNAME, createdAt: new Date(iso) },
    })).id;
  }
  scheduleId = (await prisma.pmSchedule.create({ data: { entityId: randomUUID(), year: 2026, status: 'ACTIVE', createdBy: randomUUID() } })).id;
  const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
  for (const [k, d, month] of [['jan31', '2026-01-31', 1], ['feb01', '2026-02-01', 2], ['feb02', '2026-02-02', 2]] as const) {
    entry[k] = (await prisma.pmScheduleEntry.create({
      data: { scheduleId, month, plannedDate: day(d), toleranceDays: 0, windowStart: day(d), windowEnd: day(d), approvalStatus: 'APPROVED' },
    })).id;
  }
  app = await buildApp([{ plugin: superAdminRoutes, prefix: '/api/super-admin' }]);
  token = await loginAs(app, USERNAME, PASSWORD);
}, 60_000);

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { forUserId: USERNAME } });
  await prisma.pmScheduleEntry.deleteMany({ where: { scheduleId } });
  await prisma.pmSchedule.deleteMany({ where: { id: scheduleId } });
  await app?.close();
}, 60_000);

const IST = ['istPrevEvening', 'istNight', 'istLate', 'istNextNight'];
const NY = ['nyPrevEvening', 'nyNight', 'nyLate'];
const only = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, notif[k]]));

describe('in Asia/Kolkata (the customer server)', () => {
  let restore: () => void;
  beforeAll(() => { restore = pinTimeZone('Asia/Kolkata'); });
  afterAll(() => restore());

  it('notifications: from = to = 1 Feb includes the 01:00 IST record and nothing from 31 Jan or 2 Feb', async () => {
    const body = await get('/api/notifications?startDate=2026-02-01&endDate=2026-02-01&limit=500');
    expect(keysIn(body, only(IST))).toEqual(['istLate', 'istNight']);
  });

  it('Filter Data Management (timestamp column): the same day, with bare dates', async () => {
    const body = await get('/api/super-admin/data/notifications?from=2026-02-01&to=2026-02-01&limit=5000');
    expect(keysIn(body, only(IST))).toEqual(['istLate', 'istNight']);
  });

  it('Filter Data Management (PM planned date, a DATE column): only 1 Feb, from bare dates or from the instants the web sends', async () => {
    expect(keysIn(await get('/api/super-admin/data/pm-entries?from=2026-02-01&to=2026-02-01&limit=5000'), entry)).toEqual(['feb01']);
    // asInstant() in the browser: local midnight and local 23:59:59.999 of 1 Feb, in IST
    const web = await get('/api/super-admin/data/pm-entries?from=2026-01-31T18:30:00.000Z&to=2026-02-01T18:29:59.999Z&limit=5000');
    expect(keysIn(web, entry)).toEqual(['feb01']);
  });
});

describe('in America/New_York (west of UTC)', () => {
  let restore: () => void;
  beforeAll(() => { restore = pinTimeZone('America/New_York'); });
  afterAll(() => restore());

  it('notifications: 1 Feb is the local day — the 20:00 record of 31 Jan stays out, 00:30 and 23:30 on 1 Feb are in', async () => {
    const body = await get('/api/notifications?startDate=2026-02-01&endDate=2026-02-01&limit=500');
    expect(keysIn(body, only(NY))).toEqual(['nyLate', 'nyNight']);
  });

  it('PM planned date: a bare "to 1 Feb" does not take in 2 Feb', async () => {
    expect(keysIn(await get('/api/super-admin/data/pm-entries?from=2026-02-01&to=2026-02-01&limit=5000'), entry)).toEqual(['feb01']);
    const web = await get('/api/super-admin/data/pm-entries?from=2026-02-01T05:00:00.000Z&to=2026-02-02T04:59:59.999Z&limit=5000');
    expect(keysIn(web, entry)).toEqual(['feb01']);
  });
});
