/**
 * Filter Profile Service — CRUD + assignment for filter profiles.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';



function orgFilter(ctx: RequestContext) {
  if (ctx.scope === 'GLOBAL') return {};
  return { organizationId: ctx.organizationId };
}

export class FilterProfileService {
  async list(ctx: RequestContext, query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: any = { ...orgFilter(ctx) };

    const [data, total] = await Promise.all([
      prisma.filterProfile.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.filterProfile.count({ where }),
    ]);

    // Enrich with cleaning profile name and active filter count
    const enriched = await Promise.all(data.map(async (fp) => {
      const cleaningProfile = await prisma.filterCleaningProfile.findUnique({
        where: { id: fp.cleaningProfileId },
        select: { name: true },
      });
      const activeFilterCount = await prisma.assetInstance.count({
        where: { filterProfileId: fp.id },
      });
      return {
        ...fp,
        cleaningProfileName: cleaningProfile?.name ?? 'Unknown',
        activeFilterCount,
      };
    }));

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getById(ctx: RequestContext, id: string) {
    const fp = await prisma.filterProfile.findFirst({
      where: { id, ...orgFilter(ctx) },
    });
    if (!fp) throw new AppError(404, 'NOT_FOUND', 'Filter profile not found');
    return fp;
  }

  async create(ctx: RequestContext, data: any) {
    const { name, description, cleaningProfileId, applicableTemplates, blockRestriction, allowedBlocks, maxCleaningCycles } = data;

    // Verify cleaning profile exists
    const cp = await prisma.filterCleaningProfile.findFirst({
      where: { id: cleaningProfileId, status: 'ACTIVE' },
    });
    if (!cp) throw new AppError(400, 'VALIDATION_ERROR', 'Referenced cleaning profile not found or not active');

    const fp = await prisma.filterProfile.create({
      data: {
        name,
        description,
        cleaningProfileId,
        applicableTemplates: applicableTemplates ?? [],
        blockRestriction: blockRestriction ?? 'OWN_BLOCK_ONLY',
        allowedBlocks: allowedBlocks ?? undefined,
        maxCleaningCycles,
        organizationId: ctx.organizationId || ((await prisma.organization.findFirst({ select: { id: true } }))?.id ?? ''),
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CREATED',
      targetType: 'filter_profile', targetId: fp.id,
      afterValue: { name, cleaningProfileId },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return fp;
  }

  async update(ctx: RequestContext, id: string, data: any) {
    const existing = await this.getById(ctx, id);

    const updated = await prisma.filterProfile.update({
      where: { id },
      data: {
        name: data.name ?? existing.name,
        description: data.description ?? existing.description,
        cleaningProfileId: data.cleaningProfileId ?? existing.cleaningProfileId,
        applicableTemplates: data.applicableTemplates ?? existing.applicableTemplates,
        blockRestriction: data.blockRestriction ?? existing.blockRestriction,
        allowedBlocks: data.allowedBlocks ?? existing.allowedBlocks,
        maxCleaningCycles: data.maxCleaningCycles ?? existing.maxCleaningCycles,
        isActive: data.isActive ?? existing.isActive,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'UPDATED',
      targetType: 'filter_profile', targetId: id,
      beforeValue: { name: existing.name },
      afterValue: { name: updated.name },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return updated;
  }

  async assign(ctx: RequestContext, id: string, filterInstanceIds: string[]) {
    const fp = await this.getById(ctx, id);

    // Update each filter instance
    const updated = await prisma.assetInstance.updateMany({
      where: { id: { in: filterInstanceIds } },
      data: { filterProfileId: id },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'ASSIGNED',
      targetType: 'filter_profile', targetId: id,
      afterValue: { assignedFilters: filterInstanceIds.length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true, assignedCount: updated.count };
  }
}
