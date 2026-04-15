import type { FastifyInstance } from 'fastify';
import { blockChangeService } from './block-change.service.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { enforceReauth } from '../../lib/reauth-check.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';

/**
 * Verify the current user is allowed to approve/reject block change requests
 * according to the `block-change-approval.approvalRole` config setting.
 *
 * SUPER_ADMIN can always approve, even if the configured role points to a role
 * that was later deleted — this prevents the approval flow from locking up.
 * If no role is configured (empty string), the permission gate alone is used,
 * which is the sensible fail-open default.
 */
async function assertApprovalRoleAllowed(userRole: string | undefined): Promise<void> {
  if (userRole === 'SUPER_ADMIN') return;
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'block-change-approval' } });
  const configured = (cfg?.configValue as any)?.approvalRole as string | undefined;
  if (!configured || configured.trim() === '') return; // no role configured → permission check alone
  if (userRole !== configured) {
    throw new AppError(
      403,
      'FORBIDDEN_ROLE',
      `Only users with role "${configured}" can approve block change requests`
    );
  }
}

export default async function blockChangeRoutes(app: FastifyInstance) {
  app.post('/', {
    preHandler: [app.requirePermission('BLOCK_CHANGE_REQUEST')],
    schema: {
      tags: ['Block Change Requests'],
      summary: 'Submit a block change request',
      body: {
        type: 'object',
        required: ['filterId', 'filterName', 'fromBlockId', 'fromBlockName', 'toBlockId', 'toBlockName'],
        properties: {
          filterId: { type: 'string', format: 'uuid' },
          filterName: { type: 'string' },
          fromBlockId: { type: 'string', format: 'uuid' },
          fromBlockName: { type: 'string' },
          toBlockId: { type: 'string', format: 'uuid' },
          toBlockName: { type: 'string' },
          reason: { type: 'string', maxLength: 500 },
        },
      },
      response: { 201: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const ctx = buildContext(req);
    const result = await blockChangeService.create(ctx, req.body as any);
    return reply.code(201).send(result);
  });

  app.get('/', {
    preHandler: [async (req, reply) => {
      // Allow both requesters and approvers to list block change requests
      const userRole = req.user?.role;
      if (userRole === 'SUPER_ADMIN') return;
      const role = await (await import('../../lib/prisma.js')).prisma.role.findFirst({ where: { name: userRole }, select: { permissions: true } });
      const perms = (role?.permissions as string[]) || [];
      if (perms.includes('BLOCK_CHANGE_REQUEST') || perms.includes('BLOCK_CHANGE_APPROVE')) return;
      return reply.code(403).send({ error: 'FORBIDDEN', message: 'Permission denied' });
    }],
    schema: {
      tags: ['Block Change Requests'],
      summary: 'List block change requests',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED', 'ALL'] },
          mine: { type: 'string', enum: ['true', 'false'] },
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
        },
      },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const query = req.query as any;
    return blockChangeService.list(ctx, { ...query, mine: query.mine === 'true' });
  });

  app.get('/pending-count', {
    preHandler: [app.requirePermission('BLOCK_CHANGE_APPROVE')],
    schema: {
      tags: ['Block Change Requests'],
      summary: 'Count pending requests',
      response: { 200: { type: 'object', properties: { count: { type: 'integer' } } } },
    },
  }, async (req) => {
    const ctx = buildContext(req);
    const count = await blockChangeService.pendingCount(ctx);
    return { count };
  });

  app.post('/:id/approve', {
    preHandler: [app.requirePermission('BLOCK_CHANGE_APPROVE')],
    schema: {
      tags: ['Block Change Requests'],
      summary: 'Approve a block change request',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', properties: { comment: { type: 'string', maxLength: 500 } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('APPROVE_BLOCK_CHANGE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    await assertApprovalRoleAllowed(ctx.userRole);
    const { id } = req.params as { id: string };
    const { comment } = (req.body as any) ?? {};
    return blockChangeService.process(ctx, id, 'approve', comment);
  });

  app.post('/:id/reject', {
    preHandler: [app.requirePermission('BLOCK_CHANGE_APPROVE')],
    schema: {
      tags: ['Block Change Requests'],
      summary: 'Reject a block change request',
      params: { type: 'object', required: ['id'], properties: { id: { type: 'string', format: 'uuid' } } },
      body: { type: 'object', properties: { comment: { type: 'string', maxLength: 500 } } },
      response: { 200: { type: 'object', additionalProperties: true }, ...errorResponses },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REJECT_BLOCK_CHANGE', req, reply);
    if (!ok) return;
    const ctx = buildContext(req);
    await assertApprovalRoleAllowed(ctx.userRole);
    const { id } = req.params as { id: string };
    const { comment } = (req.body as any) ?? {};
    return blockChangeService.process(ctx, id, 'reject', comment);
  });
}
