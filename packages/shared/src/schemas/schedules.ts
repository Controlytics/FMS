import { z } from 'zod';

export const SCHEDULE_FREQUENCIES = [
  'HOURLY', 'PER_SHIFT', 'DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUALLY', 'CUSTOM',
] as const;

export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export const createScheduleSchema = z.object({
  nodeChecklistId: z.string().uuid('Node checklist ID is required'),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  frequencyValue: z.number().int().positive().optional(),
  cronExpression: z.string().max(100).optional(),
  toleranceBefore: z.number().int().min(0).optional(),
  toleranceAfter: z.number().int().min(0).optional(),
});

export const updateScheduleSchema = z.object({
  frequency: z.enum(SCHEDULE_FREQUENCIES).optional(),
  frequencyValue: z.number().int().positive().optional(),
  cronExpression: z.string().max(100).optional(),
  toleranceBefore: z.number().int().min(0).optional(),
  toleranceAfter: z.number().int().min(0).optional(),
  status: z.enum(['active', 'paused', 'completed']).optional(),
});

export const scheduleParamsSchema = z.object({
  id: z.string().uuid(),
});

export const scheduleNodeParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

/** Calculate next due date from last performed and frequency */
export function calculateNextDue(lastPerformed: Date, frequency: string, frequencyValue?: number): Date {
  const next = new Date(lastPerformed);
  switch (frequency) {
    case 'HOURLY':
      next.setHours(next.getHours() + (frequencyValue ?? 1));
      break;
    case 'PER_SHIFT':
      next.setHours(next.getHours() + 8);
      break;
    case 'DAILY':
      next.setDate(next.getDate() + (frequencyValue ?? 1));
      break;
    case 'WEEKLY':
      next.setDate(next.getDate() + 7 * (frequencyValue ?? 1));
      break;
    case 'MONTHLY':
      next.setMonth(next.getMonth() + (frequencyValue ?? 1));
      break;
    case 'QUARTERLY':
      next.setMonth(next.getMonth() + 3);
      break;
    case 'ANNUALLY':
      next.setFullYear(next.getFullYear() + 1);
      break;
    default:
      next.setDate(next.getDate() + 1);
  }
  return next;
}
