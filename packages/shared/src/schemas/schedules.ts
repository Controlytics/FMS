import { z } from 'zod';

export const frequencyEnum = z.enum([
  'HOURLY', 'PER_SHIFT', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'CUSTOM',
]);

export const createScheduleSchema = z.object({
  assetId: z.string().uuid(),
  checklistTemplateId: z.string().uuid(),
  frequency: frequencyEnum,
  frequencyValue: z.number().int().positive().optional(),
  cronExpression: z.string().max(100).optional(),
  toleranceMinutes: z.number().int().min(0).default(0),
  lastPerformedAt: z.string().datetime().nullable().optional(),
  isOnboarding: z.boolean().default(false),
});

export const updateScheduleSchema = z.object({
  frequency: frequencyEnum.optional(),
  frequencyValue: z.number().int().positive().optional(),
  cronExpression: z.string().max(100).optional(),
  toleranceMinutes: z.number().int().min(0).optional(),
  lastPerformedAt: z.string().datetime().nullable().optional(),
  isOnboarding: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional(),
});

export type Frequency = z.infer<typeof frequencyEnum>;
export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;
