import { z } from 'zod';

export const brandingConfigSchema = z.object({
  // Logo & App Identity
  appName: z.string().min(1).max(50).default('DigiLog'),
  appTagline: z.string().max(100).default('21 CFR Part 11 Compliant Digital Logbook'),
  logoText: z.string().min(1).max(5).default('DL'),
  logoUrl: z.string().max(500000).default(''), // URL or data URI for logo image (large for base64)

  // Company Info
  companyName: z.string().min(1).max(100).default('Controlytics AI Pvt Ltd'),
  version: z.string().min(1).max(20).default('1.0'),

  // Colors
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#1e3a5f'),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3b82f6'),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#8b5cf6'),

  // Gradient colors for decorative elements
  gradientStart: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3b82f6'),
  gradientMiddle: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#8b5cf6'),
  gradientEnd: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#ec4899'),

  // Background colors
  loginBgStart: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#0f172a'),
  loginBgEnd: z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#1e3a5f'),
});

export const passwordPolicySchema = z.object({
  // Password Settings
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

  // Login Security Settings (moved from loginSecuritySchema)
  maxFailedAttempts: z.number().min(3).max(10).default(5),

  // Password Expiry
  passwordExpiryDays: z.number().min(0).max(365).default(90), // 0 = disabled

  // Session Settings (moved from sessionConfigSchema)
  autoLogoutEnabled: z.boolean().default(true),
  idleTimeoutMinutes: z.number().min(5).max(60).default(15),
  warningMinutes: z.number().min(1).max(5).default(2),
});

// Keep these schemas for backward compatibility with existing data
export const loginSecuritySchema = z.object({
  maxFailedAttempts: z.number().min(3).max(10).default(5),
  lockoutType: z.enum(['TEMPORARY', 'PERMANENT']).default('TEMPORARY'),
  lockoutDurationMinutes: z.number().min(15).max(1440).default(30),
});

export const sessionConfigSchema = z.object({
  sessionDurationHours: z.number().min(1).max(24).default(8),
  autoLogoutEnabled: z.boolean().default(true),
  idleTimeoutMinutes: z.number().min(5).max(60).default(15),
  warningMinutes: z.number().min(1).max(5).default(2),
});

export const datetimeConfigSchema = z.object({
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'MMM DD, YYYY']).default('DD/MM/YYYY'),
  timeFormat: z.enum(['12-hour', '24-hour']).default('24-hour'),
  timezone: z.literal('Asia/Kolkata').default('Asia/Kolkata'),
});

// User ID Configuration Schema
export const userIdConfigSchema = z.object({
  // Format type
  format: z.enum([
    'NUMBERS_ONLY',           // e.g., 12345
    'LETTERS_ONLY',           // e.g., ABCDE
    'LETTERS_NUMBERS',        // e.g., ABC123
    'PREFIX_NUMBERS',         // e.g., EMP001
    'PREFIX_LETTERS',         // e.g., USR-ABC
    'PREFIX_LETTERS_NUMBERS', // e.g., EMP-AB12
    'CUSTOM_PATTERN',         // Custom regex pattern
  ]).default('LETTERS_NUMBERS'),

  // Length settings (fixed length)
  length: z.number().min(3).max(20).default(6),

  // Prefix settings (when format includes PREFIX_*)
  prefix: z.string().max(10).default(''),
  prefixSeparator: z.enum(['-', '_', '', '/']).default('-'),

  // Case settings for letters
  letterCase: z.enum(['UPPERCASE', 'LOWERCASE', 'MIXED']).default('UPPERCASE'),

  // Auto-generation settings
  autoGenerate: z.boolean().default(false),
  startNumber: z.number().min(1).default(1),

  // Custom pattern (regex) - only used when format is CUSTOM_PATTERN
  customPattern: z.string().max(100).default(''),
  customPatternExample: z.string().max(50).default(''),
  customPatternDescription: z.string().max(200).default(''),
});

// Audit Templates Configuration Schema
export const auditTemplatesSchema = z.record(z.string(), z.string());

// Pagination Configuration Schema
export const paginationConfigSchema = z.object({
  options: z.tuple([
    z.number().min(5).max(100),
    z.number().min(5).max(100),
    z.number().min(5).max(100),
  ]).default([10, 25, 50]),
});

export type BrandingConfig = z.infer<typeof brandingConfigSchema>;
export type PasswordPolicyConfig = z.infer<typeof passwordPolicySchema>;
export type LoginSecurityConfig = z.infer<typeof loginSecuritySchema>;
export type SessionConfig = z.infer<typeof sessionConfigSchema>;
export type DatetimeConfig = z.infer<typeof datetimeConfigSchema>;
export type UserIdConfig = z.infer<typeof userIdConfigSchema>;
export type AuditTemplatesConfig = z.infer<typeof auditTemplatesSchema>;
export type PaginationConfig = z.infer<typeof paginationConfigSchema>;
