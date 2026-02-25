import { type FastifyInstance } from 'fastify';
import { createUserRequestSchema, userRequestQuerySchema, rejectUserRequestSchema } from '@digilog/shared';
import { enforceReauth } from '../../lib/reauth-check.js';
import { buildContext } from '../../lib/build-context.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { userRequestService } from './user-request.service.js';

const requestItemSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string' as const },
    requestedUserId: { type: 'string' as const },
    fullName: { type: 'string' as const },
    department: { type: ['string', 'null'] as const },
    email: { type: 'string' as const },
    roleName: { type: 'string' as const },
    status: { type: 'string' as const },
    requestedAt: { type: 'string' as const, format: 'date-time' },
    reviewedAt: { type: ['string', 'null'] as const, format: 'date-time' },
    reviewedBy: { type: ['string', 'null'] as const },
    reviewerFullName: { type: ['string', 'null'] as const },
    rejectionReason: { type: ['string', 'null'] as const },
    isPasswordViewed: { type: 'boolean' as const },
    ipAddress: { type: ['string', 'null'] as const },
  },
};

export default async function userRequestRoutes(app: FastifyInstance) {
  // ============================================================
  // PUBLIC ENDPOINTS (no auth — added to auth.ts public paths)
  // ============================================================

  // GET /api/user-requests/roles — Active roles for public form
  app.get('/roles', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: any) => req.ip },
    },
    schema: {
      tags: ['User Requests'],
      summary: 'List active roles (public)',
      description: 'Public endpoint returning active roles for the account request form.',
      security: [],
      response: {
        200: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              displayName: { type: 'string' },
              hierarchyLevel: { type: 'integer' },
              color: { type: 'string' },
            },
          },
        },
      },
    },
  }, async () => {
    return userRequestService.getActiveRoles();
  });

  // GET /api/user-requests/user-id-rules — User ID format rules for public form
  app.get('/user-id-rules', {
    config: {
      rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: any) => req.ip },
    },
    schema: {
      tags: ['User Requests'],
      summary: 'Get User ID format rules (public)',
      description: 'Public endpoint returning User ID configuration rules (length, format, prefix) for client-side validation.',
      security: [],
      response: {
        200: {
          type: 'object',
          properties: {
            length: { type: 'integer' },
            format: { type: 'string' },
            prefix: { type: 'string' },
            prefixSeparator: { type: 'string' },
            letterCase: { type: 'string' },
            customPatternDescription: { type: 'string' },
            customPatternExample: { type: 'string' },
          },
        },
      },
    },
  }, async () => {
    return userRequestService.getUserIdRules();
  });

  // POST /api/user-requests/check-availability — Check userId/email availability (public)
  app.post('/check-availability', {
    config: {
      rateLimit: { max: 15, timeWindow: '1 minute', keyGenerator: (req: any) => req.ip },
    },
    schema: {
      tags: ['User Requests'],
      summary: 'Check User ID / email availability (public)',
      description: 'Public endpoint to check if a userId or email is already taken. Rate limited.',
      security: [],
      body: {
        type: 'object',
        properties: {
          userId: { type: 'string' },
          email: { type: 'string', format: 'email' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            userIdAvailable: { type: 'boolean' },
            userIdError: { type: 'string' },
            emailAvailable: { type: 'boolean' },
            emailError: { type: 'string' },
          },
        },
      },
    },
  }, async (req) => {
    const { userId, email } = req.body as { userId?: string; email?: string };
    return userRequestService.checkAvailability({ userId, email });
  });

  // POST /api/user-requests — Submit creation request (public)
  app.post('/', {
    config: {
      rateLimit: { max: 5, timeWindow: '1 minute', keyGenerator: (req: any) => req.ip },
    },
    schema: {
      tags: ['User Requests'],
      summary: 'Submit user creation request (public)',
      description: 'Public endpoint for requesting a new user account. Rate limited.',
      security: [],
      body: {
        type: 'object',
        required: ['requestedUserId', 'fullName', 'email', 'roleName'],
        properties: {
          requestedUserId: { type: 'string' },
          fullName: { type: 'string' },
          email: { type: 'string', format: 'email' },
          department: { type: 'string' },
          roleName: { type: 'string' },
        },
      },
      response: {
        201: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            message: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const parsed = createUserRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }
    const result = await userRequestService.submit(parsed.data, req.ip);
    return reply.code(201).send(result);
  });

  // ============================================================
  // AUTHENTICATED ADMIN ENDPOINTS
  // ============================================================

  // GET /api/user-requests — List all requests (admin)
  app.get('/', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['User Requests'],
      summary: 'List user creation requests',
      description: 'Paginated list of user creation requests. Requires USER_CREATE permission.',
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', default: 1 },
          limit: { type: 'integer', default: 20 },
          status: { type: 'string', enum: ['PENDING', 'APPROVED', 'REJECTED'] },
          search: { type: 'string' },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            data: { type: 'array', items: requestItemSchema },
            total: { type: 'integer' },
            page: { type: 'integer' },
            limit: { type: 'integer' },
            totalPages: { type: 'integer' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const query = userRequestQuerySchema.parse(req.query);
    return userRequestService.list(query);
  });

  // GET /api/user-requests/pending/count — Pending count
  app.get('/pending/count', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['User Requests'],
      summary: 'Pending request count',
      description: 'Get count of pending user creation requests.',
      response: {
        200: { type: 'object', properties: { count: { type: 'integer' } } },
        ...errorResponses,
      },
    },
  }, async () => {
    return userRequestService.getPendingCount();
  });

  // GET /api/user-requests/:id — Request detail
  app.get('/:id', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['User Requests'],
      summary: 'Get request detail',
      description: 'Get full details of a user creation request.',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: {
        200: requestItemSchema,
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return userRequestService.getById(id);
  });

  // POST /api/user-requests/:id/approve — Approve (reauth)
  app.post('/:id/approve', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['User Requests'],
      summary: 'Approve user creation request',
      description: 'Approve a pending request, creating user account with temporary password. Requires reauth.',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            tempPassword: { type: 'string' },
            userId: { type: 'string' },
            username: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('APPROVE_USER_REQUEST', req, reply);
    if (!ok) return;
    const { id } = req.params as { id: string };
    return userRequestService.approve(id, buildContext(req));
  });

  // POST /api/user-requests/:id/reject — Reject (reauth)
  app.post('/:id/reject', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['User Requests'],
      summary: 'Reject user creation request',
      description: 'Reject a pending request with a mandatory reason. Requires reauth.',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      body: {
        type: 'object',
        required: ['rejectionReason'],
        properties: {
          rejectionReason: { type: 'string', minLength: 1, maxLength: 500 },
        },
      },
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('REJECT_USER_REQUEST', req, reply);
    if (!ok) return;
    const { id } = req.params as { id: string };
    const parsed = rejectUserRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }
    return userRequestService.reject(id, parsed.data.rejectionReason, buildContext(req));
  });

  // POST /api/user-requests/:id/password-viewed — Mark temp password as viewed
  app.post('/:id/password-viewed', {
    preHandler: [app.requirePermission('USER_CREATE')],
    schema: {
      tags: ['User Requests'],
      summary: 'Mark temp password as viewed',
      description: 'Marks the temporary password as viewed so it cannot be retrieved again.',
      params: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      response: {
        200: {
          type: 'object',
          properties: { success: { type: 'boolean' } },
        },
        ...errorResponses,
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return userRequestService.markPasswordViewed(id);
  });
}
