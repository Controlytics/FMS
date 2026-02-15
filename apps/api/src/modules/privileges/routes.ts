import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { z } from 'zod';

const createPrivilegeSchema = z.object({
  role: z.string().min(1, 'Role is required'),
  privilege: z.string().min(1, 'Privilege is required'),
  assetType: z.string().optional(),
});

export default async function privilegeRoutes(app: FastifyInstance) {
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
    schema: { tags: ['Privileges'], summary: 'Grant delegated privilege' },
    preHandler: [app.requireRole('SUPER_ADMIN')],
  }, async (req, reply) => {
    const parsed = createPrivilegeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    // Check for existing active privilege
    const existing = await prisma.delegatedPrivilege.findFirst({
      where: {
        role: parsed.data.role,
        privilege: parsed.data.privilege,
        assetType: parsed.data.assetType ?? null,
        revokedAt: null,
      },
    });
    if (existing) {
      return reply.code(409).send({ error: 'This privilege is already granted to this role' });
    }

    const priv = await prisma.delegatedPrivilege.create({
      data: {
        role: parsed.data.role,
        privilege: parsed.data.privilege,
        assetType: parsed.data.assetType,
        grantedBy: req.user.sub,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'PRIVILEGE_GRANTED',
      targetType: 'delegated_privilege', targetId: priv.id,
      afterValue: { role: parsed.data.role, privilege: parsed.data.privilege, assetType: parsed.data.assetType },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(priv);
  });

  // DELETE /api/privileges/:id — revoke
  app.delete('/:id', {
    schema: { tags: ['Privileges'], summary: 'Revoke delegated privilege' },
    preHandler: [app.requireRole('SUPER_ADMIN')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

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
