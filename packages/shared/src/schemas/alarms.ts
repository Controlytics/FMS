import { z } from 'zod';

export const ALARM_RULE_TYPES = ['THRESHOLD', 'CHECKLIST_FIELD', 'SCHEDULE_MISSED', 'CUSTOM'] as const;
export const ALARM_SEVERITIES = ['INFO', 'WARNING', 'ALARM', 'CRITICAL'] as const;
export const ALARM_EVENT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'CLOSED'] as const;

export type AlarmRuleType = (typeof ALARM_RULE_TYPES)[number];
export type AlarmSeverity = (typeof ALARM_SEVERITIES)[number];
export type AlarmEventStatus = (typeof ALARM_EVENT_STATUSES)[number];

export const alarmRuleConfigSchema = z.object({
  field: z.string().optional(),
  operator: z.enum(['gt', 'gte', 'lt', 'lte', 'eq', 'neq', 'contains']).optional(),
  value: z.unknown().optional(),
  severity: z.enum(ALARM_SEVERITIES).default('WARNING'),
  notifyRoles: z.array(z.string()).default([]),
  blockTransition: z.boolean().default(false),
});

export const createAlarmRuleSchema = z.object({
  nodeId: z.string().uuid('Node ID is required'),
  name: z.string().min(1, 'Name is required').max(255),
  ruleType: z.enum(ALARM_RULE_TYPES),
  config: alarmRuleConfigSchema,
  enabled: z.boolean().default(true),
});

export const updateAlarmRuleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  ruleType: z.enum(ALARM_RULE_TYPES).optional(),
  config: alarmRuleConfigSchema.optional(),
  enabled: z.boolean().optional(),
});

export const alarmRuleParamsSchema = z.object({
  id: z.string().uuid(),
});

export const alarmEventsQuerySchema = z.object({
  nodeId: z.string().uuid().optional(),
  status: z.enum(ALARM_EVENT_STATUSES).optional(),
  severity: z.enum(ALARM_SEVERITIES).optional(),
});

export const alarmEventParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateAlarmRuleInput = z.infer<typeof createAlarmRuleSchema>;
export type UpdateAlarmRuleInput = z.infer<typeof updateAlarmRuleSchema>;
