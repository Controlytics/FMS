/**
 * JSON / BAK / SQL / CSV backups keep a timestamp's microseconds (2026-10-22,
 * deliverable 05 D-DB-5).
 *
 * fetchAllTablesRaw read every table with `SELECT *`, and Prisma turns a
 * timestamptz into a JS Date, which holds milliseconds only: a value written by
 * Postgres itself (`now()`, a raw-SQL default) lost its last three digits in
 * every in-app backup — 1,522 values on the go-live copy. Timestamps are now read
 * as ISO text: milliseconds when the value has none finer (exactly what the Date
 * gave before, so app-written values, audit checksums and older backup files are
 * unchanged), microseconds when it has.
 *
 * Read-only against digilog_test_db apart from the two notifications and one
 * audit row this file writes (the notifications are removed afterwards).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { auditLog } from '../../../lib/audit.js';
import { fetchAllTablesRaw, verifyBackupAuditChain } from '../backup.repository.js';

const micro = randomUUID();
const milli = randomUUID();

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { id: { in: [micro, milli] } } });
}, 60_000);

describe('fetchAllTablesRaw: timestamps', () => {
  it('keeps microseconds, renders whole milliseconds as before, and leaves audit checksums verifiable', async () => {
    await prisma.$executeRawUnsafe(
      `INSERT INTO notifications (id, type, title, message, created_at) VALUES
         ($1::uuid, 'SYSTEM_ERROR', 'db05 micro', 'm', '2026-10-17 18:45:40.18863+05:30'),
         ($2::uuid, 'SYSTEM_ERROR', 'db05 milli', 'm', '2026-10-17 13:15:40.965+00')`,
      micro, milli,
    );
    const auditId = await auditLog({
      userId: '123456', userRole: 'OPERATOR', action: 'CONFIG_CHANGED', targetType: 'system_config',
      targetId: 'db05-ts', afterValue: { ok: true }, ipAddress: '127.0.0.1',
    });

    const data = await fetchAllTablesRaw();

    const byId = new Map(data.notifications.map((r) => [r.id, r]));
    expect(byId.get(micro)!.created_at).toBe('2026-10-17T13:15:40.188630Z');
    expect(byId.get(milli)!.created_at).toBe('2026-10-17T13:15:40.965Z');

    const auditRow = data.audit_trail.find((r) => r.id === auditId)!;
    expect(auditRow.timestamp).toBe(
      (await prisma.auditTrail.findUnique({ where: { id: auditId }, select: { timestamp: true } }))!.timestamp.toISOString(),
    );
    const report = await verifyBackupAuditChain([auditRow]);
    expect(report.checksumFailures).toBe(0);

    // date columns are untouched: still what Prisma gave (a Date at UTC midnight).
    const entry = data.pm_schedule_entries[0];
    if (entry) expect(entry.planned_date).toBeInstanceOf(Date);
  }, 120_000);
});
