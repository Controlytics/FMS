import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { computeChecksum } from '../../lib/hash-chain.js';
import {
  createChecklistTemplateSchema,
  updateChecklistTemplateSchema,
  attachChecklistSchema,
  submitChecklistRecordSchema,
  approveRejectSchema,
  calculateNextDue,
} from '@digilog/shared';

export default async function checklistRoutes(app: FastifyInstance) {
  // ─── Checklist Templates ───

  // POST /api/checklists/templates — create checklist template
  app.post('/templates', {
    schema: { tags: ['Checklists'], summary: 'Create checklist template' },
    preHandler: [app.requirePermission('TEMPLATE_CREATE')],
  }, async (req, reply) => {
    const parsed = createChecklistTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const template = await prisma.checklistTemplate.create({
      data: {
        name: parsed.data.name,
        description: parsed.data.description,
        questions: parsed.data.questions as any,
        performedByRole: parsed.data.performedByRole,
        checkedByEnabled: parsed.data.checkedByEnabled,
        checkedByRole: parsed.data.checkedByRole,
        verifiedByEnabled: parsed.data.verifiedByEnabled,
        verifiedByRole: parsed.data.verifiedByRole,
        templateId: parsed.data.templateId,
        createdBy: req.user.sub,
      },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'CHECKLIST_TEMPLATE_CREATED',
      targetType: 'checklist_template', targetId: template.id,
      afterValue: { name: template.name },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(template);
  });

  // GET /api/checklists/templates
  app.get('/templates', {
    schema: { tags: ['Checklists'], summary: 'List checklist templates' },
  }, async (req) => {
    const { status, search } = req.query as { status?: string; search?: string };
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }
    return prisma.checklistTemplate.findMany({ where: where as any, orderBy: { name: 'asc' } });
  });

  // GET /api/checklists/templates/:id
  app.get('/templates/:id', {
    schema: { tags: ['Checklists'], summary: 'Get checklist template detail' },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const template = await prisma.checklistTemplate.findUnique({
      where: { id },
      include: { _count: { select: { nodeChecklists: true } } },
    });
    if (!template) return reply.code(404).send({ error: 'Checklist template not found' });
    return template;
  });

  // PUT /api/checklists/templates/:id
  app.put('/templates/:id', {
    schema: { tags: ['Checklists'], summary: 'Update checklist template' },
    preHandler: [app.requirePermission('TEMPLATE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateChecklistTemplateSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const existing = await prisma.checklistTemplate.findUnique({ where: { id } });
    if (!existing) return reply.code(404).send({ error: 'Checklist template not found' });

    const updateData: Record<string, unknown> = {};
    if (parsed.data.name) updateData.name = parsed.data.name;
    if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
    if (parsed.data.questions) updateData.questions = parsed.data.questions;
    if (parsed.data.performedByRole !== undefined) updateData.performedByRole = parsed.data.performedByRole;
    if (parsed.data.checkedByEnabled !== undefined) updateData.checkedByEnabled = parsed.data.checkedByEnabled;
    if (parsed.data.checkedByRole !== undefined) updateData.checkedByRole = parsed.data.checkedByRole;
    if (parsed.data.verifiedByEnabled !== undefined) updateData.verifiedByEnabled = parsed.data.verifiedByEnabled;
    if (parsed.data.verifiedByRole !== undefined) updateData.verifiedByRole = parsed.data.verifiedByRole;
    if (parsed.data.status) updateData.status = parsed.data.status;
    updateData.version = existing.version + 1;

    const template = await prisma.checklistTemplate.update({ where: { id }, data: updateData });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'CHECKLIST_TEMPLATE_MODIFIED',
      targetType: 'checklist_template', targetId: id,
      beforeValue: { name: existing.name }, afterValue: updateData, reason: parsed.data.reason,
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return template;
  });

  // ─── Node Checklists ───

  // POST /api/checklists/nodes/:id — attach checklist to node
  app.post('/nodes/:id', {
    schema: { tags: ['Checklists'], summary: 'Attach checklist to node' },
    preHandler: [app.requirePermission('NODE_UPDATE')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = attachChecklistSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const node = await prisma.hierarchyNode.findUnique({ where: { id } });
    if (!node) return reply.code(404).send({ error: 'Node not found' });

    const tmpl = await prisma.checklistTemplate.findUnique({ where: { id: parsed.data.checklistTemplateId } });
    if (!tmpl) return reply.code(404).send({ error: 'Checklist template not found' });

    const nc = await prisma.nodeChecklist.create({
      data: {
        nodeId: id,
        checklistTemplateId: parsed.data.checklistTemplateId,
        enabled: parsed.data.enabled,
        overrideApproval: parsed.data.overrideApproval,
      },
      include: { checklistTemplate: { select: { id: true, name: true } } },
    });

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'CHECKLIST_ATTACHED',
      targetType: 'node_checklist', targetId: nc.id,
      afterValue: { nodeId: id, checklistTemplateId: parsed.data.checklistTemplateId },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(nc);
  });

  // GET /api/checklists/nodes/:id — list checklists for node
  app.get('/nodes/:id', {
    schema: { tags: ['Checklists'], summary: 'List checklists for node' },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const node = await prisma.hierarchyNode.findUnique({ where: { id } });
    if (!node) return reply.code(404).send({ error: 'Node not found' });

    return prisma.nodeChecklist.findMany({
      where: { nodeId: id },
      include: {
        checklistTemplate: { select: { id: true, name: true, description: true, questions: true, checkedByEnabled: true, verifiedByEnabled: true } },
        _count: { select: { records: true, schedules: true } },
      },
    });
  });

  // ─── Checklist Records ───

  // POST /api/checklists/:checklistId/records — submit record (Performed By)
  app.post('/:checklistId/records', {
    schema: { tags: ['Checklists'], summary: 'Submit checklist record' },
    preHandler: [app.requirePermission('APPROVAL_REQUEST')],
  }, async (req, reply) => {
    const { checklistId } = req.params as { checklistId: string };
    const parsed = submitChecklistRecordSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const nc = await prisma.nodeChecklist.findUnique({
      where: { id: checklistId },
      include: { checklistTemplate: true },
    });
    if (!nc) return reply.code(404).send({ error: 'Node checklist not found' });

    const tmpl = nc.checklistTemplate;

    // Determine initial status based on approval tiers
    let status = 'COMPLETED';
    if (tmpl.checkedByEnabled) status = 'PENDING_CHECK';
    if (tmpl.verifiedByEnabled && !tmpl.checkedByEnabled) status = 'PENDING_VERIFY';
    if (tmpl.checkedByEnabled) status = 'PENDING_CHECK';

    // Compute checksum for immutability
    const checksumData = {
      nodeChecklistId: checklistId,
      responses: parsed.data.responses,
      performedBy: req.user.sub,
      performedAt: new Date().toISOString(),
      performedSignature: parsed.data.performedSignature,
    };
    const checksum = computeChecksum(checksumData as Record<string, unknown>);

    const record = await prisma.checklistRecord.create({
      data: {
        nodeChecklistId: checklistId,
        responses: parsed.data.responses as any,
        status,
        performedBy: req.user.sub,
        performedAt: new Date(),
        performedSignature: parsed.data.performedSignature,
        scheduleRef: parsed.data.scheduleRef ?? 'AD_HOC',
        deviceInfo: parsed.data.deviceInfo as any,
        checksum,
      },
    });

    // If completed immediately (no approval tiers), update schedule
    if (status === 'COMPLETED') {
      await updateScheduleAfterCompletion(checklistId, record.performedAt!);
    }

    // Evaluate alarm rules after record submission
    await evaluateChecklistAlarms(nc.nodeId, record, app, req);

    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: 'CHECKLIST_RECORD_SUBMITTED',
      targetType: 'checklist_record', targetId: record.id,
      afterValue: { nodeChecklistId: checklistId, status, checksum },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return reply.code(201).send(record);
  });

  // GET /api/checklists/:checklistId/records — list records
  app.get('/:checklistId/records', {
    schema: { tags: ['Checklists'], summary: 'List records for checklist' },
  }, async (req) => {
    const { checklistId } = req.params as { checklistId: string };
    return prisma.checklistRecord.findMany({
      where: { nodeChecklistId: checklistId },
      orderBy: { createdAt: 'desc' },
    });
  });

  // GET /api/checklists/records/:id — get single record
  app.get('/records/:id', {
    schema: { tags: ['Checklists'], summary: 'Get checklist record detail' },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const record = await prisma.checklistRecord.findUnique({
      where: { id },
      include: {
        nodeChecklist: {
          include: {
            checklistTemplate: { select: { id: true, name: true, questions: true } },
            node: { select: { id: true, name: true, nodeType: true } },
          },
        },
      },
    });
    if (!record) return reply.code(404).send({ error: 'Record not found' });
    return record;
  });

  // POST /api/checklists/records/:id/check — Checked By approve/reject
  app.post('/records/:id/check', {
    schema: { tags: ['Checklists'], summary: 'Check (approve/reject) a record' },
    preHandler: [app.requirePermission('APPROVAL_REVIEW')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = approveRejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const record = await prisma.checklistRecord.findUnique({
      where: { id },
      include: { nodeChecklist: { include: { checklistTemplate: true } } },
    });
    if (!record) return reply.code(404).send({ error: 'Record not found' });
    if (record.status !== 'PENDING_CHECK') {
      return reply.code(400).send({ error: `Record is not pending check (current: ${record.status})` });
    }

    // Segregation of duties
    if (record.performedBy === req.user.sub) {
      return reply.code(403).send({ error: 'Segregation of duties: performer cannot also check' });
    }

    const tmpl = record.nodeChecklist.checklistTemplate;
    let newStatus: string;
    if (parsed.data.action === 'REJECT') {
      newStatus = 'REJECTED';
    } else {
      newStatus = tmpl.verifiedByEnabled ? 'PENDING_VERIFY' : 'COMPLETED';
    }

    const updated = await prisma.checklistRecord.update({
      where: { id },
      data: {
        status: newStatus,
        checkedBy: req.user.sub,
        checkedAt: new Date(),
        checkedSignature: parsed.data.signature,
        checkComments: parsed.data.comments,
      },
    });

    if (newStatus === 'COMPLETED') {
      await updateScheduleAfterCompletion(record.nodeChecklistId, updated.checkedAt!);
    }

    const auditAction = parsed.data.action === 'REJECT' ? 'CHECKLIST_RECORD_REJECTED' : 'CHECKLIST_RECORD_CHECKED';
    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: auditAction,
      targetType: 'checklist_record', targetId: id,
      afterValue: { status: newStatus, comments: parsed.data.comments },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return updated;
  });

  // POST /api/checklists/records/:id/verify — Verified By approve/reject
  app.post('/records/:id/verify', {
    schema: { tags: ['Checklists'], summary: 'Verify (approve/reject) a record' },
    preHandler: [app.requirePermission('APPROVAL_REVIEW')],
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = approveRejectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    }

    const record = await prisma.checklistRecord.findUnique({ where: { id } });
    if (!record) return reply.code(404).send({ error: 'Record not found' });
    if (record.status !== 'PENDING_VERIFY') {
      return reply.code(400).send({ error: `Record is not pending verification (current: ${record.status})` });
    }

    // Segregation of duties
    if (record.performedBy === req.user.sub || record.checkedBy === req.user.sub) {
      return reply.code(403).send({ error: 'Segregation of duties: verifier cannot be performer or checker' });
    }

    const newStatus = parsed.data.action === 'REJECT' ? 'REJECTED' : 'COMPLETED';

    const updated = await prisma.checklistRecord.update({
      where: { id },
      data: {
        status: newStatus,
        verifiedBy: req.user.sub,
        verifiedAt: new Date(),
        verifiedSignature: parsed.data.signature,
        verifyComments: parsed.data.comments,
      },
    });

    if (newStatus === 'COMPLETED') {
      await updateScheduleAfterCompletion(record.nodeChecklistId, updated.verifiedAt!);
    }

    const auditAction = parsed.data.action === 'REJECT' ? 'CHECKLIST_RECORD_REJECTED' : 'CHECKLIST_RECORD_VERIFIED';
    await app.auditLog({
      userId: req.user.username, userRole: req.user.role, action: auditAction,
      targetType: 'checklist_record', targetId: id,
      afterValue: { status: newStatus, comments: parsed.data.comments },
      ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
    });

    return updated;
  });
}

/** After a record is COMPLETED, update associated schedule's lastPerformedAt and nextDueAt */
async function updateScheduleAfterCompletion(nodeChecklistId: string, completedAt: Date) {
  const schedules = await prisma.schedule.findMany({
    where: { nodeChecklistId, status: 'active' },
  });

  for (const schedule of schedules) {
    const nextDue = calculateNextDue(completedAt, schedule.frequency, schedule.frequencyValue ?? undefined);
    await prisma.schedule.update({
      where: { id: schedule.id },
      data: {
        lastPerformedAt: completedAt,
        nextDueAt: nextDue,
        isOnboarding: false,
      },
    });
  }
}

/** Evaluate CHECKLIST_FIELD alarm rules after record submission */
async function evaluateChecklistAlarms(
  nodeId: string,
  record: { id: string; responses: unknown },
  app: FastifyInstance,
  req: any,
) {
  const rules = await prisma.alarmRule.findMany({
    where: { nodeId, enabled: true, ruleType: 'CHECKLIST_FIELD' },
  });

  const responses = record.responses as Record<string, unknown>;

  for (const rule of rules) {
    const config = rule.config as { field?: string; operator?: string; value?: unknown; severity?: string };
    if (!config.field || !config.operator) continue;

    const actual = responses[config.field];
    if (actual === undefined) continue;

    let triggered = false;
    const numActual = Number(actual);
    const numExpected = Number(config.value);

    switch (config.operator) {
      case 'gt': triggered = numActual > numExpected; break;
      case 'gte': triggered = numActual >= numExpected; break;
      case 'lt': triggered = numActual < numExpected; break;
      case 'lte': triggered = numActual <= numExpected; break;
      case 'eq': triggered = actual === config.value; break;
      case 'neq': triggered = actual !== config.value; break;
    }

    if (triggered) {
      await prisma.alarmEvent.create({
        data: {
          alarmRuleId: rule.id,
          nodeId,
          severity: config.severity ?? 'WARNING',
          triggerValue: { field: config.field, actual: String(actual), threshold: String(config.value ?? '') },
          recordId: record.id,
        },
      });

      await app.auditLog({
        userId: req.user.username, userRole: req.user.role, action: 'ALARM_EVENT_TRIGGERED',
        targetType: 'alarm_event', targetId: rule.id,
        afterValue: { ruleName: rule.name, field: config.field, actual, threshold: config.value },
        ipAddress: req.ip, userAgent: req.headers['user-agent'], sessionId: req.user.sessionId,
      });
    }
  }
}
