/**
 * Checklist Profile Service — CRUD for checklist profiles and questions.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';

function orgFilter(ctx: RequestContext) {
  if (ctx.scope === 'GLOBAL') return {};
  return { organizationId: ctx.organizationId };
}

export class ChecklistProfileService {
  async list(ctx: RequestContext, query: { page?: number; limit?: number; isActive?: string; includeQuestions?: string }) {
    const page = query.page ?? 1;
    const limit = Math.min(query.limit ?? 50, 100);
    const where: any = { ...orgFilter(ctx) };
    if (query.isActive === 'true') where.isActive = true;
    else if (query.isActive === 'false') where.isActive = false;

    // Mobile/offline clients need questions embedded so they can render
    // checklists without making a second call per profile.
    const includeQuestions = query.includeQuestions === 'true';
    const include: any = { _count: { select: { questions: true } } };
    if (includeQuestions) include.questions = { orderBy: { sortOrder: 'asc' } };

    const [data, total] = await Promise.all([
      prisma.checklistProfile.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include,
      }),
      prisma.checklistProfile.count({ where }),
    ]);

    return {
      data: data.map((p: any) => ({
        id: p.id, name: p.name, description: p.description,
        isActive: p.isActive, questionCount: p._count.questions,
        createdAt: p.createdAt, updatedAt: p.updatedAt,
        ...(includeQuestions ? { questions: p.questions ?? [] } : {}),
      })),
      total, page, limit, totalPages: Math.ceil(total / limit),
    };
  }

  async getById(ctx: RequestContext, id: string) {
    const profile = await prisma.checklistProfile.findFirst({
      where: { id, ...orgFilter(ctx) },
      include: { questions: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!profile) throw new AppError(404, 'NOT_FOUND', 'Checklist profile not found');
    return profile;
  }

  async create(ctx: RequestContext, data: any) {
    let orgId: string = ctx.organizationId ?? '';
    if (!orgId) {
      const firstOrg = await prisma.organization.findFirst({ select: { id: true } });
      orgId = firstOrg?.id ?? '';
    }
    if (!orgId) throw new AppError(400, 'NO_ORG', 'No organization found');

    const profile = await prisma.checklistProfile.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        organizationId: orgId,
        createdBy: ctx.userSub,
      },
    });
    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole, action: 'CREATED',
      targetType: 'checklist_profile', targetId: profile.id,
      afterValue: { name: data.name }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    });
    return profile;
  }

  async update(ctx: RequestContext, id: string, data: any) {
    await this.getById(ctx, id);
    const updated = await prisma.checklistProfile.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
    return updated;
  }

  async delete(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);
    // Check if referenced by any pipeline CHECKLIST nodes in non-archived cleaning profiles
    const usedInPipelines = await prisma.filterPipelineStage.count({
      where: {
        nodeType: 'CHECKLIST',
        configuration: { path: ['checklistProfileId'], equals: id },
        profile: { status: { not: 'ARCHIVED' } },
      },
    });
    if (usedInPipelines > 0) {
      throw new AppError(409, 'IN_USE', 'Cannot delete: checklist is referenced by ' + usedInPipelines + ' pipeline node(s)');
    }
    await prisma.checklistProfile.delete({ where: { id } });
    return { success: true };
  }

  // ─── Questions ────────────────────────────────────────────

  async addQuestion(ctx: RequestContext, profileId: string, data: any) {
    await this.getById(ctx, profileId);
    const maxOrder = await prisma.checklistQuestion.aggregate({ where: { profileId }, _max: { sortOrder: true } });
    const question = await prisma.checklistQuestion.create({
      data: {
        profileId,
        question: data.question,
        questionType: data.questionType ?? 'YES_NO',
        required: data.required ?? false,
        section: data.section ?? null,
        description: data.description ?? null,
        options: data.options ?? [],
        validation: data.validation ?? {},
        sortOrder: data.sortOrder ?? ((maxOrder._max.sortOrder ?? -1) + 1),
      },
    });
    return question;
  }

  async updateQuestion(ctx: RequestContext, profileId: string, questionId: string, data: any) {
    const q = await prisma.checklistQuestion.findFirst({ where: { id: questionId, profileId } });
    if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found');
    return prisma.checklistQuestion.update({
      where: { id: questionId },
      data: {
        ...(data.question !== undefined && { question: data.question }),
        ...(data.questionType !== undefined && { questionType: data.questionType }),
        ...(data.required !== undefined && { required: data.required }),
        ...(data.section !== undefined && { section: data.section }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.options !== undefined && { options: data.options }),
        ...(data.validation !== undefined && { validation: data.validation }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });
  }

  async deleteQuestion(ctx: RequestContext, profileId: string, questionId: string) {
    const q = await prisma.checklistQuestion.findFirst({ where: { id: questionId, profileId } });
    if (!q) throw new AppError(404, 'NOT_FOUND', 'Question not found');
    await prisma.checklistQuestion.delete({ where: { id: questionId } });
    return { success: true };
  }

  async reorderQuestions(ctx: RequestContext, profileId: string, questionIds: string[]) {
    await this.getById(ctx, profileId);
    await Promise.all(questionIds.map((qId, i) =>
      prisma.checklistQuestion.update({ where: { id: qId }, data: { sortOrder: i } })
    ));
    return { success: true };
  }
}
