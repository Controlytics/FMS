import { z } from 'zod';

export const alarmSeverityEnum = z.enum(['INFO', 'WARNING', 'CRITICAL']);
export const alarmRuleTypeEnum = z.enum([
  'TELEMETRY_THRESHOLD', 'CHECKLIST_LOGIC', 'SCHEDULE_MISSED', 'CUSTOM_SCRIPT',
]);

export const createAlarmRuleSchema = z.object({
  assetId: z.string().uuid(),
  name: z.string().min(1).max(255),
  ruleType: alarmRuleTypeEnum,
  telemetryPointId: z.string().uuid().optional(),
  checklistTemplateId: z.string().uuid().optional(),
  condition: z.record(z.unknown()),
  severity: alarmSeverityEnum,
  actions: z.array(z.object({
    actionType: z.enum(['NOTIFY', 'BLOCK_TRANSITION', 'FLAG_REVIEW', 'CREATE_DEVIATION']),
    notifyRoles: z.array(z.string()).optional(),
    notifyUsers: z.array(z.string()).optional(),
    blockTransitionTo: z.string().optional(),
    message: z.string().optional(),
  })).default([]),
  isActive: z.boolean().default(true),
});

export const updateAlarmRuleSchema = createAlarmRuleSchema.partial().omit({ assetId: true });

export type AlarmSeverity = z.infer<typeof alarmSeverityEnum>;
export type AlarmRuleType = z.infer<typeof alarmRuleTypeEnum>;
export type CreateAlarmRuleInput = z.infer<typeof createAlarmRuleSchema>;
export type UpdateAlarmRuleInput = z.infer<typeof updateAlarmRuleSchema>;
