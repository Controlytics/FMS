import type { PasswordPolicyConfig } from '@digilog/shared';

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

export function generatePassword(policy: PasswordPolicyConfig): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  let password = '';
  const allChars: string[] = [];

  if (policy.requireUppercase) {
    for (let i = 0; i < policy.minUppercase; i++) {
      password += uppercase[Math.floor(Math.random() * uppercase.length)];
    }
    allChars.push(...uppercase.split(''));
  }

  if (policy.requireLowercase) {
    for (let i = 0; i < policy.minLowercase; i++) {
      password += lowercase[Math.floor(Math.random() * lowercase.length)];
    }
    allChars.push(...lowercase.split(''));
  }

  if (policy.requireNumbers) {
    for (let i = 0; i < policy.minNumbers; i++) {
      password += numbers[Math.floor(Math.random() * numbers.length)];
    }
    allChars.push(...numbers.split(''));
  }

  if (policy.requireSpecialChars) {
    for (let i = 0; i < policy.minSpecialChars; i++) {
      password += special[Math.floor(Math.random() * special.length)];
    }
    allChars.push(...special.split(''));
  }

  const targetLength = Math.max(policy.minLength, password.length + 4);
  while (password.length < targetLength) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  return password.split('').sort(() => Math.random() - 0.5).join('');
}
