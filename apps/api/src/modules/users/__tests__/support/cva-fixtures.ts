/**
 * Small helpers shared by the auth / users / roles / admin-requests coverage
 * suites (2026-10-21). Everything here only READS shared state or writes rows
 * the calling file owns.
 */
import { expect } from 'vitest';
import { prisma } from '../../../../lib/prisma.js';
import { invalidateRolePermsCache } from '../../../../plugins/rbac.js';

/** Create a role the file owns, at an explicit hierarchy level. Name <= 20 chars. */
export async function makeRole(name: string, hierarchyLevel: number, permissions: string[], opts: { isSystem?: boolean; isActive?: boolean } = {}) {
  if (name.length > 20) throw new Error(`role name too long: ${name}`);
  await prisma.role.create({
    data: {
      name, displayName: name, hierarchyLevel, permissions,
      isSystem: opts.isSystem ?? false, isActive: opts.isActive ?? true, createdBy: 'coverage-test',
    },
  });
  invalidateRolePermsCache(name);
}

/** Newest audit row for (action, targetId). */
export async function auditFor(action: string, targetId: string) {
  return prisma.auditTrail.findFirst({ where: { action, targetId }, orderBy: { chainPosition: 'desc' } });
}

/** The row's previous_checksum is the checksum of the row immediately before it in the chain. */
export async function expectChained(row: { chainPosition: bigint | null; previousChecksum: string | null } | null) {
  expect(row).not.toBeNull();
  expect(row!.chainPosition).not.toBeNull();
  const prev = await prisma.auditTrail.findFirst({
    where: { chainPosition: { lt: row!.chainPosition! } },
    orderBy: { chainPosition: 'desc' },
  });
  expect(row!.previousChecksum).toBe(prev?.checksum ?? null);
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '0123456789';

/**
 * A User ID that satisfies the LIVE `user-id` configuration (read, never
 * written), starting with "cva" wherever letters are allowed. Throws for a
 * configuration this helper does not understand, so a test never silently
 * runs against the wrong rule.
 */
export async function validUserId(): Promise<string> {
  const row = await prisma.systemConfig.findUnique({ where: { configKey: 'user-id' } });
  const cfg = (row?.configValue ?? {}) as { format?: string; length?: number; letterCase?: string; prefix?: string; prefixSeparator?: string };
  const format = cfg.format ?? 'LETTERS_NUMBERS';
  const length = cfg.length ?? 6;
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];
  const prefixFormat = format.startsWith('PREFIX_');
  const prefix = prefixFormat && cfg.prefix ? `${cfg.prefix}${cfg.prefixSeparator ?? ''}` : '';
  const body = length - prefix.length;
  let main = '';
  if (format.endsWith('NUMBERS_ONLY') || format === 'PREFIX_NUMBERS') {
    for (let i = 0; i < body; i++) main += pick(DIGITS);
  } else if (format.endsWith('LETTERS_ONLY') || format === 'PREFIX_LETTERS') {
    main = 'CVA'.slice(0, body);
    while (main.length < body) main += pick(LETTERS);
  } else if (format.endsWith('LETTERS_NUMBERS')) {
    main = 'CVA'.slice(0, body);
    while (main.length < body) main += pick(LETTERS + DIGITS);
  } else {
    throw new Error(`validUserId: unsupported user-id format ${format}`);
  }
  let id = prefix + main;
  if (cfg.letterCase === 'LOWERCASE') id = id.toLowerCase();
  else if (cfg.letterCase === 'UPPERCASE') id = id.toUpperCase();
  return id;
}
