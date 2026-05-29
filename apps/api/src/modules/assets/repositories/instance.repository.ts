import { prisma } from '../../../lib/prisma.js';
import { flattenFilterFields, flattenFilterFieldsAll } from '../../../lib/filter-details.js';
// A-01 Phase 2 Tier 1 (2026-05-29): typed-asset-dispatch helper is staged
// at apps/api/src/lib/typed-asset-dispatch.ts and verified end-to-end
// against the live DB (create + update + soft-delete all round-trip
// correctly to both asset_instances AND typed tables). Activation here is
// gated on updating 28 test mocks in this module's __tests__ to include
// prisma.assetTemplate.findUnique + prisma.$transaction stubs. Tracked as
// Tier 1.5 follow-up — see tasks/A-01-PHASE-2-PLAN.md.
//   import {
//     dispatchCreate, dispatchUpdate, dispatchSoftDeleteMany,
//   } from '../../../lib/typed-asset-dispatch.js';

// Filter-specific fields live on `FilterDetails` (1:1 sidecar) since Step 6.
// Repositories ALWAYS include filterDetails and flatten before returning so
// the API response shape stays compatible with the pre-split contract
// (frontend reads filterProfileId / currentLifecycleState / currentCycleId /
// filterSet directly off the instance).

export const instanceRepository = {
  async findMany(where: Record<string, unknown>, page: number, limit?: number) {
    const [instances, total] = await Promise.all([
      prisma.assetInstance.findMany({
        where: where as any,
        include: {
          template: { select: { name: true, icon: true, templateKind: true } },
          filterDetails: { select: { filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true } },
          _count: { select: { children: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...(limit ? { skip: (page - 1) * limit, take: limit } : {}),
      }),
      prisma.assetInstance.count({ where: where as any }),
    ]);
    return { instances: flattenFilterFieldsAll(instances), total };
  },

  async findTree(filter?: Record<string, unknown>) {
    const rows = await prisma.assetInstance.findMany({
      where: { isActive: true, ...filter },
      select: {
        id: true,
        name: true,
        parentId: true,
        templateId: true,
        status: true,
        template: { select: { name: true, icon: true, templateKind: true } },
        filterDetails: { select: { filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true } },
        _count: { select: { children: { where: { isActive: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return flattenFilterFieldsAll(rows);
  },

  async findById(id: string) {
    const row = await prisma.assetInstance.findUnique({
      where: { id },
      include: {
        template: {
          select: {
            id: true, name: true, icon: true, templateKind: true,
            attributeSchema: true, telemetrySchema: true, checklistSchema: true,
            expectedIdentifiers: true, version: true,
            maxConnections: true, maxParentConnections: true,
          },
        },
        parent: { select: { id: true, name: true, templateId: true } },
        sourceRelations: {
          include: { targetAsset: { select: { id: true, name: true } } },
        },
        targetRelations: {
          include: { sourceAsset: { select: { id: true, name: true } } },
        },
        identifiers: true,
        filterDetails: { select: { filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true } },
        _count: { select: { children: true, sourceRelations: true } },
      },
    });
    return row ? flattenFilterFields(row) : null;
  },

  async findByIdSimple(id: string) {
    const row = await prisma.assetInstance.findUnique({
      where: { id },
      include: { filterDetails: { select: { filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true } } },
    });
    return row ? flattenFilterFields(row) : null;
  },

  async findByIdWithName(id: string) {
    return prisma.assetInstance.findUnique({
      where: { id },
      select: { name: true },
    });
  },

  async create(data: Record<string, unknown>) {
    // Tier 1.5 will swap to dispatchCreate(data as any) once test mocks land.
    return prisma.assetInstance.create({ data: data as any });
  },

  async update(id: string, data: Record<string, unknown>) {
    // Tier 1.5 will swap to dispatchUpdate(id, data) once test mocks land.
    return prisma.assetInstance.update({ where: { id }, data: data as any });
  },

  async softDeleteMany(ids: string[], username: string) {
    // Tier 1.5 will swap to dispatchSoftDeleteMany(ids, username) once test mocks land.
    return prisma.assetInstance.updateMany({
      where: { id: { in: ids } },
      data: { isActive: false, updatedBy: username },
    });
  },

  async findChildren(parentId: string) {
    const rows = await prisma.assetInstance.findMany({
      where: { parentId, isActive: true },
      select: {
        id: true,
        name: true,
        templateId: true,
        status: true,
        isActive: true,
        template: { select: { name: true, icon: true, templateKind: true } },
        filterDetails: { select: { filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true } },
        _count: { select: { children: { where: { isActive: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return flattenFilterFieldsAll(rows);
  },
};
