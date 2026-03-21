import { prisma } from '../../../lib/prisma.js';

export const instanceRepository = {
  async findMany(where: Record<string, unknown>, page: number, limit?: number) {
    const [instances, total] = await Promise.all([
      prisma.assetInstance.findMany({
        where: where as any,
        include: { template: { select: { name: true, icon: true } }, _count: { select: { children: true } } },
        orderBy: { createdAt: 'desc' },
        ...(limit ? { skip: (page - 1) * limit, take: limit } : {}),
      }),
      prisma.assetInstance.count({ where: where as any }),
    ]);
    return { instances, total };
  },

  async findTree(filter?: Record<string, unknown>) {
    return prisma.assetInstance.findMany({
      where: { isActive: true, ...filter },
      select: {
        id: true,
        name: true,
        parentId: true,
        templateId: true,
        status: true,
        template: { select: { name: true, icon: true } },
        _count: { select: { children: true } },
      },
      orderBy: { name: 'asc' },
    });
  },

  async findById(id: string) {
    return prisma.assetInstance.findUnique({
      where: { id },
      include: {
        template: {
          select: {
            id: true, name: true, icon: true,
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
        _count: { select: { children: true, sourceRelations: true } },
      },
    });
  },

  async findByIdSimple(id: string) {
    return prisma.assetInstance.findUnique({ where: { id } });
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
    return prisma.assetInstance.findMany({
      where: { parentId, isActive: true },
      select: {
        id: true,
        name: true,
        templateId: true,
        status: true,
        isActive: true,
        template: { select: { name: true, icon: true } },
        _count: { select: { children: true } },
      },
      orderBy: { name: 'asc' },
    });
  },
};
