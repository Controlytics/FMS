import type { PasswordPolicyConfig } from '@digilog/shared';

// The one temporary-password generator lives in @digilog/shared so the API's
// Admin Requests approvals produce the same policy-length password as these
// pages (they used to be 14 vs minLength). Re-exported to keep import paths.
export { generatePassword } from '@digilog/shared';

export const DEFAULT_PASSWORD_POLICY: PasswordPolicyConfig = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  minUppercase: 1,
  minLowercase: 1,
  minNumbers: 1,
  minSpecialChars: 1,
  preventReuseCount: 12,
  cannotBeUserId: true,
  cannotContainUserId: true,
  maxFailedAttempts: 5,
  passwordExpiryDays: 90,
  expiryNotificationDays: 0,
  autoLogoutEnabled: true,
  idleTimeoutMinutes: 15,
  warningMinutes: 2,
};
