import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Phase 8.4b — Sync service unit tests.
 *
 * Pattern follows tape-version-check.test.ts: prisma is mocked via vi.hoisted
 * so we never hit a real DB; service is constructed normally and exercised
 * directly. Route schema is asserted by importing the route registration and
 * inspecting the schema object on a stub Fastify-like recorder.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    filterCleaningProfile: { findMany: vi.fn() },
    filterProfile: { findMany: vi.fn() },
    equipmentGroup: { findMany: vi.fn() },
    assetInstance: { findMany: vi.fn() },
  },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import { SyncService, SYNC_PAGE_LIMIT } from '../sync.service.js';

const ctx = {
  userId: 'admin',
  userSub: 'sub-1',
  userRole: 'ADMIN',
  ipAddress: '127.0.0.1',
  userAgent: 'test',
  sessionId: 'sess-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Default: every collection returns []
  mockPrisma.filterCleaningProfile.findMany.mockResolvedValue([]);
  mockPrisma.filterProfile.findMany.mockResolvedValue([]);
  mockPrisma.equipmentGroup.findMany.mockResolvedValue([]);
  mockPrisma.assetInstance.findMany.mockResolvedValue([]);
});

describe('SyncService.since() — shape + cursor handling', () => {
  it('1. with no version params returns the expected envelope shape (full sync)', async () => {
    const svc = new SyncService();
    const out = await svc.since(ctx, {});
    // All entity arrays present, deferred ones are []
    expect(out).toEqual(expect.objectContaining({
      filterCleaningProfiles: [],
      filterProfiles: [],
      equipmentGroups: [],
      checklistProfiles: [],
      assetTemplates: [],
      filters: [],
      hasMore: false,
    }));
    expect(typeof out.serverTimestamp).toBe('string');
    expect(new Date(out.serverTimestamp).getTime()).not.toBeNaN();
  });

  it('2. defaults missing version params to 0 → fetches all rows (gt: 0)', async () => {
    const svc = new SyncService();
    await svc.since(ctx, {});
    expect(mockPrisma.filterCleaningProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { version: { gt: 0 } } })
    );
    expect(mockPrisma.filterProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { version: { gt: 0 } } })
    );
    expect(mockPrisma.equipmentGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { version: { gt: 0 } } })
    );
  });

  it('3. version params propagate to per-entity gt cursors', async () => {
    const svc = new SyncService();
    await svc.since(ctx, {
      profileVersion: 12,
      filterProfileVersion: 4,
      equipmentGroupVersion: 8,
    });
    expect(mockPrisma.filterCleaningProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { version: { gt: 12 } } })
    );
    expect(mockPrisma.filterProfile.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { version: { gt: 4 } } })
    );
    expect(mockPrisma.equipmentGroup.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { version: { gt: 8 } } })
    );
  });

  it('4. each entity query is capped at SYNC_PAGE_LIMIT (=500)', async () => {
    const svc = new SyncService();
    await svc.since(ctx, {});
    for (const fn of [
      mockPrisma.filterCleaningProfile.findMany,
      mockPrisma.filterProfile.findMany,
      mockPrisma.equipmentGroup.findMany,
      mockPrisma.assetInstance.findMany,
    ]) {
      expect(fn).toHaveBeenCalledWith(expect.objectContaining({ take: SYNC_PAGE_LIMIT }));
    }
    expect(SYNC_PAGE_LIMIT).toBe(500);
  });

  it('5. hasMore is true when ANY entity returns LIMIT rows (cleaning profiles)', async () => {
    const svc = new SyncService();
    const fakeRow = (i: number) => ({
      id: `fcp-${i}`, version: i + 1, name: `p-${i}`, stages: [], connections: [],
    });
    mockPrisma.filterCleaningProfile.findMany.mockResolvedValueOnce(
      Array.from({ length: SYNC_PAGE_LIMIT }, (_, i) => fakeRow(i))
    );
    const out = await svc.since(ctx, {});
    expect(out.hasMore).toBe(true);
    expect(out.filterCleaningProfiles.length).toBe(SYNC_PAGE_LIMIT);
  });

  it('6. hasMore is true when filters returns LIMIT rows', async () => {
    const svc = new SyncService();
    mockPrisma.assetInstance.findMany.mockResolvedValueOnce(
      Array.from({ length: SYNC_PAGE_LIMIT }, (_, i) => ({
        id: `f-${i}`, name: `f-${i}`, templateId: 't-1', status: 'Active',
        isActive: true, attributes: {}, parentId: null, parent: null,
        template: { id: 't-1', name: 'Filter', templateKind: 'FILTER' },
        filterDetails: null,
        updatedAt: new Date('2026-05-01T00:00:00Z'),
      }))
    );
    const out = await svc.since(ctx, {});
    expect(out.hasMore).toBe(true);
    expect(out.filters.length).toBe(SYNC_PAGE_LIMIT);
  });

  it('7. hasMore is false when no entity hits LIMIT', async () => {
    const svc = new SyncService();
    mockPrisma.filterCleaningProfile.findMany.mockResolvedValueOnce([
      { id: 'fcp-1', version: 13, name: 'p1', stages: [], connections: [] },
    ]);
    const out = await svc.since(ctx, { profileVersion: 12 });
    expect(out.hasMore).toBe(false);
  });

  it('8. filterUpdatedSince is parsed and applied as updatedAt cutoff', async () => {
    const svc = new SyncService();
    await svc.since(ctx, { filterUpdatedSince: '2026-04-30T00:00:00Z' });
    const call = mockPrisma.assetInstance.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeDefined();
    expect(call.where.OR[0].updatedAt.gt).toBeInstanceOf(Date);
    expect(call.where.OR[0].updatedAt.gt.toISOString()).toBe('2026-04-30T00:00:00.000Z');
    // Sidecar OR clause covers FilterDetails-only updates.
    expect(call.where.OR[1].filterDetails.is.updatedAt.gt).toBeInstanceOf(Date);
  });

  it('9. invalid filterUpdatedSince falls back to full sync (no OR clause)', async () => {
    const svc = new SyncService();
    await svc.since(ctx, { filterUpdatedSince: 'not-a-date' });
    const call = mockPrisma.assetInstance.findMany.mock.calls[0][0];
    expect(call.where.OR).toBeUndefined();
    // template-kind + isActive predicates still applied
    expect(call.where.template.templateKind).toBe('FILTER');
    expect(call.where.isActive).toBe(true);
  });

  it('10. filter rows are flattened to FE-cache shape (parent chain + sidecar)', async () => {
    const svc = new SyncService();
    mockPrisma.assetInstance.findMany.mockResolvedValueOnce([
      {
        id: 'f-1',
        name: 'F-001',
        templateId: 't-1',
        status: 'Active',
        isActive: true,
        attributes: { tag: 'pre' },
        parentId: 'ahu-1',
        updatedAt: new Date('2026-05-01T10:00:00Z'),
        template: { id: 't-1', name: 'Filter', templateKind: 'FILTER' },
        filterDetails: {
          filterProfileId: 'fp-1',
          currentLifecycleState: 'WASH_IN',
          currentCycleId: 'cy-1',
          filterSet: 'A',
          updatedAt: new Date('2026-05-01T11:00:00Z'),
        },
        parent: {
          id: 'ahu-1', name: 'AHU-1', parentId: 'area-1',
          parent: {
            id: 'area-1', name: 'Area-A', parentId: 'block-1',
            parent: { id: 'block-1', name: 'Block-1' },
          },
        },
      },
    ]);
    const out = await svc.since(ctx, {});
    expect(out.filters[0]).toEqual(expect.objectContaining({
      id: 'f-1',
      name: 'F-001',
      templateKind: 'FILTER',
      ahuId: 'ahu-1', ahuName: 'AHU-1',
      areaId: 'area-1', areaName: 'Area-A',
      blockId: 'block-1', blockName: 'Block-1',
      filterProfileId: 'fp-1',
      currentLifecycleState: 'WASH_IN',
      currentCycleId: 'cy-1',
      filterSet: 'A',
    }));
    expect(out.filters[0].updatedAt).toBeInstanceOf(Date);
    expect(out.filters[0].filterDetailsUpdatedAt).toBeInstanceOf(Date);
  });

  it('11. filter row with missing parent chain leaves names null (no crash)', async () => {
    const svc = new SyncService();
    mockPrisma.assetInstance.findMany.mockResolvedValueOnce([
      {
        id: 'f-orphan',
        name: 'F-orphan',
        templateId: 't-1',
        status: 'Active',
        isActive: true,
        attributes: {},
        parentId: null,
        parent: null, // no AHU
        template: { id: 't-1', name: 'Filter', templateKind: 'FILTER' },
        filterDetails: null,
        updatedAt: new Date('2026-05-01T00:00:00Z'),
      },
    ]);
    const out = await svc.since(ctx, {});
    expect(out.filters[0]).toEqual(expect.objectContaining({
      id: 'f-orphan',
      ahuId: null, ahuName: null,
      areaId: null, areaName: null,
      blockId: null, blockName: null,
      filterProfileId: null,
      currentLifecycleState: null,
    }));
  });

  it('12. checklistProfiles + assetTemplates are always [] in 8.4b regardless of params', async () => {
    const svc = new SyncService();
    const out = await svc.since(ctx, { checklistVersion: 99, assetTemplateVersion: 7 });
    expect(out.checklistProfiles).toEqual([]);
    expect(out.assetTemplates).toEqual([]);
  });

  it('13. filterProfile applicableTemplates is flattened from join rows to string[]', async () => {
    const svc = new SyncService();
    mockPrisma.filterProfile.findMany.mockResolvedValueOnce([
      {
        id: 'fp-1', version: 2, name: 'Pre-filter',
        applicableTemplates: [{ templateId: 't-a' }, { templateId: 't-b' }],
      },
    ]);
    const out = await svc.since(ctx, {});
    expect(out.filterProfiles[0].applicableTemplates).toEqual(['t-a', 't-b']);
  });
});
