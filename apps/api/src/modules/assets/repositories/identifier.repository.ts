import { prisma } from '../../../lib/prisma.js';

export const identifierRepository = {
  async findMany(where: Record<string, unknown>) {
    return prisma.assetIdentifier.findMany({
      where: where as any,
      // approvalStatus / status / isActive (2026-09-25): the scan surfaces build
      // their tag → filter map from this list and must refuse a tag on a
      // filter that is still in the creation workflow BEFORE queueing it —
      // audit web F3 (the gate lived only on the write, as a 409 after scan).
      include: { asset: { select: { id: true, name: true, approvalStatus: true, status: true, isActive: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async findByValue(value: string) {
    return prisma.assetIdentifier.findUnique({
      where: { identifierValue: value },
      include: {
        asset: {
          include: {
            template: {
              select: { id: true, name: true, icon: true, attributeSchema: true },
            },
            parent: { select: { id: true, name: true } },
            identifiers: true,
          },
        },
      },
    });
  },

  async findById(id: string) {
    return prisma.assetIdentifier.findUnique({ where: { id } });
  },

  async findByIdentifierValue(value: string) {
    return prisma.assetIdentifier.findUnique({ where: { identifierValue: value } });
  },

  async create(data: {
    assetId: string;
    identifierType: string;
    identifierValue: string;
    label?: string;
    isPrimary?: boolean;
    createdBy: string;
  }) {
    return prisma.assetIdentifier.create({ data });
  },

  async delete(id: string) {
    return prisma.assetIdentifier.delete({ where: { id } });
  },

  async deleteByAssetIds(ids: string[]) {
    return prisma.assetIdentifier.deleteMany({
      where: { assetId: { in: ids } },
    });
  },
};
