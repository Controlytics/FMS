/**
 * Report Template Service — CRUD, versioning, toggle status for report templates.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

export class ReportTemplateService {

  async list(_ctx: RequestContext, query: { page?: number; limit?: number; status?: string; search?: string }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 20, 100);
    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }
    if (query.search) {
      where.name = { contains: query.search, mode: 'insensitive' };
    }

    const [data, total] = await Promise.all([
      prisma.reportTemplate.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          creator: { select: { fullName: true, username: true } },
        },
      }),
      prisma.reportTemplate.count({ where }),
    ]);

    return {
      data: data.map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        status: t.status,
        currentVersion: t.currentVersion,
        createdBy: t.creator.fullName || t.creator.username,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getById(_ctx: RequestContext, id: string) {
    const template = await prisma.reportTemplate.findFirst({
      where: { id },
      include: {
        creator: { select: { fullName: true, username: true } },
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
        },
      },
    });
    if (!template) throw new AppError(404, 'NOT_FOUND', 'Report template not found');

    return {
      ...template,
      createdByName: template.creator.fullName || template.creator.username,
      latestConfig: template.versions[0]?.config ?? null,
    };
  }

  async create(ctx: RequestContext, data: { name: string; description?: string; config: Record<string, any> }) {
    const template = await prisma.reportTemplate.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        status: 'DRAFT',
        currentVersion: 1,
        createdBy: ctx.userSub,
        versions: {
          create: {
            version: 1,
            config: data.config,
            changelog: 'Initial version',
            createdBy: ctx.userSub,
          },
        },
      },
      include: {
        versions: true,
        creator: { select: { fullName: true, username: true } },
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CREATED',
      targetType: 'report_template', targetId: template.id,
      afterValue: { name: data.name, version: 1 },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return template;
  }

  async update(ctx: RequestContext, id: string, data: { name?: string; description?: string; config?: Record<string, any>; changelog?: string }) {
    const existing = await this.getById(ctx, id);

    const updateData: any = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;

    let newVersion = existing.currentVersion;

    // If config is provided, create a new version
    if (data.config) {
      newVersion = existing.currentVersion + 1;
      updateData.currentVersion = newVersion;

      await prisma.reportTemplateVersion.create({
        data: {
          templateId: id,
          version: newVersion,
          config: data.config,
          changelog: data.changelog ?? null,
          createdBy: ctx.userSub,
        },
      });
    }

    const updated = await prisma.reportTemplate.update({
      where: { id },
      data: updateData,
      include: {
        creator: { select: { fullName: true, username: true } },
        versions: { orderBy: { version: 'desc' }, take: 1 },
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'UPDATED',
      targetType: 'report_template', targetId: id,
      beforeValue: { version: existing.currentVersion },
      afterValue: { version: newVersion, name: updated.name },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return updated;
  }

  async toggleStatus(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);
    let newStatus: string;

    if (existing.status === 'ACTIVE') {
      newStatus = 'ARCHIVED';
    } else {
      newStatus = 'ACTIVE';
    }

    await prisma.reportTemplate.update({
      where: { id },
      data: { status: newStatus as any },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: newStatus === 'ACTIVE' ? 'ACTIVATED' : 'DEACTIVATED',
      targetType: 'report_template', targetId: id,
      beforeValue: { status: existing.status },
      afterValue: { status: newStatus },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true, status: newStatus };
  }

  async delete(ctx: RequestContext, id: string) {
    const existing = await this.getById(ctx, id);

    // Check if any report instances reference this template
    const instanceCount = await prisma.reportInstance.count({
      where: { templateId: id },
    });
    if (instanceCount > 0) {
      throw new AppError(409, 'CONFLICT', `Cannot delete: ${instanceCount} report instance(s) reference this template. Archive it instead.`);
    }

    // Delete cascades to versions (onDelete: Cascade)
    await prisma.reportTemplate.delete({ where: { id } });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'DELETED',
      targetType: 'report_template', targetId: id,
      beforeValue: { name: existing.name, version: existing.currentVersion },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });

    return { success: true };
  }

  async listVersions(ctx: RequestContext, id: string) {
    // Verify access
    await this.getById(ctx, id);

    const versions = await prisma.reportTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { version: 'desc' },
      include: {
        creator: { select: { fullName: true, username: true } },
      },
    });

    return versions.map(v => ({
      id: v.id,
      version: v.version,
      changelog: v.changelog,
      createdBy: v.creator.fullName || v.creator.username,
      createdAt: v.createdAt,
    }));
  }

  async getVersion(ctx: RequestContext, id: string, version: number) {
    // Verify access
    await this.getById(ctx, id);

    const ver = await prisma.reportTemplateVersion.findUnique({
      where: { templateId_version: { templateId: id, version } },
      include: {
        creator: { select: { fullName: true, username: true } },
      },
    });
    if (!ver) throw new AppError(404, 'NOT_FOUND', `Version ${version} not found`);

    return ver;
  }

  async duplicate(ctx: RequestContext, id: string, newName: string) {
    const existing = await this.getById(ctx, id);
    if (!existing.latestConfig) throw new AppError(400, 'VALIDATION_ERROR', 'Template has no config to duplicate');

    return this.create(ctx, {
      name: newName,
      description: existing.description ?? undefined,
      config: existing.latestConfig as Record<string, any>,
    });
  }
}
