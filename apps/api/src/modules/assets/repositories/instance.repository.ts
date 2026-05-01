import { prisma } from '../../../lib/prisma.js';
import { flattenFilterFields, flattenFilterFieldsAll } from '../../../lib/filter-details.js';

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
    return prisma.assetInstance.create({ data: data as any });
  },

  async update(id: string, data: Record<string, unknown>) {
    return prisma.assetInstance.update({ where: { id }, data: data as any });
  },

  async softDeleteMany(ids: string[], username: string) {
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
