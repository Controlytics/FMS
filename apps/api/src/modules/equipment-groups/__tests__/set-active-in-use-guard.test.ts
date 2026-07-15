import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    equipmentGroup: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    cleaningCycle: { count: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: vi.fn().mockResolvedValue(undefined) }));

import { EquipmentGroupsService } from '../equipment-groups.service.js';

const service = new EquipmentGroupsService();
const ctx = { userId: 'admin', userSub: 'sub-1', userRole: 'ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'sess-1' } as any;

const BLOCK = 'b1';

/**
 * Enterprise-audit finding (2026-07-15) + the gap found while fixing it.
 *
 * `delete()` refuses (409 IN_USE) while IN_PROGRESS cycles reference the group,
 * then soft-deletes by setting isActive=false. `setActive(ctx, id, false)`
 * performed that IDENTICAL mutation with no check, and the routes have different
 * gates (`PATCH /:id/active` = ASSET_UPDATE|EG_EDIT, `DELETE /:id` =
 * ASSET_DELETE|EG_DELETE) — ADMIN and SUPERVISOR hold edit but not delete.
 *
 * The filed guard is also aimed at the wrong cycles: cycles WITH a pinned
 * equipmentGroupId resolve config from the version snapshot regardless of
 * isActive, so they are immune. The cycles that actually break are the UNBOUND
 * ones (equipmentGroupId = NULL), which resolve a group from the block's ACTIVE
 * groups at advance() time — and NEITHER path guarded them. Zero active groups
 * is the only breaking count: assertSingleEquipmentGroupPerBlock rejects only
 * >1, and a lone remaining group simply binds.
 */
describe('equipment-group deactivation guards', () => {
  /** The tx handle prisma.$transaction hands the callback. */
  const txStub = () => ({
    equipmentGroup: {
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({}),
      count: mockPrisma.equipmentGroup.count,
    },
    cleaningCycle: { count: mockPrisma.cleaningCycle.count },
    $queryRaw: mockPrisma.$queryRaw,
  });

  let tx: ReturnType<typeof txStub>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.equipmentGroup.findFirst.mockResolvedValue({ id: 'g1', name: 'FD', blockId: BLOCK, isActive: true });
    mockPrisma.equipmentGroup.findUnique.mockResolvedValue({ id: 'g1', instruments: [] });
    mockPrisma.$queryRaw.mockResolvedValue([]);
    tx = txStub();
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    // Default: no cycles anywhere, one sibling still active.
    cycleCounts({});
    mockPrisma.equipmentGroup.count.mockResolvedValue(1);
  });

  /**
   * Answer cleaningCycle.count from the WHERE clause rather than a
   * mockResolvedValueOnce queue: vi.clearAllMocks() does not drain Once queues,
   * so a queue outliving its test silently feeds the next one (it masked a real
   * mutation here). This is order- and call-count-independent.
   */
  const cycleCounts = ({ pinned = 0, unbound = 0 }: { pinned?: number; unbound?: number }) => {
    mockPrisma.cleaningCycle.count.mockImplementation(async ({ where }: any) =>
      where.equipmentGroupId === null ? unbound : pinned,
    );
  };

  // ── pinned-cycle guard (the filed finding) ──
  describe('setActive(false) — parity with delete()', () => {
    it('refuses to disable a group referenced by IN_PROGRESS cycles', async () => {
      cycleCounts({ pinned: 8 });

      await expect(service.setActive(ctx, 'g1', false)).rejects.toMatchObject({ statusCode: 409, code: 'IN_USE' });
      expect(tx.equipmentGroup.update).not.toHaveBeenCalled();
    });

    it('counts exactly the cycles delete() counts', async () => {
      await service.setActive(ctx, 'g1', false);

      expect(mockPrisma.cleaningCycle.count).toHaveBeenCalledWith({
        where: { equipmentGroupId: 'g1', status: 'IN_PROGRESS' },
      });
    });

    it('allows disabling when nothing references the group', async () => {
      await service.setActive(ctx, 'g1', false);
      expect(tx.equipmentGroup.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { isActive: false } });
    });
  });

  // ── block-fallback guard (the gap neither path had) ──
  describe('last-active-group guard for unbound cycles', () => {
    /** No sibling left active, and `n` unbound in-progress cycles in the block. */
    const lastGroupWithUnbound = (n: number) => {
      mockPrisma.equipmentGroup.count.mockResolvedValue(0); // no other active group
      cycleCounts({ pinned: 0, unbound: n });
    };

    it('refuses to disable the block\'s LAST active group when unbound cycles exist', async () => {
      lastGroupWithUnbound(3);

      await expect(service.setActive(ctx, 'g1', false)).rejects.toMatchObject({ statusCode: 409, code: 'IN_USE' });
      expect(tx.equipmentGroup.update).not.toHaveBeenCalled();
    });

    it('refuses to DELETE the block\'s last active group too — same guard, both doors', async () => {
      lastGroupWithUnbound(3);

      await expect(service.delete(ctx, 'g1')).rejects.toMatchObject({ statusCode: 409, code: 'IN_USE' });
      expect(tx.equipmentGroup.update).not.toHaveBeenCalled();
    });

    it('scopes the unbound-cycle lookup to this block and to cycles with no group', async () => {
      lastGroupWithUnbound(1);
      await service.setActive(ctx, 'g1', false).catch(() => {});

      expect(mockPrisma.cleaningCycle.count).toHaveBeenLastCalledWith({
        where: { cleaningAreaId: BLOCK, equipmentGroupId: null, status: 'IN_PROGRESS' },
      });
    });

    // The predicate must not be over-broad: 2 active groups -> 1 is exactly how
    // an operator legitimately switches a block's group (and how the pending
    // MUPS two-active-groups fix is applied). Only 1 -> 0 breaks.
    it('ALLOWS disabling when a sibling group stays active, even with unbound cycles', async () => {
      mockPrisma.equipmentGroup.count.mockResolvedValue(1); // a sibling remains
      cycleCounts({ pinned: 0, unbound: 5 }); // unbound cycles exist but are safe

      await service.setActive(ctx, 'g1', false);
      expect(tx.equipmentGroup.update).toHaveBeenCalled();
      // Never needed to ask about unbound cycles — a group remains to bind to.
      expect(mockPrisma.cleaningCycle.count).toHaveBeenCalledTimes(1);
    });

    it('allows disabling the last active group when NO unbound cycles exist', async () => {
      mockPrisma.equipmentGroup.count.mockResolvedValue(0);
      cycleCounts({ pinned: 0, unbound: 0 });

      await service.setActive(ctx, 'g1', false);
      expect(tx.equipmentGroup.update).toHaveBeenCalled();
    });

    it('skips the check for an already-inactive group (deactivating is a no-op)', async () => {
      mockPrisma.equipmentGroup.findFirst.mockResolvedValue({ id: 'g1', name: 'FD', blockId: BLOCK, isActive: false });

      await service.setActive(ctx, 'g1', false);
      expect(mockPrisma.equipmentGroup.count).not.toHaveBeenCalled();
    });
  });

  // ── TOCTOU ──
  it('locks the block\'s groups before reading the active count', async () => {
    await service.setActive(ctx, 'g1', false);

    expect(mockPrisma.$queryRaw).toHaveBeenCalled();
    // The lock must precede the reads it protects, inside the same transaction.
    const lockOrder = mockPrisma.$queryRaw.mock.invocationCallOrder[0];
    const countOrder = mockPrisma.cleaningCycle.count.mock.invocationCallOrder[0];
    expect(lockOrder).toBeLessThan(countOrder);
  });

  // ── enable branch ──
  // Enabling turns THIS group on, so the block always ends with exactly one
  // active group — the zero-active state is unreachable from this branch.
  it('does not apply the guard when ENABLING', async () => {
    await service.setActive(ctx, 'g1', true);

    expect(mockPrisma.cleaningCycle.count).not.toHaveBeenCalled();
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(tx.equipmentGroup.updateMany).toHaveBeenCalled();
  });

  it('still 404s for an unknown group before touching cycles', async () => {
    mockPrisma.equipmentGroup.findFirst.mockResolvedValue(null);

    await expect(service.setActive(ctx, 'nope', false)).rejects.toMatchObject({ statusCode: 404 });
    expect(mockPrisma.cleaningCycle.count).not.toHaveBeenCalled();
  });
});
