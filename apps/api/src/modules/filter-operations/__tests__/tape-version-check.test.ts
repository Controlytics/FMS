import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Phase 8.3 — server-side tape-version concurrency check.
 *
 * Tests the assertTapeVersionFresh() helper inside the 4 write methods via
 * terminateCycle() — chosen because it has the smallest dependency surface
 * (no cleaning-profile pipeline lookup), so the concurrency-check path is
 * exercised cleanly without unrelated mocks.
 *
 * Mocking pattern follows get-current-state.test.ts: prisma + audit + the
 * idempotency helper are mocked; service is constructed normally.
 */

const { mockPrisma, mockAuditLog, mockFindExistingByClientOpId } = vi.hoisted(() => ({
  mockPrisma: {
    assetInstance: { findFirst: vi.fn(), findUnique: vi.fn() },
    cleaningCycle: { findUnique: vi.fn(), findFirst: vi.fn(), count: vi.fn(), update: vi.fn() },
    equipmentGroup: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    equipmentGroupVersion: { findUnique: vi.fn() },
    filterCleaningProfile: { findUnique: vi.fn() },
    filterProfile: { findUnique: vi.fn() },
    filterEvent: { findFirst: vi.fn(), findMany: vi.fn(), count: vi.fn(), create: vi.fn() },
    filterDetails: { update: vi.fn() },
    checklistProfile: { findMany: vi.fn() },
    checklistProfileVersion: { findMany: vi.fn() },
    pmScheduleEntry: { findFirst: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  mockAuditLog: vi.fn(),
  mockFindExistingByClientOpId: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));
vi.mock('../../../lib/idempotency.js', () => ({ findExistingByClientOpId: mockFindExistingByClientOpId }));

import { FilterOperationsService } from '../filter-operations.service.js';

const ctx = { userId: 'admin', userSub: 'sub-1', userRole: 'ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'sess-1' };

const FILTER_ID = 'filter-1';
const CYCLE_ID = 'cycle-1';

const VALID_JUSTIFICATION = 'Operator-initiated termination — equipment offline.';

function setupBaselineMocks(opts: {
  cycleProfileVersion: number;
  filterEventCount: number;
}) {
  // getFilter() — has an active cycle.
  mockPrisma.assetInstance.findFirst.mockResolvedValue({
    id: FILTER_ID,
    name: 'F-001',
    parentId: null,
    filterDetails: {
      filterProfileId: 'fp-1',
      currentLifecycleState: 'WASH_IN',
      currentCycleId: CYCLE_ID,
      filterSet: 'A',
    },
  });
  // assertTapeVersionFresh() inputs.
  mockPrisma.cleaningCycle.findUnique.mockResolvedValue({
    id: CYCLE_ID,
    profileVersion: opts.cycleProfileVersion,
  });
  mockPrisma.filterEvent.count.mockResolvedValue(opts.filterEventCount);
  // Idempotency: never previously seen.
  mockFindExistingByClientOpId.mockResolvedValue(null);
  // Transaction: just invoke the callback so the txn body runs against the
  // (mocked) tx.* fields. We give the callback a tx object that proxies to
  // mockPrisma's per-table mocks.
  mockPrisma.$transaction.mockImplementation(async (cb: any) => {
    return cb({
      cleaningCycle: { update: vi.fn().mockResolvedValue({}) },
      filterDetails: { update: vi.fn().mockResolvedValue({}) },
      filterEvent: { create: vi.fn().mockResolvedValue({}) },
    });
  });
  // For getCurrentState() final call — make it return null cycle so the
  // happy-path doesn't fail mid-render. The check we care about runs BEFORE
  // the txn, so a cycle=null final getCurrentState is fine for these tests.
  mockPrisma.cleaningCycle.findFirst.mockResolvedValue(null);
  mockPrisma.systemConfig.findUnique.mockResolvedValue(null);
  mockPrisma.pmScheduleEntry.findFirst.mockResolvedValue(null);
  mockPrisma.filterEvent.findFirst.mockResolvedValue(null);
  mockPrisma.cleaningCycle.count.mockResolvedValue(0);
  mockPrisma.equipmentGroup.findFirst.mockResolvedValue(null);
  mockPrisma.equipmentGroup.findMany.mockResolvedValue([]);
  // Final getCurrentState() also walks parents via findUnique. Stop the loop
  // by returning a non-BLOCK with no parent.
  mockPrisma.assetInstance.findUnique.mockResolvedValue({
    id: FILTER_ID, name: 'F-001', parentId: null, template: { templateKind: 'FILTER' },
  });
}

describe('Phase 8.3 — server tape-version concurrency check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. tapeVersion matches → write proceeds (no STALE_TAPE)', async () => {
    // Phase 8.4 M3: profileVersion=2, filterEventCount=5
    // → tapeVersion = 2 * 1_000_000 + 5 = 2_000_005.
    setupBaselineMocks({ cycleProfileVersion: 2, filterEventCount: 5 });
    const service = new FilterOperationsService();
    await expect(
      service.terminateCycle(ctx, FILTER_ID, { justification: VALID_JUSTIFICATION, tapeVersion: 2_000_005 }),
    ).resolves.not.toThrow();
    // Concurrency check ran: count called once with the cycle scope.
    expect(mockPrisma.filterEvent.count).toHaveBeenCalledWith({ where: { filterId: FILTER_ID, cycleId: CYCLE_ID } });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('2. tapeVersion mismatched → 409 STALE_TAPE with currentTapeVersion in details', async () => {
    // Live tapeVersion = 2_000_005 but client sent 2_000_003 (stale).
    setupBaselineMocks({ cycleProfileVersion: 2, filterEventCount: 5 });
    const service = new FilterOperationsService();
    await expect(
      service.terminateCycle(ctx, FILTER_ID, { justification: VALID_JUSTIFICATION, tapeVersion: 2_000_003 }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'STALE_TAPE',
      details: { currentTapeVersion: 2_000_005 },
    });
    // Critically: the mismatch must reject BEFORE the transaction runs.
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('3. tapeVersion absent → write proceeds (backward compat for pre-cutover callers)', async () => {
    setupBaselineMocks({ cycleProfileVersion: 2, filterEventCount: 5 });
    const service = new FilterOperationsService();
    await expect(
      service.terminateCycle(ctx, FILTER_ID, { justification: VALID_JUSTIFICATION }),
    ).resolves.not.toThrow();
    // No staleness check fired — the count query is skipped entirely.
    expect(mockPrisma.filterEvent.count).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
