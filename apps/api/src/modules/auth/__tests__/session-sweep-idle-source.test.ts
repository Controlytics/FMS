/**
 * OQ-12 (QA 2026-10-19): the server idle sweep must use the idle timeout admins
 * edit (Password Policy — the same value the web idle timer reads), not the old
 * `session` row, which has no editing page. Before, the two disagreed (live
 * baseline: password-policy 10 min, session 20 min).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma, mockRepo } = vi.hoisted(() => ({
  mockPrisma: { session: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn() } },
  mockRepo: { getSessionConfig: vi.fn(), getPasswordPolicyConfig: vi.fn() },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn() }));
vi.mock('../auth.repository.js', () => ({ authRepository: mockRepo }));

import { sweepExpiredSessions } from '../session-sweep.js';

/** The idle cutoff the sweep queried for, in minutes before now. */
async function idleCutoffMinutes(): Promise<number | null> {
  const before = Date.now();
  await sweepExpiredSessions();
  const where = mockPrisma.session.findMany.mock.calls.at(-1)![0].where;
  const idle = where.OR.find((c: any) => c.lastActiveAt);
  if (!idle) return null;
  return Math.round((before - new Date(idle.lastActiveAt.lt).getTime()) / 60_000);
}

describe('session sweep idle source (OQ-12)', () => {
  beforeEach(() => { mockPrisma.session.findMany.mockClear(); });

  it('uses the Password Policy idle timeout (+2 min grace), not the session row', async () => {
    mockRepo.getSessionConfig.mockResolvedValue({ idleTimeoutMinutes: 60, autoLogoutEnabled: true });
    mockRepo.getPasswordPolicyConfig.mockResolvedValue({ idleTimeoutMinutes: 10, autoLogoutEnabled: true });
    expect(await idleCutoffMinutes()).toBe(12);
  });

  it('honours auto-logout OFF from the Password Policy', async () => {
    mockRepo.getSessionConfig.mockResolvedValue({ idleTimeoutMinutes: 60, autoLogoutEnabled: true });
    mockRepo.getPasswordPolicyConfig.mockResolvedValue({ idleTimeoutMinutes: 10, autoLogoutEnabled: false });
    expect(await idleCutoffMinutes()).toBeNull();
  });

  it('falls back to the session row only when the policy has no value', async () => {
    mockRepo.getSessionConfig.mockResolvedValue({ idleTimeoutMinutes: 30 });
    mockRepo.getPasswordPolicyConfig.mockResolvedValue({ minLength: 8 });
    expect(await idleCutoffMinutes()).toBe(32);
  });
});
