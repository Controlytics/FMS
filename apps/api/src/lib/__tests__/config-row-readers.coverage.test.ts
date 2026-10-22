/**
 * lib/ readers whose behaviour depends on ONE system_config row:
 *   format-datetime     getDatetimeConfig / formatConfiguredDateTime / formatConfiguredDate  ('datetime')
 *   password-validator  validatePasswordPolicy                                              ('password-policy')
 *   super-admin-lock    the SA API kill-switch read / cache / write                         ('super-admin-api-access')
 *   user-id-validator   validateUserId                                                       ('user-id')
 *   tablet-access       resolveTabletAccess                                                  ('tablet-access')
 *
 * Those rows are shared by every concurrent suite (and `super-admin-api-access`
 * OFF would lock every SUPER_ADMIN out), so the row is supplied at the narrowest
 * boundary — the module's `prisma.systemConfig` read — instead of being written.
 * What is asserted is the value / error / write payload the caller observes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const db = vi.hoisted(() => ({
  rows: new Map<string, unknown>(),
  fail: false,
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock('../prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: db.findUnique,
      upsert: db.upsert,
    },
  },
}));

import { getDatetimeConfig, formatConfiguredDateTime, formatConfiguredDate } from '../format-datetime.js';
import { validatePasswordPolicy } from '../password-validator.js';
import { ValidationError } from '../errors.js';
import { validateUserId } from '../user-id-validator.js';
import { resolveTabletAccess } from '../tablet-access.js';
import {
  readSuperAdminApiEnabledUncached, isSuperAdminApiEnabled, invalidateSuperAdminApiCache,
  setSuperAdminApiEnabled, SUPER_ADMIN_API_CONFIG_KEY,
} from '../super-admin-lock.js';

beforeEach(() => {
  db.rows.clear();
  db.fail = false;
  db.findUnique.mockReset().mockImplementation(async ({ where }: { where: { configKey: string } }) => {
    if (db.fail) throw new Error('connection refused');
    return db.rows.has(where.configKey) ? { configKey: where.configKey, configValue: db.rows.get(where.configKey) } : null;
  });
  db.upsert.mockReset().mockResolvedValue({});
  invalidateSuperAdminApiCache();
});

afterEach(() => { vi.useRealTimers(); });

const AT = '2026-06-15T10:05:00Z'; // 15:35 IST

describe('getDatetimeConfig', () => {
  it('returns the defaults (IST, DD/MM/YYYY, 12-hour) when the row is missing', async () => {
    expect(await getDatetimeConfig()).toEqual({ dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', timezone: 'Asia/Kolkata' });
  });

  it('fills only the missing or empty keys of a partial row', async () => {
    db.rows.set('datetime', { dateFormat: 'YYYY-MM-DD', timeFormat: '', timezone: undefined });
    expect(await getDatetimeConfig()).toEqual({ dateFormat: 'YYYY-MM-DD', timeFormat: '12-hour', timezone: 'Asia/Kolkata' });
  });

  it('treats a null value as an empty row, and a read failure as the defaults', async () => {
    db.rows.set('datetime', null);
    expect((await getDatetimeConfig()).timezone).toBe('Asia/Kolkata');
    db.fail = true;
    expect(await getDatetimeConfig()).toEqual({ dateFormat: 'DD/MM/YYYY', timeFormat: '12-hour', timezone: 'Asia/Kolkata' });
  });
});

describe('formatConfiguredDateTime / formatConfiguredDate', () => {
  it('uses the stored format and zone', async () => {
    db.rows.set('datetime', { dateFormat: 'YYYY-MM-DD', timeFormat: '24-hour', timezone: 'UTC' });
    expect(await formatConfiguredDateTime(AT)).toBe('2026-06-15 10:05');
    expect(await formatConfiguredDate(new Date(AT))).toBe('2026-06-15');
  });

  it('defaults to IST 12-hour', async () => {
    expect(await formatConfiguredDateTime(new Date(AT))).toMatch(/^15\/06\/2026 03:35\sPM$/);
    expect(await formatConfiguredDate('2026-06-15T20:00:00Z')).toBe('16/06/2026');
  });

  it('falls back to UTC for a timezone the runtime does not know', async () => {
    db.rows.set('datetime', { dateFormat: 'DD-MMM-YYYY', timeFormat: '24-hour', timezone: 'Mars/Olympus' });
    expect(await formatConfiguredDateTime(AT)).toBe('15-Jun-2026 10:05');
    expect(await formatConfiguredDate(AT)).toBe('15-Jun-2026');
  });

  it('returns an empty string for an unparseable value without reading the config', async () => {
    expect(await formatConfiguredDateTime('nope')).toBe('');
    expect(await formatConfiguredDate('nope')).toBe('');
    expect(db.findUnique).not.toHaveBeenCalled();
  });
});

async function policyError(password: string, username?: string): Promise<string | null> {
  try { await validatePasswordPolicy(password, username); return null; } catch (e) {
    expect(e).toBeInstanceOf(ValidationError);
    expect((e as ValidationError).statusCode).toBe(400);
    return (e as Error).message;
  }
}

describe('validatePasswordPolicy', () => {
  it('applies the built-in policy when no row exists', async () => {
    expect(await policyError('Ab1!xyz')).toBe('Password must be at least 8 characters');
    expect(await policyError(`Ab1!${'x'.repeat(125)}`)).toBe('Password must be at most 128 characters');
    expect(await policyError('ab1!wxyz')).toBe('Password must contain at least 1 uppercase letter(s)');
    expect(await policyError('AB1!WXYZ')).toBe('Password must contain at least 1 lowercase letter(s)');
    expect(await policyError('Abc!wxyz')).toBe('Password must contain at least 1 number(s)');
    expect(await policyError('Abc1wxyz')).toBe('Password must contain at least 1 special character(s)');
    expect(await policyError('Abc1!xyz')).toBeNull();
  });

  it('honours stored lengths and per-class minimums', async () => {
    db.rows.set('password-policy', {
      minLength: 10, maxLength: 12, requireUppercase: true, minUppercase: 2,
      requireLowercase: false, requireNumbers: true, minNumbers: 3, requireSpecialChars: false,
    });
    expect(await policyError('ABc123456')).toBe('Password must be at least 10 characters');
    expect(await policyError('ABc1234567890')).toBe('Password must be at most 12 characters');
    expect(await policyError('Abcdefg123')).toBe('Password must contain at least 2 uppercase letter(s)');
    expect(await policyError('ABcdefgh12')).toBe('Password must contain at least 3 number(s)');
    expect(await policyError('ABCDEFG123')).toBeNull(); // no lowercase / special required
  });

  it('falls back to 8..128 when the stored row omits the lengths', async () => {
    db.rows.set('password-policy', { requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false });
    expect(await policyError('1234567')).toBe('Password must be at least 8 characters');
    expect(await policyError('12345678')).toBeNull();
  });

  it('refuses a password equal to, or containing, the user id unless the policy allows it', async () => {
    db.rows.set('password-policy', { minLength: 4, requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false });
    expect(await policyError('cvl_op7', 'cvl_op7')).toBe('Password cannot be same as User ID');
    expect(await policyError('xx-CVL_OP7-yy', 'cvl_op7')).toBe('Password cannot contain User ID');
    expect(await policyError('unrelated', 'cvl_op7')).toBeNull();

    db.rows.set('password-policy', {
      minLength: 4, requireUppercase: false, requireLowercase: false, requireNumbers: false, requireSpecialChars: false,
      cannotBeUserId: false, cannotContainUserId: false,
    });
    expect(await policyError('cvl_op7', 'cvl_op7')).toBeNull();
    expect(await policyError('xx-cvl_op7', 'cvl_op7')).toBeNull();
  });
});

describe('super-admin-lock (fail-open kill switch)', () => {
  it('reads ON when the row is missing, malformed, or the read fails', async () => {
    expect(await readSuperAdminApiEnabledUncached()).toBe(true);
    for (const v of [null, 'off', { enabled: 'false' }, { other: false }, { enabled: 0 }]) {
      db.rows.set(SUPER_ADMIN_API_CONFIG_KEY, v);
      expect(await readSuperAdminApiEnabledUncached()).toBe(true);
    }
    db.fail = true;
    expect(await readSuperAdminApiEnabledUncached()).toBe(true);
  });

  it('reads OFF only for an explicit { enabled: false }', async () => {
    db.rows.set(SUPER_ADMIN_API_CONFIG_KEY, { enabled: false });
    expect(await readSuperAdminApiEnabledUncached()).toBe(false);
    db.rows.set(SUPER_ADMIN_API_CONFIG_KEY, { enabled: true });
    expect(await readSuperAdminApiEnabledUncached()).toBe(true);
  });

  it('caches the gate value for 5 s, then re-reads', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    db.rows.set(SUPER_ADMIN_API_CONFIG_KEY, { enabled: false });
    expect(await isSuperAdminApiEnabled()).toBe(false);
    db.rows.set(SUPER_ADMIN_API_CONFIG_KEY, { enabled: true });
    vi.setSystemTime(new Date('2026-10-21T10:00:04.900Z'));
    expect(await isSuperAdminApiEnabled()).toBe(false); // still cached
    expect(db.findUnique).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-10-21T10:00:05.100Z'));
    expect(await isSuperAdminApiEnabled()).toBe(true);
    expect(db.findUnique).toHaveBeenCalledTimes(2);
  });

  it('a write persists the flag with its author and takes effect on the very next check', async () => {
    db.rows.set(SUPER_ADMIN_API_CONFIG_KEY, { enabled: true });
    expect(await isSuperAdminApiEnabled()).toBe(true);
    db.upsert.mockImplementation(async (args: any) => { db.rows.set(SUPER_ADMIN_API_CONFIG_KEY, args.update.configValue); return {}; });

    await setSuperAdminApiEnabled(false, 'cvl-sa');
    expect(db.upsert).toHaveBeenCalledTimes(1);
    const args = db.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ configKey: SUPER_ADMIN_API_CONFIG_KEY });
    expect(args.create).toMatchObject({ configKey: SUPER_ADMIN_API_CONFIG_KEY, configValue: { enabled: false }, configType: 'security', requiresReauth: true, updatedBy: 'cvl-sa' });
    expect(args.update).toMatchObject({ configValue: { enabled: false }, updatedBy: 'cvl-sa' });
    expect(args.update.updatedAt).toBeInstanceOf(Date);
    // No 5 s wait: the cache was invalidated by the write.
    expect(await isSuperAdminApiEnabled()).toBe(false);
  });
});

describe('validateUserId (stored User ID format)', () => {
  it('falls back to the default format when the stored row is invalid', async () => {
    db.rows.set('user-id', { format: 'NOT_A_FORMAT', length: 999 });
    // Default: LETTERS_NUMBERS, length 6.
    expect(await validateUserId('ABC123')).toEqual({ valid: true, errors: [] });
    expect((await validateUserId('AB-12')).errors).toEqual(['User ID must be exactly 6 characters', 'User ID must contain only letters and numbers']);
  });

  it('CUSTOM_PATTERN: the regex is the only rule, with its own description', async () => {
    db.rows.set('user-id', { format: 'CUSTOM_PATTERN', customPattern: 'EMP-[0-9]{3}', customPatternDescription: 'Use EMP-###' });
    expect(await validateUserId('EMP-123')).toEqual({ valid: true, errors: [] });
    expect(await validateUserId('emp-12')).toEqual({ valid: false, errors: ['Use EMP-###'] });
    db.rows.set('user-id', { format: 'CUSTOM_PATTERN', customPattern: '[0-9]+' });
    expect(await validateUserId('12a')).toEqual({ valid: false, errors: ['User ID does not match required pattern'] });
  });

  it('CUSTOM_PATTERN: a broken or missing pattern refuses every id and says why', async () => {
    db.rows.set('user-id', { format: 'CUSTOM_PATTERN', customPattern: '([unclosed' });
    expect(await validateUserId('anything')).toEqual({ valid: false, errors: ['Invalid custom pattern configured'] });
    db.rows.set('user-id', { format: 'CUSTOM_PATTERN' });
    expect(await validateUserId('anything')).toEqual({ valid: false, errors: ['No custom pattern has been configured'] });
  });

  it('PREFIX_LETTERS_NUMBERS: prefix + separator, then letters and digits', async () => {
    db.rows.set('user-id', { format: 'PREFIX_LETTERS_NUMBERS', prefix: 'EMP', prefixSeparator: '-', length: 8, letterCase: 'UPPERCASE' });
    expect(await validateUserId('EMP-AB12')).toEqual({ valid: true, errors: [] });
    expect((await validateUserId('EMP-A_12')).errors).toEqual(['User ID must have letters and numbers after prefix']);
    // Wrong-case prefix: refused for the prefix and the case, not the body.
    expect((await validateUserId('emp-ab12')).errors).toEqual(['User ID must start with "EMP-"', 'User ID must be uppercase']);
  });
});

describe('resolveTabletAccess', () => {
  it('a role listed with no features gets none (configured)', async () => {
    db.rows.set('tablet-access', { OPERATOR: undefined, QA: ['login'] });
    expect(await resolveTabletAccess('OPERATOR')).toEqual({ allowed: [], configured: true });
    expect(await resolveTabletAccess('QA')).toEqual({ allowed: ['login'], configured: true });
    expect(await resolveTabletAccess('MANAGER')).toEqual({ allowed: [], configured: true });
  });

  it('no row at all is the legacy default-allow', async () => {
    expect(await resolveTabletAccess('OPERATOR')).toEqual({ allowed: [], configured: false });
  });
});
