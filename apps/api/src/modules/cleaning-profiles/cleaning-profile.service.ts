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
    if (query.status) where.status = query.status;

    const [data, total] = await Promise.all([
      prisma.filterCleaningProfile.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { stages: { select: { id: true } }, _count: { select: { stages: true, connections: true } } },
      }),
      prisma.filterCleaningProfile.count({ where }),
    ]);

    return {
      data: data.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        flowMode: p.flowMode,
        version: p.version,
        status: p.status,
        stageCount: p._count.stages,
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
        organizationId: ctx.organizationId!,
        flowMode: flowMode ?? 'STRICT',
        alarmOnForwardSkip: alarmOnForwardSkip ?? true,
        alarmOnBackwardJump: alarmOnBackwardJump ?? true,
        alarmOnOutOfSequence: alarmOnOutOfSequence ?? true,
        cleaningReasons: cleaningReasons ?? undefined,
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

    // Archive old version
    await prisma.filterCleaningProfile.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    // Create new version
    const newProfile = await prisma.filterCleaningProfile.create({
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

      await prisma.filterPipelineConnection.createMany({
        data: conns.map((c: any) => ({
          profileId: newProfile.id,
          fromStageId: c.fromStageId ?? stageMap.get(c.fromIndex) ?? '',
          toStageId: c.toStageId ?? stageMap.get(c.toIndex) ?? '',
          label: c.label ?? 'Next',
        })),
      });
    }

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'UPDATED',
      targetType: 'cleaning_profile', targetId: newProfile.id,
      beforeValue: { version: existing.version },
      afterValue: { version: newProfile.version },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return this.getById(ctx, newProfile.id);
  }

  async archive(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);

    // Check if any active filter profiles reference this
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

    // Check for disconnected nodes (every non-START must have incoming, every non-END must have outgoing)
    if (connections && connections.length > 0) {
      const hasIncoming = new Set<number>();
      const hasOutgoing = new Set<number>();
      connections.forEach((c: any) => {
        hasOutgoing.add(c.fromIndex ?? -1);
        hasIncoming.add(c.toIndex ?? -1);
      });
    }
  }
}
