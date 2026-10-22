/**
 * The version a NEW schedule for an (AHU, year) must take (2026-10-22).
 *
 * `PmSchedule` is unique on (entityId, year, version), and an AHU-year can hold
 * ARCHIVED versions with no ACTIVE one — a schedule archived by a Super Admin
 * edit, or every version of a replaced year. Creating at the column default
 * (version 1) then collided with the archived v1 forever: the upload reported
 * the row as a database error, POST / answered 409/500, and "Add a visit" could
 * never add one. Every door that creates a schedule — the upload, Add a visit
 * and create() — asks here, so the rule lives once.
 *
 * Pass the caller's transaction client so the read joins the write it guards;
 * a concurrent creator still loses on the unique index (P2002), which each
 * caller maps to a 409.
 */
import type { Prisma } from '@prisma/client';

export async function nextScheduleVersion(
  db: Pick<Prisma.TransactionClient, 'pmSchedule'>,
  entityId: string,
  year: number,
): Promise<number> {
  const latest = await db.pmSchedule.findFirst({
    where: { entityId, year },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return (latest?.version ?? 0) + 1;
}
