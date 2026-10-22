/**
 * Branch coverage for the two auth sweeps (2026-10-21).
 *
 * Both are cron jobs that act on EVERY account / session in the database, so
 * running them for real against the shared test DB would end other suites'
 * sessions and notify their users. The database and the audit writer are
 * mocked at the module boundary (as the sibling sweep tests do), and each test
 * asserts the writes the sweep asks for.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma, mockRepo, mockAudit, mockNotify } = vi.hoisted(() => ({
  mockPrisma: {
    systemConfig: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    notification: { findFirst: vi.fn() },
    session: { findMany: vi.fn(), update: vi.fn() },
  },
  mockRepo: { getSessionConfig: vi.fn(), getPasswordPolicyConfig: vi.fn() },
  mockAudit: vi.fn(),
  mockNotify: vi.fn(),
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: mockAudit }));
vi.mock('../auth.repository.js', () => ({ authRepository: mockRepo }));
vi.mock('../../notifications/notification.service.js', () => ({ createNotification: mockNotify }));

import { sweepExpiredSessions } from '../session-sweep.js';
import { sweepPasswordExpiryNotifications } from '../password-expiry-sweep.js';

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

describe('sweepExpiredSessions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.session.findMany.mockResolvedValue([]);
  });

  const lastWhere = () => mockPrisma.session.findMany.mock.calls.at(-1)![0].where;
  const idleMinutes = (where: any) => {
    const idle = where.OR.find((c: any) => c.lastActiveAt);
    return idle ? Math.round((Date.now() - new Date(idle.lastActiveAt.lt).getTime()) / 60_000) : null;
  };

  it('reads the legacy `{ value: {...} }` session shape when the policy has no idle setting', async () => {
    mockRepo.getSessionConfig.mockResolvedValue({ value: { idleTimeoutMinutes: 40, autoLogoutEnabled: true } });
    mockRepo.getPasswordPolicyConfig.mockResolvedValue(null);
    await sweepExpiredSessions();
    expect(idleMinutes(lastWhere())).toBe(42);
    expect(lastWhere().isActive).toBe(true);
    expect(lastWhere().OR[0]).toEqual({ expiresAt: { lt: expect.any(Date) } });
  });

  it('falls back to 15 minutes (+2) when no idle time is configured anywhere, or it is not a number', async () => {
    mockRepo.getSessionConfig.mockResolvedValue(null);
    mockRepo.getPasswordPolicyConfig.mockResolvedValue({});
    await sweepExpiredSessions();
    expect(idleMinutes(lastWhere())).toBe(17);

    mockRepo.getPasswordPolicyConfig.mockResolvedValue({ idleTimeoutMinutes: 'abc' });
    await sweepExpiredSessions();
    expect(idleMinutes(lastWhere())).toBe(17);
  });

  it('ends each stale session, writes a LOGOUT row per session, and reports the count', async () => {
    mockRepo.getSessionConfig.mockResolvedValue({});
    mockRepo.getPasswordPolicyConfig.mockResolvedValue({ autoLogoutEnabled: false });
    mockPrisma.session.findMany.mockResolvedValue([
      { id: 's1', userId: 'u1', ipAddress: '10.1.1.1', userAgent: 'Tablet', user: { username: 'op1', role: 'OPERATOR' } },
      { id: 's2', userId: 'u2', ipAddress: null, userAgent: null, user: null },
    ]);
    const r = await sweepExpiredSessions();
    expect(r).toEqual({ swept: 2 });
    // Auto-logout off: only the hard-expiry condition is queried.
    expect(lastWhere().OR).toHaveLength(1);
    expect(mockPrisma.session.update.mock.calls.map((c) => c[0])).toEqual([
      { where: { id: 's1' }, data: { isActive: false, terminationReason: 'session_timeout' } },
      { where: { id: 's2' }, data: { isActive: false, terminationReason: 'session_timeout' } },
    ]);
    expect(mockAudit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      userId: 'op1', userRole: 'OPERATOR', action: 'LOGOUT', targetType: 'session', targetId: 's1',
      afterValue: { username: 'op1', reason: 'session_timeout' }, ipAddress: '10.1.1.1', userAgent: 'Tablet', sessionId: 's1',
      signatureMeaning: 'Session for "op1" terminated by server timeout',
    }));
    // A session whose user row is gone is still recorded, under its user id.
    expect(mockAudit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      userId: 'u2', userRole: 'UNKNOWN', ipAddress: '127.0.0.1', userAgent: undefined,
      signatureMeaning: 'Session for "u2" terminated by server timeout',
    }));
  });
});

describe('sweepPasswordExpiryNotifications — remaining branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.notification.findFirst.mockResolvedValue(null);
  });

  it('is off when there is no policy row at all', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
    expect(await sweepPasswordExpiryNotifications()).toEqual({ warned: 0, expired: 0 });
    expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
  });

  it('anchors on createdAt when the password was never changed, and names the user when fullName is missing', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ configValue: { passwordExpiryDays: 30, expiryNotificationDays: 5 }, updatedAt: undefined });
    const created = ago(60);
    mockPrisma.user.findMany.mockResolvedValue([{ username: 'NONAME', fullName: null, passwordChangedAt: null, createdAt: created }]);
    const r = await sweepPasswordExpiryNotifications();
    expect(r).toEqual({ warned: 0, expired: 1 });
    // Dedup looks for notices since the anchor (createdAt here).
    expect(mockPrisma.notification.findFirst.mock.calls[0][0].where.createdAt).toEqual({ gte: created });
    const admin = mockNotify.mock.calls.map((c) => c[0]).find((a) => a.forRole === 'ADMIN');
    expect(admin.message).toBe("NONAME's password has expired. They must set a new password at next login; reset it if they need help.");
  });

  it('sends only the missing side of the expired notice', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ configValue: { passwordExpiryDays: 30, expiryNotificationDays: 5 }, updatedAt: ago(400) });
    mockPrisma.user.findMany.mockResolvedValue([{ username: 'HALF', fullName: 'Half Done', passwordChangedAt: ago(45), createdAt: ago(45) }]);
    // user notice already sent, admin notice not yet
    mockPrisma.notification.findFirst.mockImplementation(async (args: any) => (args.where.forUserId ? { id: 'u' } : null));
    const r = await sweepPasswordExpiryNotifications();
    expect(r.expired).toBe(1);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toMatchObject({ forRole: 'ADMIN', targetUserId: 'HALF', title: 'Password expired — HALF' });
  });

  it('says "1 day" (singular) on the last day of the window', async () => {
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ configValue: { passwordExpiryDays: 30, expiryNotificationDays: 5 }, updatedAt: ago(400) });
    // 29.5 days ago -> ceil(0.5) = 1 day left.
    const changed = new Date(Date.now() - 29.5 * DAY);
    mockPrisma.user.findMany.mockResolvedValue([{ username: 'LAST', fullName: 'Last Day', passwordChangedAt: changed, createdAt: changed }]);
    const r = await sweepPasswordExpiryNotifications();
    expect(r).toEqual({ warned: 1, expired: 0 });
    expect(mockNotify.mock.calls[0][0]).toMatchObject({
      type: 'PASSWORD_EXPIRY_WARNING', title: 'Password expires in 1 day', forUserId: 'LAST', metadata: { kind: 'PASSWORD_EXPIRY_WARNING', daysLeft: 1 },
    });
  });
});
