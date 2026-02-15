import { type FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';

const createPrivilegeSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  privilege: z.string().min(1, 'Privilege is required'),
  assetType: z.string().optional(),
});

const privilegeParamsSchema = z.object({
  id: z.string().uuid(),
});

export default async function privilegeRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // GET /api/privileges
  app.get('/', {
    schema: { tags: ['Privileges'], summary: 'List delegated privileges' },
    preHandler: [app.requireRole('SUPER_ADMIN')],
  }, async () => {
    return prisma.delegatedPrivilege.findMany({
      where: { revokedAt: null },
      orderBy: { grantedAt: 'desc' },
    });
  });

  // POST /api/privileges
  app.post('/', {
    schema: { tags: ['Privileges'], summary: 'Grant delegated privilege', body: createPrivilegeSchema },
    preHandler: [app.requireRole('SUPER_ADMIN')],
  }, async (req, reply) => {
    const { role, privilege, assetType } = req.body;

    // Check for existing active privilege
    const existing = await prisma.delegatedPrivilege.findFirst({
      where: {
        role,
        privilege,
        assetType: assetType ?? null,
        revokedAt: null,
      },
    });
    if (existing) {
      return reply.code(409).send({ error: 'This privilege is already granted to this role' });
    }

    const priv = await prisma.delegatedPrivilege.create({
      data: {
        role,
        privilege,
        assetType,
        grantedBy: req.user.sub,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'PRIVILEGE_GRANTED',
      targetType: 'delegated_privilege', targetId: priv.id,
      afterValue: { role, privilege, assetType },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(priv);
  });

  // DELETE /api/privileges/:id — revoke
  app.delete('/:id', {
    schema: { tags: ['Privileges'], summary: 'Revoke delegated privilege', params: privilegeParamsSchema },
    preHandler: [app.requireRole('SUPER_ADMIN')],
  }, async (req, reply) => {
    const { id } = req.params;

    const existing = await prisma.delegatedPrivilege.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Privilege not found' });
    if (existing.revokedAt) return reply.code(400).send({ error: 'Privilege already revoked' });

    await prisma.delegatedPrivilege.update({
      where: { id },
      data: { revokedAt: new Date() },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'PRIVILEGE_REVOKED',
      targetType: 'delegated_privilege', targetId: id,
      beforeValue: { role: existing.role, privilege: existing.privilege },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });
}
