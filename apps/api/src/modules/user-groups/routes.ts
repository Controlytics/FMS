/**
 * User Groups Routes — CRUD for user groups and membership management.
 */
import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { buildContext } from '../../lib/build-context.js';
import { auditLog } from '../../lib/audit.js';

export default async function userGroupRoutes(app: FastifyInstance) {

  // GET /api/user-groups — list all groups with member count
  app.get('/', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: { tags: ['User Groups'], summary: 'List user groups' },
  }, async (req) => {
    const groups = await prisma.userGroup.findMany({
      include: { _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
    return groups.map(g => ({
      ...g,
      memberCount: g._count.members,
      _count: undefined,
    }));
  });

  // POST /api/user-groups — create group
  app.post('/', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['User Groups'],
      summary: 'Create user group',
      body: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (req) => {
    const { name, description } = req.body as { name: string; description?: string };
    const ctx = buildContext(req);
    const group = await prisma.userGroup.create({
      data: { name, description, createdBy: ctx.userId },
    });
    await auditLog({ action: 'USER_GROUP_CREATED', targetType: 'UserGroup', targetId: group.id, afterValue: { name }, userId: ctx.userId, userRole: ctx.userRole });
    return group;
  });

  // PUT /api/user-groups/:id — update group
  app.put('/:id', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['User Groups'],
      summary: 'Update user group',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 100 },
          description: { type: 'string', maxLength: 500 },
          isActive: { type: 'boolean' },
        },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const group = await prisma.userGroup.update({ where: { id }, data: body as any });
    return group;
  });

  // DELETE /api/user-groups/:id
  app.delete('/:id', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['User Groups'],
      summary: 'Delete user group',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    await prisma.userGroup.delete({ where: { id } });
    return { success: true };
  });

  // GET /api/user-groups/:id/members — list group members
  app.get('/:id/members', {
    preHandler: [app.requirePermission('CONFIG_READ')],
    schema: {
      tags: ['User Groups'],
      summary: 'List group members',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const members = await prisma.userGroupMember.findMany({
      where: { groupId: id },
      orderBy: { createdAt: 'asc' },
    });
    // Fetch user details
    const userIds = members.map(m => m.userId);
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, username: true, fullName: true, email: true, role: true, status: true },
    });
    const userMap = new Map(users.map(u => [u.id, u]));
    return members.map(m => ({
      id: m.id,
      userId: m.userId,
      createdAt: m.createdAt,
      user: userMap.get(m.userId) ?? null,
    }));
  });

  // POST /api/user-groups/:id/members — add users to group
  app.post('/:id/members', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['User Groups'],
      summary: 'Add users to group',
      params: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      body: {
        type: 'object',
        required: ['userIds'],
        properties: { userIds: { type: 'array', items: { type: 'string' } } },
      },
    },
  }, async (req) => {
    const { id } = req.params as { id: string };
    const { userIds } = req.body as { userIds: string[] };
    const data = userIds.map(userId => ({ groupId: id, userId }));
    await prisma.userGroupMember.createMany({ data, skipDuplicates: true });
    return { success: true, added: userIds.length };
  });

  // DELETE /api/user-groups/:id/members/:userId — remove user from group
  app.delete('/:id/members/:userId', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
    schema: {
      tags: ['User Groups'],
      summary: 'Remove user from group',
      params: {
        type: 'object',
        properties: { id: { type: 'string' }, userId: { type: 'string' } },
        required: ['id', 'userId'],
      },
    },
  }, async (req) => {
    const { id, userId } = req.params as { id: string; userId: string };
    await prisma.userGroupMember.deleteMany({ where: { groupId: id, userId } });
    return { success: true };
  });
}
