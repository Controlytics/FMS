import { prisma } from '../../../lib/prisma.js';
import { flattenFilterFields, flattenFilterFieldsAll } from '../../../lib/filter-details.js';
// A-01 Phase 2 Tier 1 ACTIVATED (Tier 1.5 follow-up, 2026-05-29).
// update dual-writes to the typed hierarchy table
// (blocks/areas/ahus/filters) AND the legacy asset_instances table inside a
// single transaction. OTHER-kind asset_instances stay on the legacy table only
// (per D-decision D1=C). Reads still hit asset_instances directly — that's
// deferred to later Phase 2 tiers. There is no `create` here (removed
// 2026-10-22, D-LIB-1): it had no caller — instance.service.ts creates with
// tx.assetInstance.create and the forward mirror writes the typed row — and its
// typed-first dual write collided with the FILTER reverse mirror (P2002).
// No softDeleteMany either (removed 2026-10-22, no caller): soft-deletes run
// in instance.service.ts and filter.service.ts, each through a mirror.
import { dispatchUpdate } from '../../../lib/typed-asset-dispatch.js';

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
      // templateKind lets audit rows name the specific kind (Block / Area / AHU /
      // Filter) of the parent/child in a hierarchy-link audit.
      select: { name: true, template: { select: { templateKind: true } } },
    });
  },

  async update(id: string, data: Record<string, unknown>) {
    return dispatchUpdate(id, data);
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
