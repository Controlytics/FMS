import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import { createTemplateKindSchema, updateTemplateKindSchema } from '@digilog/shared';

/**
 * Template-kind lookup-table CRUD.
 * Prefix: /api/template-kinds
 *
 * Replaces the closed Prisma enum so SUPER_ADMIN can add new kinds (PUMP,
 * VALVE, COMPRESSOR, etc.) at runtime without a code migration. The 6
 * system kinds (BLOCK / AREA / AHU / FILTER / EQUIPMENT / OTHER) are seeded
 * with isSystem=true and protected against rename + delete; only their
 * label / description / sortOrder / isActive are admin-editable.
 *
 * Page-routing code (Filter Management, Cleaning Operations, Mobile) keeps
 * comparing on `templateKind === 'BLOCK'` because system codes are
 * preserved.
 */
export default async function templateKindRoutes(app: FastifyInstance) {
  // ── LIST ──────────────────────────────────────────────────────────────
  app.get('/', {
    preHandler: [app.requirePermission('ASSET_VIEW')],
    schema: {
      tags: ['Template Kinds'],
      summary: 'List template kinds',
      description: 'List all template-kind lookup rows. Returns kinds in sortOrder, then code.',
      querystring: {
        type: 'object',
        properties: {
          isActive: { type: 'string', description: '"true" or "false" — filter by isActive' },
        },
      },
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              code: { type: 'string' },
              label: { type: 'string' },
              description: { type: ['string', 'null'] },
              isSystem: { type: 'boolean' },
              isActive: { type: 'boolean' },
              sortOrder: { type: 'integer' },
              createdAt: { type: 'string' },
              updatedAt: { type: 'string' },
              templateCount: { type: 'integer', description: 'Number of AssetTemplate rows currently using this kind' },
            },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const q = req.query as { isActive?: string };
    const where: Record<string, unknown> = {};
    if (q.isActive === 'true') where.isActive = true;
    else if (q.isActive === 'false') where.isActive = false;

    const kinds = await prisma.templateKind.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      include: { _count: { select: { templates: true } } },
    });

    return kinds.map((k) => ({
      id: k.id,
      code: k.code,
      label: k.label,
      description: k.description,
      isSystem: k.isSystem,
      isActive: k.isActive,
      sortOrder: k.sortOrder,
      createdAt: k.createdAt.toISOString(),
      updatedAt: k.updatedAt.toISOString(),
      templateCount: (k as unknown as { _count: { templates: number } })._count.templates,
    }));
  });

  // ── CREATE ────────────────────────────────────────────────────────────
  app.post('/', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: { tags: ['Template Kinds'], summary: 'Create a new template kind' },
  }, async (req, reply) => {
    // Audit 2026-05-04 fix #5 (web-routes review H3): controlled-vocabulary
    // edits cascade across every entity using the kind. Distinct action key
    // (vs CREATE_ASSET_TEMPLATE which is per-template) so audits can
    // distinguish "template" edits from "kind" (vocabulary) edits.
    const { ok } = await enforceReauth('CREATE_TEMPLATE_KIND', req, reply);
    if (!ok) return;
    const parsed = createTemplateKindSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }
    const { code, label, description, sortOrder, isActive } = parsed.data;

    const dup = await prisma.templateKind.findUnique({ where: { code } });
    if (dup) {
      return reply.code(409).send({ error: 'CONFLICT', message: `Template kind with code "${code}" already exists` });
    }

    const ctx = buildContext(req);
    const kind = await prisma.templateKind.create({
      data: {
        code,
        label,
        description,
        sortOrder,
        isActive,
        isSystem: false,  // user-created kinds are never system
        createdBy: ctx.userId,
      },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'TEMPLATE_KIND_CREATED',
      targetType: 'template_kind',
      targetId: kind.id,
      afterValue: { code: kind.code, label: kind.label, isSystem: kind.isSystem },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return reply.code(201).send(kind);
  });

  // ── UPDATE ────────────────────────────────────────────────────────────
  // Code is immutable. System kinds restrict edits to label/description/sortOrder/isActive.
  app.put('/:code', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: { tags: ['Template Kinds'], summary: 'Update a template kind (code is immutable)' },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('UPDATE_TEMPLATE_KIND', req, reply);
    if (!ok) return;
    const { code } = req.params as { code: string };
    const parsed = updateTemplateKindSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.templateKind.findUnique({ where: { code } });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Template kind "${code}" not found` });
    }

    const ctx = buildContext(req);
    const updated = await prisma.templateKind.update({
      where: { code },
      data: { ...parsed.data, updatedBy: ctx.userId },
    });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'TEMPLATE_KIND_UPDATED',
      targetType: 'template_kind',
      targetId: updated.id,
      beforeValue: { label: existing.label, description: existing.description, sortOrder: existing.sortOrder, isActive: existing.isActive },
      afterValue: { label: updated.label, description: updated.description, sortOrder: updated.sortOrder, isActive: updated.isActive },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return updated;
  });

  // ── DELETE ────────────────────────────────────────────────────────────
  // System kinds cannot be deleted. Kinds in use cannot be deleted.
  app.delete('/:code', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: { tags: ['Template Kinds'], summary: 'Delete a template kind' },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('DELETE_TEMPLATE_KIND', req, reply);
    if (!ok) return;
    const { code } = req.params as { code: string };

    const existing = await prisma.templateKind.findUnique({
      where: { code },
      include: { _count: { select: { templates: true } } },
    });
    if (!existing) {
      return reply.code(404).send({ error: 'NOT_FOUND', message: `Template kind "${code}" not found` });
    }
    if (existing.isSystem) {
      return reply.code(409).send({ error: 'SYSTEM_KIND', message: `Template kind "${code}" is a system kind and cannot be deleted. You can deactivate it via PUT { isActive: false } if you need to hide it from the create-template dropdown.` });
    }
    const inUse = (existing as unknown as { _count: { templates: number } })._count.templates;
    if (inUse > 0) {
      return reply.code(409).send({ error: 'IN_USE', message: `Template kind "${code}" is used by ${inUse} template(s); cannot delete. Reassign those templates to a different kind first.` });
    }

    const ctx = buildContext(req);
    await prisma.templateKind.delete({ where: { code } });

    await auditLog({
      userId: ctx.userId, userRole: ctx.userRole,
      action: 'TEMPLATE_KIND_DELETED',
      targetType: 'template_kind',
      targetId: existing.id,
      beforeValue: { code: existing.code, label: existing.label },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, sessionId: ctx.sessionId,
    });

    return reply.code(204).send();
  });
}
