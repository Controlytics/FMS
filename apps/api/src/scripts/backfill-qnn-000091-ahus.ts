/**
 * One-off backfill: name the AHUs on the legacy aggregate upload QNN-2026-000091.
 *
 * Before 2026-09-02 a bulk PM-schedule upload minted ONE aggregate quality
 * notification — "Uploaded 58 PM schedule entries (pending review)" — carrying no
 * scheduleId, no entryId and no AHU, so the AHU column rendered blank and the
 * visits it covered could not be traced from it. Uploads now mint one QNN per
 * entry, but four legacy aggregate rows remain.
 *
 * Only THIS one can be corrected. The `PM_SCHEDULE_IMPORTED` audit row for the
 * 2026-07-09 import genuinely recorded the AHU list at the time, so writing it
 * onto the notification restores something that WAS captured. The other three
 * (2 / 35 / 48 entries) predate `ahuNames` being audited, and
 * `pm_schedule_entries` has no created_at to correlate against, so their detail
 * exists nowhere and is left alone rather than invented.
 *
 * Deliberately NOT done: minting per-entry QNNs for the legacy uploads. That
 * would draw fresh QNN numbers today and present them as records of a July
 * action — a fabricated §11 record. The individual planned dates are unknown in
 * any case.
 *
 * The AHU list goes in `message`; `ahu_name` gets a count, because that column
 * holds ONE AHU everywhere else and the QN table renders it in a narrow column.
 *
 * Run:  npx tsx src/scripts/backfill-qnn-000091-ahus.ts [--apply]
 * Without --apply it prints the change and writes nothing.
 */
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';

const QNN = 'QN-2026-000091';
const APPLY = process.argv.includes('--apply');

async function main() {
  const row = await prisma.qualityNotification.findFirst({ where: { qnn: QNN } });
  if (!row) throw new Error(`${QNN} not found`);

  // The AHU list as recorded by the import's own audit row — the source of truth
  // for this backfill. Read it back rather than hard-coding it here.
  const audit = await prisma.auditTrail.findFirst({
    where: { action: 'PM_SCHEDULE_IMPORTED' },
    orderBy: { timestamp: 'desc' },
    // narrowed below; the 58-entry import is the only one with a non-empty list
  });
  const all = await prisma.auditTrail.findMany({
    where: { action: 'PM_SCHEDULE_IMPORTED' },
    orderBy: { timestamp: 'asc' },
  });
  const source = all.find((a) => (a.afterValue as any)?.imported === 58);
  if (!source) throw new Error('No PM_SCHEDULE_IMPORTED audit row with imported=58');
  const ahuNames: string[] = (source.afterValue as any)?.ahuNames ?? [];
  if (ahuNames.length === 0) throw new Error('That audit row records no ahuNames — nothing to restore');

  const newAhu = `${ahuNames.length} AHUs`;
  const newMessage = `${row.message} — ${ahuNames.join(', ')}`;

  console.log('QNN            :', row.qnn);
  console.log('source audit   :', source.id, source.timestamp.toISOString());
  console.log('ahu_name   before:', JSON.stringify(row.ahuName), '-> after:', JSON.stringify(newAhu));
  console.log('message    before:', JSON.stringify(row.message));
  console.log('message     after:', JSON.stringify(newMessage));
  console.log('message length   :', newMessage.length, '(column limit 1000)');
  if (!APPLY) { console.log('\nDRY RUN — pass --apply to write.'); return; }

  // Audit BEFORE the row changes: beforeValue needs the record as it stands, and
  // a rolled-back update must not leave a row claiming it happened.
  await auditLog({
    userId: 'superadmin',
    userRole: 'SUPER_ADMIN',
    action: 'MANUAL_RECORD_UPDATED',
    targetType: 'quality_notification',
    targetId: row.id,
    beforeValue: { qnn: row.qnn, ahuName: row.ahuName, message: row.message },
    afterValue: { qnn: row.qnn, ahuName: newAhu, message: newMessage },
    reason:
      'Backfilled the AHU list onto a legacy aggregate upload notification. The pre-2026-09-02 '
      + 'bulk upload minted one notification for the whole file with no AHU recorded; the AHU names '
      + `were restored from this import's own PM_SCHEDULE_IMPORTED audit row (${source.id}). `
      + 'No per-entry notifications were created — the planned dates were never recorded and '
      + 'minting back-dated QNN numbers would fabricate quality records.',
    signatureMeaning: `Legacy quality notification ${row.qnn} annotated with the AHUs its upload covered`,
  });

  await prisma.qualityNotification.update({
    where: { id: row.id },
    data: { ahuName: newAhu, message: newMessage },
  });
  console.log('\nAPPLIED — audit row written first, then the update.');
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
