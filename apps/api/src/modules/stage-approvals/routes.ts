import { type FastifyInstance } from 'fastify';
import { buildContext } from '../../lib/build-context.js';
import { enforceReauthAlways } from '../../lib/reauth-check.js';
import { stageApprovalService as svc } from './service.js';

// Cleaning Stage Interlock — approver side. Prefix /api/stage-approvals
export default async function stageApprovalRoutes(app: FastifyInstance) {
  // My actionable queue — PENDING approvals routed to my role.
  app.get('/queue', {
    preHandler: [app.requirePermission('STAGE_APPROVAL_VIEW')],
    schema: { tags: ['Stage Approvals'], summary: 'Cleaning stages awaiting my approval' },
  }, async (req) => {
    return { data: await svc.queue(buildContext(req)) };
  });

  // Broader list — ?status=APPROVED|REJECTED|PENDING.
  app.get('/', {
    preHandler: [app.requirePermission('STAGE_APPROVAL_VIEW')],
    schema: {
      tags: ['Stage Approvals'], summary: 'List stage approvals',
      querystring: { type: 'object', properties: { status: { type: 'string' } } },
    },
  }, async (req) => {
    const q = req.query as { status?: string };
    return { data: await svc.list(buildContext(req), { status: q.status }) };
  });

  // Full record incl. the frozen details snapshot.
  app.get('/:id', {
    preHandler: [app.requirePermission('STAGE_APPROVAL_VIEW')],
    schema: { tags: ['Stage Approvals'], summary: 'Get a stage approval (with snapshot)' },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return svc.getById(id);
  });

  // Approve — releases the operator. Reauth password = the digital signature.
  app.post('/:id/approve', {
    preHandler: [app.requirePermission('STAGE_APPROVAL_DECIDE')],
    schema: {
      tags: ['Stage Approvals'], summary: 'Approve a cleaning stage (release the operator)',
      body: {
        type: 'object',
        properties: { remarks: { type: 'string' }, _currentPassword: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauthAlways('APPROVE_CLEANING_STAGE', req, reply);
    if (!ok) return;
    const { id } = req.params as { id: string };
    const b = req.body as { remarks?: string };
    const row = await svc.approve(buildContext(req), id, b.remarks);
    return { id: row.id, status: row.status };
  });

  // Reject — moves the filter back; remarks mandatory. Reauth = digital signature.
  app.post('/:id/reject', {
    preHandler: [app.requirePermission('STAGE_APPROVAL_DECIDE')],
    schema: {
      tags: ['Stage Approvals'], summary: 'Reject a cleaning stage (send the filter back)',
      body: {
        type: 'object', required: ['remarks'],
        properties: { remarks: { type: 'string' }, _currentPassword: { type: 'string' } },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauthAlways('REJECT_CLEANING_STAGE', req, reply);
    if (!ok) return;
    const { id } = req.params as { id: string };
    const b = req.body as { remarks?: string };
    const row = await svc.reject(buildContext(req), id, b.remarks);
    return { id: row.id, status: row.status };
  });
}
