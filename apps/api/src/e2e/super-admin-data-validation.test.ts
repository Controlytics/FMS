/**
 * M50 (QA 2026-10-19): Filter Data Management generic edits must refuse
 * invalid values with 400 INVALID_VALUE and keep the PM visit-separation rule,
 * and nothing may be written on a refusal.
 *
 * Before: `new Date('garbage')` / `Number('x')` reached Prisma as a
 * PrismaClientValidationError (no code) → 500 + SYSTEM_ERROR notification; a
 * month of 13 was stored; and an edit could overlap two PM visits (the rule every
 * normal PM write path enforces). Owns its SUPER_ADMIN user and PM schedule.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs } from './test-helper.js';
import superAdminRoutes from '../modules/super-admin/routes.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';

const USERNAME = 'qa_m50_fdm';
const PASSWORD = 'QaM50@Test2026';
let app: FastifyInstance;
let token = '';
let scheduleId = '';
let entryA = '';
let entryB = '';
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

const put = (url: string, body: Record<string, unknown>) => app.inject({
  method: 'PUT', url, headers: { authorization: `Bearer ${token}`, 'x-reauth-password': PASSWORD },
  payload: { ...body, _changeReason: 'QA M50 validation check' },
});

describe('FDM generic edits validate values (M50)', () => {
  beforeAll(async () => {
    const passwordHash = await hashPassword(PASSWORD);
    await prisma.user.upsert({
      where: { username: USERNAME },
      update: { passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, failedLoginAttempts: 0, lockedAt: null, lockoutUntil: null },
      create: { username: USERNAME, fullName: 'QA M50', passwordHash, role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-m50-test' },
    });
    scheduleId = (await prisma.pmSchedule.create({ data: { entityId: randomUUID(), year: 2031, status: 'ACTIVE', createdBy: randomUUID() } })).id;
    entryA = (await prisma.pmScheduleEntry.create({ data: { scheduleId, month: 3, plannedDate: day('2031-03-10'), toleranceDays: 5, windowStart: day('2031-03-05'), windowEnd: day('2031-03-15'), approvalStatus: 'APPROVED' } })).id;
    entryB = (await prisma.pmScheduleEntry.create({ data: { scheduleId, month: 6, plannedDate: day('2031-06-10'), toleranceDays: 5, windowStart: day('2031-06-05'), windowEnd: day('2031-06-15'), approvalStatus: 'APPROVED' } })).id;
    app = await buildApp([{ plugin: superAdminRoutes, prefix: '/api/super-admin' }]);
    token = await loginAs(app, USERNAME, PASSWORD);
  }, 60_000);

  afterAll(async () => {
    await prisma.pmScheduleEntry.deleteMany({ where: { scheduleId } });
    await prisma.pmSchedule.deleteMany({ where: { id: scheduleId } });
    await app?.close();
  });

  const unchanged = async (id: string, field: 'month' | 'plannedDate', expected: unknown) => {
    const row = await prisma.pmScheduleEntry.findUnique({ where: { id } });
    expect((row as any)[field]).toEqual(expected);
  };

  it('refuses an invalid date with 400 INVALID_VALUE (not 500)', async () => {
    const res = await put(`/api/super-admin/data/pm-entries/${entryA}`, { plannedDate: 'not-a-date' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_VALUE');
    await unchanged(entryA, 'plannedDate', day('2031-03-10'));
  });

  it('refuses month 13 and a non-numeric month', async () => {
    for (const month of [13, 'abc']) {
      const res = await put(`/api/super-admin/data/pm-entries/${entryA}`, { month });
      expect(res.statusCode, String(month)).toBe(400);
    }
    await unchanged(entryA, 'month', 3);
  });

  it('refuses an edit that makes two visits satisfiable by one cleaning (409 PM_VISIT_OVERLAP)', async () => {
    const res = await put(`/api/super-admin/data/pm-entries/${entryB}`, { plannedDate: '2031-03-14' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('PM_VISIT_OVERLAP');
    await unchanged(entryB, 'plannedDate', day('2031-06-10'));
  });

  it('still saves a valid edit', async () => {
    const res = await put(`/api/super-admin/data/pm-entries/${entryB}`, { plannedDate: '2031-07-10' });
    expect(res.statusCode).toBe(200);
  });
});
