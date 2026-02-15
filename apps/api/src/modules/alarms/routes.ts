import { type FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { prisma } from '../../lib/prisma.js';
import { createAlarmRuleSchema, updateAlarmRuleSchema, alarmRuleParamsSchema, alarmEventsQuerySchema, alarmEventParamsSchema } from '@digilog/shared';

export default async function alarmRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // POST /api/alarms/rules — create alarm rule
  app.post('/rules', {
    schema: { tags: ['Alarms'], summary: 'Create alarm rule', body: createAlarmRuleSchema },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const node = await prisma.hierarchyNode.findUnique({ where: { id: req.body.nodeId } });
    if (!node) return reply.code(404).send({ error: 'Node not found' });

    const rule = await prisma.alarmRule.create({
      data: {
        nodeId: req.body.nodeId,
        name: req.body.name,
        ruleType: req.body.ruleType,
        config: req.body.config as any,
        enabled: req.body.enabled,
        createdBy: req.user.sub,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'ALARM_RULE_CREATED',
      targetType: 'alarm_rule', targetId: rule.id,
      afterValue: { name: rule.name, ruleType: rule.ruleType, nodeId: req.body.nodeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(rule);
  });

  // GET /api/alarms/rules/node/:id — get alarm rules for a node
  app.get('/rules/node/:id', {
    schema: { tags: ['Alarms'], summary: 'Get alarm rules for node', params: alarmRuleParamsSchema },
  }, async (req) => {
    const { id } = req.params;
    return prisma.alarmRule.findMany({
      where: { nodeId: id },
      include: { _count: { select: { events: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  // PUT /api/alarms/rules/:id
  app.put('/rules/:id', {
    schema: { tags: ['Alarms'], summary: 'Update alarm rule', params: alarmRuleParamsSchema, body: updateAlarmRuleSchema },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params;

    const existing = await prisma.alarmRule.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Alarm rule not found' });

    const updateData: Record<string, unknown> = {};
    if (req.body.name) updateData.name = req.body.name;
    if (req.body.ruleType) updateData.ruleType = req.body.ruleType;
    if (req.body.config) updateData.config = req.body.config;
    if (req.body.enabled !== undefined) updateData.enabled = req.body.enabled;
    updateData.version = existing.version + 1;

    const rule = await prisma.alarmRule.update({ where: { id }, data: updateData });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'ALARM_RULE_MODIFIED',
      targetType: 'alarm_rule', targetId: id,
      beforeValue: { name: existing.name, enabled: existing.enabled },
      afterValue: updateData,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return rule;
  });

  // GET /api/alarms/events — list alarm events with filters
  app.get('/events', {
    schema: { tags: ['Alarms'], summary: 'List alarm events', querystring: alarmEventsQuerySchema },
  }, async (req) => {
    const where: Record<string, unknown> = {};
    if (req.query.nodeId) where.nodeId = req.query.nodeId;
    if (req.query.status) where.status = req.query.status;
    if (req.query.severity) where.severity = req.query.severity;

    return prisma.alarmEvent.findMany({
      where: where as any,
      include: { alarmRule: { select: { id: true, name: true, ruleType: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  // GET /api/alarms/events/node/:id — list alarm events for a node
  app.get('/events/node/:id', {
    schema: { tags: ['Alarms'], summary: 'List alarm events for node', params: alarmEventParamsSchema },
  }, async (req) => {
    const { id } = req.params;
    return prisma.alarmEvent.findMany({
      where: { nodeId: id },
      include: { alarmRule: { select: { id: true, name: true, ruleType: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  // POST /api/alarms/events/:id/acknowledge
  app.post('/events/:id/acknowledge', {
    schema: { tags: ['Alarms'], summary: 'Acknowledge alarm event', params: alarmEventParamsSchema },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params;
    const event = await prisma.alarmEvent.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'Alarm event not found' });
    if (event.status !== 'OPEN') {
      return reply.code(400).send({ error: `Event is not open (current: ${event.status})` });
    }

    const updated = await prisma.alarmEvent.update({
      where: { id },
      data: { status: 'ACKNOWLEDGED', acknowledgedBy: req.user.sub, acknowledgedAt: new Date() },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'ALARM_EVENT_ACKNOWLEDGED',
      targetType: 'alarm_event', targetId: id,
      afterValue: { status: 'ACKNOWLEDGED' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return updated;
  });

  // POST /api/alarms/events/:id/close
  app.post('/events/:id/close', {
    schema: { tags: ['Alarms'], summary: 'Close alarm event', params: alarmEventParamsSchema },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params;
    const event = await prisma.alarmEvent.findUnique({ where: { id } });
    if (!event) return reply.code(404).send({ error: 'Alarm event not found' });
    if (event.status === 'CLOSED') {
      return reply.code(400).send({ error: 'Event is already closed' });
    }

    const updated = await prisma.alarmEvent.update({
      where: { id },
      data: { status: 'CLOSED', closedBy: req.user.sub, closedAt: new Date() },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'ALARM_EVENT_CLOSED',
      targetType: 'alarm_event', targetId: id,
      afterValue: { status: 'CLOSED' },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return updated;
  });
}
