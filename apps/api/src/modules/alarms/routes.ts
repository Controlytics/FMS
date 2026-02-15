import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { createAlarmRuleSchema, updateAlarmRuleSchema } from '@digilog/shared';

export default async function alarmRoutes(app: FastifyInstance) {
  // POST /api/alarms/rules — create alarm rule
  app.post('/rules', {
    schema: { tags: ['Alarms'], summary: 'Create alarm rule' },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const parsed = createAlarmRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const node = await prisma.hierarchyNode.findUnique({ where: { id: parsed.data.nodeId } });
    if (!node) return reply.code(404).send({ error: 'Node not found' });

    const rule = await prisma.alarmRule.create({
      data: {
        nodeId: parsed.data.nodeId,
        name: parsed.data.name,
        ruleType: parsed.data.ruleType,
        config: parsed.data.config as any,
        enabled: parsed.data.enabled,
        createdBy: req.user.sub,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'ALARM_RULE_CREATED',
      targetType: 'alarm_rule', targetId: rule.id,
      afterValue: { name: rule.name, ruleType: rule.ruleType, nodeId: parsed.data.nodeId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(rule);
  });

  // GET /api/alarms/rules/node/:id — get alarm rules for a node
  app.get('/rules/node/:id', {
    schema: { tags: ['Alarms'], summary: 'Get alarm rules for node' },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return prisma.alarmRule.findMany({
      where: { nodeId: id },
      include: { _count: { select: { events: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  // PUT /api/alarms/rules/:id
  app.put('/rules/:id', {
    schema: { tags: ['Alarms'], summary: 'Update alarm rule' },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateAlarmRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.alarmRule.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Alarm rule not found' });

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name) updateData.name = parsed.data.name;
    if (parsed.data.ruleType) updateData.ruleType = parsed.data.ruleType;
    if (parsed.data.config) updateData.config = parsed.data.config;
    if (parsed.data.enabled !== undefined) updateData.enabled = parsed.data.enabled;
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
    schema: { tags: ['Alarms'], summary: 'List alarm events' },
  }, async (req) => {
    const { nodeId, status, severity } = req.query as { nodeId?: string; status?: string; severity?: string };
    const where: Record<string, unknown> = {};
    if (nodeId) where.nodeId = nodeId;
    if (status) where.status = status;
    if (severity) where.severity = severity;

    return prisma.alarmEvent.findMany({
      where: where as any,
      include: { alarmRule: { select: { id: true, name: true, ruleType: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  // GET /api/alarms/events/node/:id — list alarm events for a node
  app.get('/events/node/:id', {
    schema: { tags: ['Alarms'], summary: 'List alarm events for node' },
  }, async (req) => {
    const { id } = req.params as { id: string };
    return prisma.alarmEvent.findMany({
      where: { nodeId: id },
      include: { alarmRule: { select: { id: true, name: true, ruleType: true } } },
      orderBy: { createdAt: 'desc' },
    });
  });

  // POST /api/alarms/events/:id/acknowledge
  app.post('/events/:id/acknowledge', {
    schema: { tags: ['Alarms'], summary: 'Acknowledge alarm event' },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
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
    schema: { tags: ['Alarms'], summary: 'Close alarm event' },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
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
