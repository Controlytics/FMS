import { type FastifyInstance } from 'fastify';
import { enforceReauth } from '../../lib/reauth-check.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { adminRequestService } from './admin-request.service.js';

export default async function adminRequestRoutes(app: FastifyInstance) {

  // 1. POST / — Submit a new request (PUBLIC, no auth)
  app.post('/', {
    config: { skipAuth: true },
    schema: {
      tags: ['Admin Requests'],
      summary: 'Submit an admin request',
      description: 'Public endpoint for users to submit requests to admin (create user, modify, unlock, forgot password).',
      security: [],
      body: {
        type: 'object',
        required: ['requestType', 'requesterName', 'requestData'],
        properties: {
          requestType: { type: 'string', enum: ['CREATE_USER', 'MODIFY_USER', 'UNLOCK', 'FORGOT_PASSWORD'] },
          requesterName: { type: 'string', minLength: 1, maxLength: 100 },
          requesterEmployeeId: { type: 'string', maxLength: 50 },
          requesterEmail: { type: 'string', format: 'email', maxLength: 100 },
          requestData: { type: 'object', additionalProperties: true },
          remarks: { type: 'string', maxLength: 500 },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            requestId: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const body = req.body as {
      requestType: string;
      requesterName: string;
      requesterEmployeeId?: string;
      requesterEmail?: string;
      requestData: Record<string, unknown>;
      remarks?: string;
    };

    const request = await adminRequestService.create(body);
    return reply.code(201).send({
      success: true,
      message: 'Your request has been submitted. An administrator will review it shortly.',
      requestId: request.id,
    });
  });

  // 2. GET / — List all requests (admin only)
  app.get('/', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['Admin Requests'],
      summary: 'List admin requests',
      description: 'List all admin requests. Requires USER_CREATE permission.',
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: { type: 'object', additionalProperties: true } },
            pendingCount: { type: 'number' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { status } = req.query as { status?: string };
    const [data, pendingCount] = await Promise.all([
      adminRequestService.list(status),
      adminRequestService.pendingCount(),
    ]);
    return { data, pendingCount };
  });

  // 3. GET /pending-count — Count pending requests (admin only)
  app.get('/pending-count', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['Admin Requests'],
      summary: 'Count pending admin requests',
      response: {
        200: {
          type: 'object',
          properties: { count: { type: 'number' } },
        },
      },
    },
  }, async () => {
    const count = await adminRequestService.pendingCount();
    return { count };
  });

  // 4. POST /:id/process — Approve or reject a request (admin only, reauth)
  app.post('/:id/process', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['Admin Requests'],
      summary: 'Process (approve/reject) an admin request',
      description: 'Approve or reject a pending admin request. Requires re-authentication.',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: {
        type: 'object',
        required: ['action'],
        properties: {
          action: { type: 'string', enum: ['approve', 'reject'] },
          adminRemarks: { type: 'string', maxLength: 500 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: { type: 'object', additionalProperties: true },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('CREATE_USER', req, reply);
    if (!ok) return;

    const { id } = req.params as { id: string };
    const { action, adminRemarks } = req.body as { action: 'approve' | 'reject'; adminRemarks?: string };
    const ctx = buildContext(req);

    const result = await adminRequestService.process(id, action, adminRemarks ?? '', ctx);
    return { success: true, data: result };
  });
}
