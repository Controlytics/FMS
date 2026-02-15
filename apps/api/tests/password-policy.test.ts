import { describe, it, expect } from 'vitest';
import { passwordPolicySchema, type PasswordPolicyConfig } from '@digilog/shared';

/**
 * D1: Password policy enforcement tests
 * Tests the password policy validation logic that runs during change-password.
 * Uses the same validation rules as validatePasswordPolicy() in auth/routes.ts.
 */

function validatePasswordAgainstPolicy(password: string, username: string, policy: PasswordPolicyConfig): string[] {
  const errors: string[] = [];

  if (password.length < policy.minLength) {
    errors.push(`Password must be at least ${policy.minLength} characters`);
  }
  if (password.length > policy.maxLength) {
    errors.push(`Password must be at most ${policy.maxLength} characters`);
  }
  if (policy.requireUppercase) {
    const count = (password.match(/[A-Z]/g) || []).length;
    if (count < policy.minUppercase) {
      errors.push(`Password must contain at least ${policy.minUppercase} uppercase letter(s)`);
    }
  }
  if (policy.requireLowercase) {
    const count = (password.match(/[a-z]/g) || []).length;
    if (count < policy.minLowercase) {
      errors.push(`Password must contain at least ${policy.minLowercase} lowercase letter(s)`);
    }
  }
  if (policy.requireNumbers) {
    const count = (password.match(/[0-9]/g) || []).length;
    if (count < policy.minNumbers) {
      errors.push(`Password must contain at least ${policy.minNumbers} number(s)`);
    }
  }
  if (policy.requireSpecialChars) {
    const count = (password.match(/[^A-Za-z0-9]/g) || []).length;
    if (count < policy.minSpecialChars) {
      errors.push(`Password must contain at least ${policy.minSpecialChars} special character(s)`);
    }
  }
  if (policy.cannotBeUserId && password === username) {
    errors.push('Password cannot be same as User ID');
  }
  if (policy.cannotContainUserId && password.toLowerCase().includes(username.toLowerCase())) {
    errors.push('Password cannot contain User ID');
  }

  return errors;
}

describe('Password Policy Enforcement', () => {
  const defaultPolicy = passwordPolicySchema.parse({});

  it('should accept a valid password meeting all default requirements', () => {
    const errors = validatePasswordAgainstPolicy('SecureP@ss1', 'testuser', defaultPolicy);
    expect(errors).toHaveLength(0);
  });

  it('should reject password shorter than minLength', () => {
    const errors = validatePasswordAgainstPolicy('Ab1!', 'testuser', defaultPolicy);
    expect(errors).toContainEqual(expect.stringContaining('at least 8 characters'));
  });

  it('should reject password exceeding maxLength', () => {
    const policy = passwordPolicySchema.parse({ maxLength: 32 });
    const longPwd = 'A'.repeat(33) + 'a1!';
    const errors = validatePasswordAgainstPolicy(longPwd, 'testuser', policy);
    expect(errors).toContainEqual(expect.stringContaining('at most 32 characters'));
  });

  it('should reject password without uppercase when required', () => {
    const errors = validatePasswordAgainstPolicy('lowercase1!', 'testuser', defaultPolicy);
    expect(errors).toContainEqual(expect.stringContaining('uppercase'));
  });

  it('should reject password without lowercase when required', () => {
    const errors = validatePasswordAgainstPolicy('UPPERCASE1!', 'testuser', defaultPolicy);
    expect(errors).toContainEqual(expect.stringContaining('lowercase'));
  });

  it('should reject password without numbers when required', () => {
    const errors = validatePasswordAgainstPolicy('NoNumbers!A', 'testuser', defaultPolicy);
    expect(errors).toContainEqual(expect.stringContaining('number'));
  });

  it('should reject password without special chars when required', () => {
    const errors = validatePasswordAgainstPolicy('NoSpecial1A', 'testuser', defaultPolicy);
    expect(errors).toContainEqual(expect.stringContaining('special character'));
  });

  it('should reject password that equals the username', () => {
    const errors = validatePasswordAgainstPolicy('testuser', 'testuser', defaultPolicy);
    expect(errors).toContainEqual(expect.stringContaining('cannot be same as User ID'));
  });

  it('should reject password that contains the username (case insensitive)', () => {
    const errors = validatePasswordAgainstPolicy('myTestUserPwd1!', 'testuser', defaultPolicy);
    expect(errors).toContainEqual(expect.stringContaining('cannot contain User ID'));
  });

  it('should allow password when cannotBeUserId is disabled', () => {
    const policy = passwordPolicySchema.parse({
      cannotBeUserId: false,
      cannotContainUserId: false,
      requireUppercase: false,
      requireSpecialChars: false,
      requireNumbers: false,
    });
    const errors = validatePasswordAgainstPolicy('testuser', 'testuser', policy);
    expect(errors).toHaveLength(0);
  });

  it('should accumulate multiple violations', () => {
    const errors = validatePasswordAgainstPolicy('abc', 'testuser', defaultPolicy);
    expect(errors.length).toBeGreaterThan(1);
  });

  it('should enforce custom minUppercase count', () => {
    const policy = passwordPolicySchema.parse({ minUppercase: 3 });
    const errors = validatePasswordAgainstPolicy('ABcdefg1!', 'testuser', policy);
    expect(errors).toContainEqual(expect.stringContaining('at least 3 uppercase'));
  });

  it('should pass with custom minUppercase count met', () => {
    const policy = passwordPolicySchema.parse({ minUppercase: 3 });
    const errors = validatePasswordAgainstPolicy('ABCdefg1!', 'testuser', policy);
    expect(errors).not.toContainEqual(expect.stringContaining('uppercase'));
  });
});

describe('Password Policy Schema Validation', () => {
  it('should provide defaults for all fields', () => {
    const policy = passwordPolicySchema.parse({});
    expect(policy.minLength).toBe(8);
    expect(policy.maxLength).toBe(128);
    expect(policy.requireUppercase).toBe(true);
    expect(policy.requireLowercase).toBe(true);
    expect(policy.requireNumbers).toBe(true);
    expect(policy.requireSpecialChars).toBe(true);
    expect(policy.cannotBeUserId).toBe(true);
    expect(policy.cannotContainUserId).toBe(true);
    expect(policy.preventReuseCount).toBe(12);
  });

  it('should reject minLength below 8', () => {
    const result = passwordPolicySchema.safeParse({ minLength: 3 });
    expect(result.success).toBe(false);
  });

  it('should reject maxLength above 128', () => {
    const result = passwordPolicySchema.safeParse({ maxLength: 200 });
    expect(result.success).toBe(false);
  });

  it('should reject preventReuseCount above 24', () => {
    const result = passwordPolicySchema.safeParse({ preventReuseCount: 30 });
    expect(result.success).toBe(false);
  });
});
