/**
 * Shared-state helpers for the config coverage suites (2026-10-21).
 *
 * digilog_test_db is shared by every suite (and by concurrent agents), so a
 * config test must leave each `system_config` row exactly as it found it —
 * value AND metadata (type, re-auth flag, updatedBy / updatedAt).
 */
import { expect } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import type { Prisma, SystemConfig } from '@prisma/client';
import { prisma } from '../../../../lib/prisma.js';

export const stored = async (key: string) =>
  (await prisma.systemConfig.findUnique({ where: { configKey: key } }))?.configValue ?? null;

/** Put a key's VALUE back (absent stays absent). Metadata is handled by restoreRows. */
export async function restoreKey(key: string, snapshot: unknown) {
  if (snapshot === null) await prisma.systemConfig.deleteMany({ where: { configKey: key } });
  else await prisma.systemConfig.update({ where: { configKey: key }, data: { configValue: snapshot as Prisma.InputJsonValue } });
}

async function recreate(row: SystemConfig) {
  await prisma.systemConfig.create({
    data: {
      id: row.id, configKey: row.configKey, configValue: row.configValue as Prisma.InputJsonValue,
      configType: row.configType, requiresReauth: row.requiresReauth, updatedAt: row.updatedAt, updatedBy: row.updatedBy,
    },
  });
}

/**
 * Remove a key's row for the duration of `fn`, then put the EXACT row back.
 * Only for keys whose readers treat "no row" exactly like the stored value, so
 * other suites observe no change.
 */
export async function withRowAbsent(key: string, fn: () => Promise<void>) {
  const row = await prisma.systemConfig.findUnique({ where: { configKey: key } });
  if (row) await prisma.systemConfig.delete({ where: { configKey: key } });
  try {
    await fn();
  } finally {
    await prisma.systemConfig.deleteMany({ where: { configKey: key } });
    if (row) await recreate(row);
  }
}

/** Capture whole rows before a suite touches them. */
export async function snapshotRows(keys: string[]): Promise<Map<string, SystemConfig | null>> {
  const out = new Map<string, SystemConfig | null>();
  for (const k of keys) out.set(k, await prisma.systemConfig.findUnique({ where: { configKey: k } }));
  return out;
}

/**
 * After a suite: where the current VALUE equals the captured one, put the
 * metadata back too (a value-only restore leaves this suite's user as
 * updatedBy). A row whose value differs was changed by someone else since —
 * left alone.
 */
export async function restoreRows(rows: Map<string, SystemConfig | null>) {
  for (const [key, row] of rows) {
    const cur = await prisma.systemConfig.findUnique({ where: { configKey: key } });
    if (!row || !cur) continue;
    if (!isDeepStrictEqual(cur.configValue, row.configValue)) continue;
    await prisma.systemConfig.update({
      where: { configKey: key },
      data: { configType: row.configType, requiresReauth: row.requiresReauth, updatedAt: row.updatedAt, updatedBy: row.updatedBy },
    });
  }
}

/** The newest audit row matching `where`, asserted to link to the row before it in the chain. */
export async function chainedAuditRow(where: Prisma.AuditTrailWhereInput) {
  const row = await prisma.auditTrail.findFirst({ where, orderBy: { chainPosition: 'desc' } });
  expect(row, `audit row for ${JSON.stringify(where)}`).toBeTruthy();
  const prev = await prisma.auditTrail.findFirst({
    where: { chainPosition: { lt: row!.chainPosition! } },
    orderBy: { chainPosition: 'desc' },
  });
  expect(row!.previousChecksum).toBe(prev?.checksum ?? null);
  expect(row!.checksum).toMatch(/^[0-9a-f]{64}$/);
  return row!;
}
