import { z } from 'zod';

export const passwordPolicySchema = z.object({
  minLength: z.number().min(8).max(32).default(8),
  maxLength: z.number().min(32).max(128).default(128),
  requireUppercase: z.boolean().default(true),
  requireLowercase: z.boolean().default(true),
  requireNumbers: z.boolean().default(true),
  requireSpecialChars: z.boolean().default(true),
  minUppercase: z.number().min(0).default(1),
  minLowercase: z.number().min(0).default(1),
  minNumbers: z.number().min(0).default(1),
  minSpecialChars: z.number().min(0).default(1),
  preventReuseCount: z.number().min(1).max(24).default(12),
  cannotBeUserId: z.boolean().default(true),
  cannotContainUserId: z.boolean().default(true),
});

export const loginSecuritySchema = z.object({
  maxFailedAttempts: z.number().min(3).max(10).default(5),
  lockoutType: z.enum(['TEMPORARY', 'PERMANENT']).default('TEMPORARY'),
  lockoutDurationMinutes: z.number().min(15).max(1440).default(30),
});

export const sessionConfigSchema = z.object({
  autoLogoutEnabled: z.boolean().default(true),
  idleTimeoutMinutes: z.number().min(5).max(60).default(15),
  warningMinutes: z.number().min(1).max(5).default(2),
});

export const datetimeConfigSchema = z.object({
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'MMM DD, YYYY']).default('DD/MM/YYYY'),
  timeFormat: z.enum(['12-hour', '24-hour']).default('24-hour'),
  timezone: z.string().default('UTC'),
});

export type PasswordPolicyConfig = z.infer<typeof passwordPolicySchema>;
export type LoginSecurityConfig = z.infer<typeof loginSecuritySchema>;
export type SessionConfig = z.infer<typeof sessionConfigSchema>;
export type DatetimeConfig = z.infer<typeof datetimeConfigSchema>;
