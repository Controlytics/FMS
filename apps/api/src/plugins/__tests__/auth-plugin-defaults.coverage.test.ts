/**
 * Auth plugin fallbacks for MISSING config rows and a missing user (coverage,
 * 2026-10-21).
 *
 * `session` and `password-policy` are shared rows every concurrent suite reads;
 * deleting them to reach the "no row" defaults would change every other
 * suite's sessions. So, like auth.plugin.test.ts, this file replaces the Prisma
 * module (vi.mock of lib/prisma.js — no delegate of the real client is spied on)
 * and the JWT verifier, and drives the REAL plugin over HTTP on a bare Fastify:
 *
 *  - no `session` row          -> sliding expiry uses the 8 h default
 *  - no `password-policy` row  -> the 90-day default expiry applies
 *  - token names a deleted user -> 401 ACCOUNT_INACTIVE
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const { mockVerifyToken, mockPrisma } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockPrisma: {
    session: { findFirst: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    systemConfig: { findFirst: vi.fn(), findUnique: vi.fn() },
  },
}));
vi.mock('../../lib/jwt.js', () => ({ verifyToken: mockVerifyToken }));
vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import authPlugin, { invalidatePasswordPolicyCache, invalidateSessionAuthCache, invalidateUserAuthCache } from '../auth.js';

const DAY = 86_400_000;
let app: FastifyInstance;
let n = 0;

/** Fresh ids per test so the module-level 30 s caches never answer for an earlier test. */
function ids() { n += 1; return { sub: `u-${n}`, sessionId: `s-${n}` }; }

function live(sessionId: string) {
  return { id: sessionId, isActive: true, createdAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() + 3_600_000) };
}
function user(over: Record<string, unknown> = {}) {
  return {
    role: 'OPERATOR', username: 'op', status: 'ENABLED', forcePasswordChange: false,
    passwordChangedAt: new Date(), createdAt: new Date(Date.now() - 400 * DAY), passwordExpiresAt: null, ...over,
  };
}

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(authPlugin);
  app.get('/api/stub', async (req: any) => ({ username: req.user.username }));
  await app.ready();
}, 60_000);
afterAll(async () => { await app?.close(); }, 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  invalidatePasswordPolicyCache();
  mockPrisma.session.update.mockResolvedValue({});
  mockPrisma.user.update.mockResolvedValue({});
});

const hit = () => app.inject({ method: 'GET', url: '/api/stub', headers: { authorization: 'Bearer t' } });

describe('missing config rows', () => {
  it('slides the session expiry by 8 h when there is no `session` row', async () => {
    const { sub, sessionId } = ids();
    mockVerifyToken.mockResolvedValue({ sub, sessionId, username: 'op', role: 'OPERATOR' });
    mockPrisma.session.findFirst.mockResolvedValue(live(sessionId));
    mockPrisma.user.findUnique.mockResolvedValue(user());
    mockPrisma.systemConfig.findFirst.mockResolvedValue(null);      // no session row
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);     // no policy row
    const before = Date.now();
    const res = await hit();
    expect(res.statusCode).toBe(200);
    const write = mockPrisma.session.update.mock.calls.find((c) => c[0].data.expiresAt)?.[0];
    expect(write.where).toEqual({ id: sessionId });
    expect(Math.abs(write.data.expiresAt.getTime() - (before + 8 * 3_600_000))).toBeLessThan(5_000);
  });

  it('applies a 90-day expiry when there is no `password-policy` row: 100 days is expired', async () => {
    const { sub, sessionId } = ids();
    mockVerifyToken.mockResolvedValue({ sub, sessionId, username: 'op', role: 'OPERATOR' });
    mockPrisma.session.findFirst.mockResolvedValue(live(sessionId));
    mockPrisma.user.findUnique.mockResolvedValue(user({ passwordChangedAt: new Date(Date.now() - 100 * DAY) }));
    mockPrisma.systemConfig.findFirst.mockResolvedValue({ configValue: { sessionDurationHours: 8 } });
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
    const res = await hit();
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('PASSWORD_EXPIRED');
    expect(mockPrisma.user.update).toHaveBeenCalledWith({ where: { id: sub }, data: { forcePasswordChange: true } });
  });

  it('...and 80 days is not', async () => {
    const { sub, sessionId } = ids();
    mockVerifyToken.mockResolvedValue({ sub, sessionId, username: 'op', role: 'OPERATOR' });
    mockPrisma.session.findFirst.mockResolvedValue(live(sessionId));
    mockPrisma.user.findUnique.mockResolvedValue(user({ passwordChangedAt: new Date(Date.now() - 80 * DAY) }));
    mockPrisma.systemConfig.findFirst.mockResolvedValue({ configValue: { sessionDurationHours: 8 } });
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
    const res = await hit();
    expect(res.statusCode).toBe(200);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe('user lookup', () => {
  it('401 ACCOUNT_INACTIVE when the token names a user that no longer exists', async () => {
    const { sub, sessionId } = ids();
    mockVerifyToken.mockResolvedValue({ sub, sessionId, username: 'gone', role: 'OPERATOR' });
    mockPrisma.session.findFirst.mockResolvedValue(live(sessionId));
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await hit();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
  });

  it('caches an ENABLED user for later requests, but invalidateUserAuthCache forces a re-read', async () => {
    const { sub, sessionId } = ids();
    mockVerifyToken.mockResolvedValue({ sub, sessionId, username: 'op', role: 'OPERATOR' });
    mockPrisma.session.findFirst.mockResolvedValue(live(sessionId));
    mockPrisma.user.findUnique.mockResolvedValue(user());
    mockPrisma.systemConfig.findFirst.mockResolvedValue({ configValue: { sessionDurationHours: 8 } });
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ configValue: { passwordExpiryDays: 90 }, updatedAt: new Date(0) });
    expect((await hit()).statusCode).toBe(200);
    // Disabled in the DB; the 30 s cache still admits the user...
    mockPrisma.user.findUnique.mockResolvedValue(user({ status: 'DISABLED' }));
    expect((await hit()).statusCode).toBe(200);
    expect(mockPrisma.session.findFirst).toHaveBeenCalledTimes(1); // session served from cache too
    // ...until the user is evicted.
    invalidateUserAuthCache(sub);
    expect((await hit()).json().error).toBe('ACCOUNT_INACTIVE');
    invalidateSessionAuthCache(sessionId);
  });
});
