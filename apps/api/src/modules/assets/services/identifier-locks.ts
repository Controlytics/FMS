import type { Prisma } from '@prisma/client';

// pg_advisory_xact_lock(int4, int4) namespaces (D-DB-2, 2026-10-22). The
// two-int key space is separate from the audit chain's single-bigint lock.
// Arbitrary values, but they must stay distinct.
export const IDENTIFIER_LOCK_ASSET = 74210001;
export const IDENTIFIER_LOCK_TAG = 74210002;

/**
 * THE locking rule for every write to asset_identifiers. "One identifier per
 * filter" and "one filter per tag" are checked in code (the schema is unique on
 * the value only), so a writer must hold, for the rest of its transaction:
 *   - the lock of every FILTER whose tags it reads or changes, and
 *   - the lock of every TAG VALUE it reads or binds, lower-cased because the
 *     RFID duplicate check is case-insensitive,
 * and only then read what it is about to decide on (READ COMMITTED re-snapshots
 * per statement, so reads after the lock see every committed competitor).
 *
 * Order: all filter locks, then all tag locks, each set by ascending lock key.
 * Every caller uses the same order, so two writers can never wait on each other
 * in a cycle — including two different values that hash to the same key, which
 * is why the keys, not the strings, are sorted.
 *
 * Callers: identifierService.create / delete, and the SUPER_ADMIN RFID Track
 * Record edit (super-admin/record-edit-routes.ts). Add any new writer here.
 */
export async function lockIdentifierScope(
  tx: Prisma.TransactionClient,
  scope: { assetIds: Array<string | null | undefined>; tagValues: Array<string | null | undefined> },
): Promise<void> {
  const assets = [...new Set(scope.assetIds.filter((v): v is string => !!v))];
  const tags = [...new Set(scope.tagValues.filter((v): v is string => !!v).map((v) => v.toLowerCase()))];
  await lockAll(tx, IDENTIFIER_LOCK_ASSET, assets);
  await lockAll(tx, IDENTIFIER_LOCK_TAG, tags);
}

async function lockAll(tx: Prisma.TransactionClient, namespace: number, values: string[]): Promise<void> {
  if (values.length === 0) return;
  if (values.length === 1) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${namespace}::int4, hashtext(${values[0]}))`;
    return;
  }
  const keys = await tx.$queryRaw<Array<{ k: number }>>`SELECT DISTINCT hashtext(v) AS k FROM unnest(${values}::text[]) AS v ORDER BY 1`;
  for (const { k } of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${namespace}::int4, ${k}::int4)`;
  }
}
