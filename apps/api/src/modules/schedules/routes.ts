import { type FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma.js';
import { createScheduleSchema, updateScheduleSchema, calculateNextDue, scheduleParamsSchema, scheduleNodeParamsSchema } from '@digilog/shared';

export default async function scheduleRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /api/schedules — create schedule
  app.post('/', {
    schema: { tags: ['Schedules'], summary: 'Create schedule', body: createScheduleSchema },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const nc = await prisma.nodeChecklist.findUnique({ where: { id: req.body.nodeChecklistId } });
    if (!nc) return reply.code(404).send({ error: 'Node checklist not found' });

    const schedule = await prisma.schedule.create({
      data: {
        nodeChecklistId: req.body.nodeChecklistId,
        frequency: req.body.frequency,
        frequencyValue: req.body.frequencyValue,
        cronExpression: req.body.cronExpression,
        toleranceBefore: req.body.toleranceBefore,
        toleranceAfter: req.body.toleranceAfter,
        isOnboarding: true,
        createdBy: req.user.sub,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'SCHEDULE_CREATED',
      targetType: 'schedule', targetId: schedule.id,
      afterValue: { nodeChecklistId: req.body.nodeChecklistId, frequency: req.body.frequency },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(schedule);
  });

  // GET /api/schedules/node/:id — get schedules for a node
  app.get('/node/:id', {
    schema: { tags: ['Schedules'], summary: 'Get schedules for node', params: scheduleNodeParamsSchema },
  }, async (req) => {
    const { id } = req.params;

    const schedules = await prisma.schedule.findMany({
      where: {
        nodeChecklist: { nodeId: id },
      },
      include: {
        nodeChecklist: {
          include: { checklistTemplate: { select: { id: true, name: true } } },
        },
      },
      orderBy: { nextDueAt: 'asc' },
    });

    return schedules;
  });

  // PUT /api/schedules/:id
  app.put('/:id', {
    schema: { tags: ['Schedules'], summary: 'Update schedule', params: scheduleParamsSchema, body: updateScheduleSchema },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params;

    const existing = await prisma.schedule.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Schedule not found' });

    const updateData: Record<string, unknown> = {};
    if (req.body.frequency) updateData.frequency = req.body.frequency;
    if (req.body.frequencyValue !== undefined) updateData.frequencyValue = req.body.frequencyValue;
    if (req.body.cronExpression !== undefined) updateData.cronExpression = req.body.cronExpression;
    if (req.body.toleranceBefore !== undefined) updateData.toleranceBefore = req.body.toleranceBefore;
    if (req.body.toleranceAfter !== undefined) updateData.toleranceAfter = req.body.toleranceAfter;
    if (req.body.status) updateData.status = req.body.status;

    // Recalculate nextDueAt if frequency changed and we have a lastPerformedAt
    if (req.body.frequency && existing.lastPerformedAt) {
      updateData.nextDueAt = calculateNextDue(
        existing.lastPerformedAt,
        req.body.frequency,
        req.body.frequencyValue ?? existing.frequencyValue ?? undefined,
      );
    }

    const schedule = await prisma.schedule.update({ where: { id }, data: updateData });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'SCHEDULE_MODIFIED',
      targetType: 'schedule', targetId: id,
      beforeValue: { frequency: existing.frequency, status: existing.status },
      afterValue: updateData,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return schedule;
  });

  // DELETE /api/schedules/:id
  app.delete('/:id', {
    schema: { tags: ['Schedules'], summary: 'Delete schedule', params: scheduleParamsSchema },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params;

    const existing = await prisma.schedule.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Schedule not found' });

    await prisma.schedule.delete({ where: { id } });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'SCHEDULE_DELETED',
      targetType: 'schedule', targetId: id,
      beforeValue: { frequency: existing.frequency, nodeChecklistId: existing.nodeChecklistId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return { success: true };
  });
}
