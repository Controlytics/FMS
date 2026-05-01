/**
 * Filter Profile Service — CRUD + assignment for filter profiles.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

export class FilterProfileService {
  async list(_ctx: RequestContext, query: { page?: number; limit?: number }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: any = {};

    const [data, total] = await Promise.all([
      prisma.filterProfile.findMany({
        where,
        include: {
          cleaningProfile: { select: { name: true } },
          _count: { select: { filterDetails: true } }, // Step 6: assetInstances → filterDetails
        },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.filterProfile.count({ where }),
    ]);

    const enriched = data.map((fp: any) => ({
      ...fp,
      cleaningProfileName: fp.cleaningProfile?.name ?? 'Unknown',
      activeFilterCount: fp._count.filterDetails,
      cleaningProfile: undefined,
      _count: undefined,
    }));

    return { data: enriched, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getById(_ctx: RequestContext, id: string) {
    const fp = await prisma.filterProfile.findFirst({
      where: { id },
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

    // Validate cleaning profile is active if being changed
    if (data.cleaningProfileId) {
      const cp = await prisma.filterCleaningProfile.findUnique({ where: { id: data.cleaningProfileId } });
      if (!cp) throw new AppError(404, 'NOT_FOUND', 'Cleaning profile not found');
      if (cp.status !== 'ACTIVE') throw new AppError(400, 'VALIDATION_ERROR', 'Cleaning profile must be active');
    }

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

  async delete(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);

    // Check if any filters are currently assigned to this profile (FilterDetails — Step 6).
    const assignedCount = await prisma.filterDetails.count({
      where: { filterProfileId: id },
    });
    if (assignedCount > 0) {
      throw new AppError(400, 'VALIDATION_ERROR', `Cannot delete: ${assignedCount} filter(s) are still assigned to this profile`);
    }

    await prisma.filterProfile.delete({ where: { id } });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'DELETED',
      targetType: 'filter_profile', targetId: id,
      beforeValue: { name: existing.name },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true };
  }

  async assign(ctx: RequestContext, id: string, filterInstanceIds: string[]) {
    const fp = await this.getById(ctx, id);

    // filterProfileId now lives on FilterDetails (Step 6) — upsert per-instance
    // so legacy non-eager rows still get a sidecar row.
    let assignedCount = 0;
    await Promise.all(filterInstanceIds.map(async (assetId) => {
      await prisma.filterDetails.upsert({
        where: { assetInstanceId: assetId },
        update: { filterProfileId: id },
        create: { assetInstanceId: assetId, filterProfileId: id },
      });
      assignedCount++;
    }));

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'ASSIGNED',
      targetType: 'filter_profile', targetId: id,
      afterValue: { assignedFilters: filterInstanceIds.length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true, assignedCount };
  }
}
