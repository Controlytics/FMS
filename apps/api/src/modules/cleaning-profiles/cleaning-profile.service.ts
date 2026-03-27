/**
 * Cleaning Profile Service — CRUD, validation, versioning for filter cleaning profiles.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';



function orgFilter(ctx: RequestContext) {
  if (ctx.scope === 'GLOBAL') return {};
  return { organizationId: ctx.organizationId };
}

export class CleaningProfileService {
  async list(ctx: RequestContext, query: { page?: number; limit?: number; status?: string }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: any = { ...orgFilter(ctx) };

    // Map frontend status to DB status
    if (query.status === 'ACTIVE') where.status = 'ACTIVE';
    else if (query.status === 'INACTIVE') where.status = 'ARCHIVED';

    // Only show the latest version per profile name (exclude old archived versions)
    // Get all matching profiles, then deduplicate by name keeping highest version
    const allProfiles = await prisma.filterCleaningProfile.findMany({
      where,
      orderBy: [{ name: 'asc' }, { version: 'desc' }],
      include: { stages: { select: { nodeType: true } }, _count: { select: { connections: true } } },
    });

    // Deduplicate: keep only the latest version per name
    const seen = new Map<string, typeof allProfiles[0]>();
    for (const p of allProfiles) {
      const existing = seen.get(p.name);
      if (!existing || p.version > existing.version) {
        seen.set(p.name, p);
      }
    }
    const deduped = Array.from(seen.values());

    // Paginate
    const total = deduped.length;
    const paged = deduped.slice((page - 1) * limit, page * limit);

    return {
      data: paged.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        flowMode: p.flowMode,
        version: p.version,
        status: p.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
        stageCount: p.stages.filter(s => s.nodeType !== 'START' && s.nodeType !== 'END').length,
        connectionCount: p._count.connections,
        createdAt: p.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(ctx: RequestContext, id: string) {
    const profile = await prisma.filterCleaningProfile.findFirst({
      where: { id, ...orgFilter(ctx) },
      include: {
        stages: { orderBy: { sortOrder: 'asc' } },
        connections: true,
      },
    });
    if (!profile) throw new AppError(404, 'NOT_FOUND', 'Cleaning profile not found');
    return profile;
  }

  async create(ctx: RequestContext, data: any) {
    const { name, description, flowMode, alarmOnForwardSkip, alarmOnBackwardJump, alarmOnOutOfSequence, cleaningReasons, stages, connections } = data;

    // Validate pipeline graph
    this.validatePipeline(stages, connections);

    const profile = await prisma.filterCleaningProfile.create({
      data: {
        name,
        description,
        organizationId: ctx.organizationId || ((await prisma.organization.findFirst({ select: { id: true } }))?.id ?? ''),
        flowMode: flowMode ?? 'STRICT',
        alarmOnForwardSkip: alarmOnForwardSkip ?? true,
        alarmOnBackwardJump: alarmOnBackwardJump ?? true,
        alarmOnOutOfSequence: alarmOnOutOfSequence ?? true,
        cleaningReasons: cleaningReasons ?? undefined,
        status: 'ACTIVE',
        createdBy: ctx.userSub,
        stages: {
          create: stages.map((s: any, i: number) => ({
            stateKey: s.stateKey ?? null,
            nodeType: s.nodeType,
            configuration: s.configuration ?? {},
            positionX: s.positionX ?? 0,
            positionY: s.positionY ?? 0,
            sortOrder: s.sortOrder ?? i,
          })),
        },
      },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });

    // Create connections (need stage IDs from created profile)
    if (connections && connections.length > 0) {
      const stageMap = new Map<number, string>();
      profile.stages.forEach((s, i) => stageMap.set(i, s.id));

      await prisma.filterPipelineConnection.createMany({
        data: connections.map((c: any) => ({
          profileId: profile.id,
          fromStageId: c.fromStageId ?? stageMap.get(c.fromIndex) ?? '',
          toStageId: c.toStageId ?? stageMap.get(c.toIndex) ?? '',
          label: c.label ?? 'Next',
        })),
      });
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CREATED',
      targetType: 'cleaning_profile', targetId: profile.id,
      afterValue: { name, flowMode },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getById(ctx, profile.id);
  }

  async update(ctx: RequestContext, id: string, data: any) {
    const existing = await this.getById(ctx, id);

    // Validate new pipeline if stages provided
    if (data.stages) {
      this.validatePipeline(data.stages, data.connections ?? []);
    }

    // Wrap entire versioning in a transaction for consistency
    const result = await prisma.$transaction(async (tx) => {
    // Mark old version as ARCHIVED
    await tx.filterCleaningProfile.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    // Create new version with ACTIVE status
    const newProfile = await tx.filterCleaningProfile.create({
      data: {
        name: data.name ?? existing.name,
        description: data.description ?? existing.description,
        organizationId: existing.organizationId,
        flowMode: data.flowMode ?? existing.flowMode,
        alarmOnForwardSkip: data.alarmOnForwardSkip ?? existing.alarmOnForwardSkip,
        alarmOnBackwardJump: data.alarmOnBackwardJump ?? existing.alarmOnBackwardJump,
        alarmOnOutOfSequence: data.alarmOnOutOfSequence ?? existing.alarmOnOutOfSequence,
        cleaningReasons: data.cleaningReasons ?? existing.cleaningReasons ?? undefined,
        version: existing.version + 1,
        status: 'ACTIVE',
        createdBy: ctx.userSub,
        stages: {
          create: (data.stages ?? existing.stages).map((s: any, i: number) => ({
            stateKey: s.stateKey ?? null,
            nodeType: s.nodeType,
            configuration: s.configuration ?? {},
            positionX: s.positionX ?? 0,
            positionY: s.positionY ?? 0,
            sortOrder: s.sortOrder ?? i,
          })),
        },
      },
      include: { stages: { orderBy: { sortOrder: 'asc' } } },
    });

    // Create connections for new version
    const conns = data.connections ?? existing.connections;
    if (conns && conns.length > 0) {
      const stageMap = new Map<number, string>();
      newProfile.stages.forEach((s, i) => stageMap.set(i, s.id));

      await tx.filterPipelineConnection.createMany({
        data: conns.map((c: any) => ({
          profileId: newProfile.id,
          fromStageId: c.fromStageId ?? stageMap.get(c.fromIndex) ?? '',
          toStageId: c.toStageId ?? stageMap.get(c.toIndex) ?? '',
          label: c.label ?? 'Next',
        })),
      });
    }

    // Migrate all filter profiles from old version to new version
    await tx.filterProfile.updateMany({
      where: { cleaningProfileId: id },
      data: { cleaningProfileId: newProfile.id },
    });

    return newProfile;
    }); // end transaction
    const newProfile = result;

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'UPDATED',
      targetType: 'cleaning_profile', targetId: newProfile.id,
      beforeValue: { version: existing.version },
      afterValue: { version: newProfile.version },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getById(ctx, newProfile.id);
  }

  async toggleStatus(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);
    const newStatus = existing.status === 'ACTIVE' ? 'ARCHIVED' : 'ACTIVE';

    // If deactivating, check references
    if (newStatus === 'ARCHIVED') {
      const activeProfiles = await prisma.filterProfile.count({
        where: { cleaningProfileId: id, isActive: true },
      });
      if (activeProfiles > 0) {
        throw new AppError(409, 'CONFLICT', `Cannot deactivate: ${activeProfiles} active filter profile(s) reference this cleaning profile`);
      }
    }

    await prisma.filterCleaningProfile.update({
      where: { id },
      data: { status: newStatus },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: newStatus === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED',
      targetType: 'cleaning_profile', targetId: id,
      beforeValue: { status: existing.status },
      afterValue: { status: newStatus },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true, status: newStatus === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE' };
  }

  async archive(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);

    const activeProfiles = await prisma.filterProfile.count({
      where: { cleaningProfileId: id, isActive: true },
    });
    if (activeProfiles > 0) {
      throw new AppError(409, 'CONFLICT', `Cannot archive: ${activeProfiles} active filter profile(s) reference this cleaning profile`);
    }

    await prisma.filterCleaningProfile.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'ARCHIVED',
      targetType: 'cleaning_profile', targetId: id,
      beforeValue: { status: existing.status },
      afterValue: { status: 'ARCHIVED' },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true };
  }

  async getAssignedAssets(ctx: RequestContext, id: string) {
    // Find all filter profiles that reference this cleaning profile
    const filterProfiles = await prisma.filterProfile.findMany({
      where: { cleaningProfileId: id, ...orgFilter(ctx) },
      select: { id: true },
    });
    const fpIds = filterProfiles.map(fp => fp.id);

    if (fpIds.length === 0) return [];

    // Find all assets assigned to these filter profiles
    const assets = await prisma.assetInstance.findMany({
      where: { filterProfileId: { in: fpIds } },
      select: { id: true, name: true, filterSet: true, currentLifecycleState: true, filterProfileId: true },
      orderBy: { name: 'asc' },
    });

    return assets;
  }

  async assignAssets(ctx: RequestContext, id: string, assetIds: string[]) {
    const profile = await this.getById(ctx, id);

    // Find or create a filter profile for this cleaning profile
    let filterProfile = await prisma.filterProfile.findFirst({
      where: { cleaningProfileId: id, organizationId: profile.organizationId },
    });

    if (!filterProfile) {
      filterProfile = await prisma.filterProfile.create({
        data: {
          name: profile.name,
          cleaningProfileId: id,
          organizationId: profile.organizationId,
          blockRestriction: 'OWN_BLOCK_ONLY',
        },
      });
    } else {
      // Update the filter profile name to match
      await prisma.filterProfile.update({
        where: { id: filterProfile.id },
        data: { name: profile.name, cleaningProfileId: id },
      });
    }

    // Unassign all current assets from this filter profile
    await prisma.assetInstance.updateMany({
      where: { filterProfileId: filterProfile.id },
      data: { filterProfileId: null },
    });

    // Assign selected assets
    if (assetIds.length > 0) {
      await prisma.assetInstance.updateMany({
        where: { id: { in: assetIds } },
        data: { filterProfileId: filterProfile.id },
      });
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'ASSIGNED',
      targetType: 'cleaning_profile', targetId: id,
      afterValue: { assignedAssets: assetIds.length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true, assignedCount: assetIds.length };
  }

  async validate(_ctx: RequestContext, data: any) {
    const errors: string[] = [];
    try {
      this.validatePipeline(data.stages ?? [], data.connections ?? []);
    } catch (err: any) {
      errors.push(err.message);
    }
    return { valid: errors.length === 0, errors };
  }

  private validatePipeline(stages: any[], connections: any[]) {
    if (!stages || stages.length < 2) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Pipeline must have at least 2 stages (START and END)');
    }

    const startNodes = stages.filter((s: any) => s.nodeType === 'START');
    const endNodes = stages.filter((s: any) => s.nodeType === 'END');

    if (startNodes.length !== 1) {
      throw new AppError(400, 'VALIDATION_ERROR', `Pipeline must have exactly 1 START node (found ${startNodes.length})`);
    }
    if (endNodes.length !== 1) {
      throw new AppError(400, 'VALIDATION_ERROR', `Pipeline must have exactly 1 END node (found ${endNodes.length})`);
    }

    // Validate STAGE nodes have stateKeys
    const stageNodes = stages.filter((s: any) => s.nodeType === 'STAGE');
    for (const sn of stageNodes) {
      if (!sn.stateKey) throw new AppError(400, 'VALIDATION_ERROR', 'All STAGE nodes must have a stateKey assigned');
    }

    // Validate CHECKLIST nodes have checklistProfileId
    const checklistNodes = stages.filter((s: any) => s.nodeType === 'CHECKLIST');
    for (const cn of checklistNodes) {
      if (!cn.configuration?.checklistProfileId) throw new AppError(400, 'VALIDATION_ERROR', 'All CHECKLIST nodes must have a checklist profile assigned');
    }

    if (connections && connections.length > 0) {
      const hasIncoming = new Set<number>();
      const hasOutgoing = new Set<number>();
      connections.forEach((c: any) => {
        hasOutgoing.add(c.fromIndex ?? -1);
        hasIncoming.add(c.toIndex ?? -1);
      });

      // START must have outgoing
      const startIdx = stages.findIndex((s: any) => s.nodeType === 'START');
      if (!hasOutgoing.has(startIdx)) throw new AppError(400, 'VALIDATION_ERROR', 'START node must have at least one outgoing connection');

      // END must have incoming
      const endIdx = stages.findIndex((s: any) => s.nodeType === 'END');
      if (!hasIncoming.has(endIdx)) throw new AppError(400, 'VALIDATION_ERROR', 'END node must have at least one incoming connection');

      // Check for disconnected nodes
      for (let i = 0; i < stages.length; i++) {
        if (stages[i].nodeType === 'START' || stages[i].nodeType === 'END') continue;
        if (!hasIncoming.has(i) && !hasOutgoing.has(i)) {
          throw new AppError(400, 'VALIDATION_ERROR', 'Disconnected node found: ' + (stages[i].stateKey || stages[i].nodeType));
        }
      }
    }
  }
}
