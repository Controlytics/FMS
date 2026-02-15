import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { createScheduleSchema, updateScheduleSchema, calculateNextDue } from '@digilog/shared';

export default async function scheduleRoutes(app: FastifyInstance) {
  // POST /api/schedules — create schedule
  app.post('/', {
    schema: { tags: ['Schedules'], summary: 'Create schedule' },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const parsed = createScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const nc = await prisma.nodeChecklist.findUnique({ where: { id: parsed.data.nodeChecklistId } });
    if (!nc) return reply.code(404).send({ error: 'Node checklist not found' });

    const schedule = await prisma.schedule.create({
      data: {
        nodeChecklistId: parsed.data.nodeChecklistId,
        frequency: parsed.data.frequency,
        frequencyValue: parsed.data.frequencyValue,
        cronExpression: parsed.data.cronExpression,
        toleranceBefore: parsed.data.toleranceBefore,
        toleranceAfter: parsed.data.toleranceAfter,
        isOnboarding: true,
        createdBy: req.user.sub,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'SCHEDULE_CREATED',
      targetType: 'schedule', targetId: schedule.id,
      afterValue: { nodeChecklistId: parsed.data.nodeChecklistId, frequency: parsed.data.frequency },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(schedule);
  });

  // GET /api/schedules/node/:id — get schedules for a node
  app.get('/node/:id', {
    schema: { tags: ['Schedules'], summary: 'Get schedules for node' },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

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
    schema: { tags: ['Schedules'], summary: 'Update schedule' },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.schedule.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Schedule not found' });

    const updateData: Record<string, unknown> = {};
    if (parsed.data.frequency) updateData.frequency = parsed.data.frequency;
    if (parsed.data.frequencyValue !== undefined) updateData.frequencyValue = parsed.data.frequencyValue;
    if (parsed.data.cronExpression !== undefined) updateData.cronExpression = parsed.data.cronExpression;
    if (parsed.data.toleranceBefore !== undefined) updateData.toleranceBefore = parsed.data.toleranceBefore;
    if (parsed.data.toleranceAfter !== undefined) updateData.toleranceAfter = parsed.data.toleranceAfter;
    if (parsed.data.status) updateData.status = parsed.data.status;

    // Recalculate nextDueAt if frequency changed and we have a lastPerformedAt
    if (parsed.data.frequency && existing.lastPerformedAt) {
      updateData.nextDueAt = calculateNextDue(
        existing.lastPerformedAt,
        parsed.data.frequency,
        parsed.data.frequencyValue ?? existing.frequencyValue ?? undefined,
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
    schema: { tags: ['Schedules'], summary: 'Delete schedule' },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };

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
