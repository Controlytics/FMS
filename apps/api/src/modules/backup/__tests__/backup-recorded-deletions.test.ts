/**
 * dropRecordedDeletions (2026-10-22, operator decision): a park an earlier failed
 * restore left is carried over into the restored trail, but a row a RECORDED hard
 * delete names must not come back with it — a restore must not undo a deletion.
 *
 * Real SQL against digilog_test_db, on TEMP tables created inside one transaction
 * (ON COMMIT DROP): nothing persistent is created or changed.
 */
import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../../lib/prisma.js';
import { dropRecordedDeletions } from '../backup.repository.js';

const SOURCE_COLS = '(action text, target_id varchar(255), before_value jsonb)';

describe('dropRecordedDeletions', () => {
  it('removes every row a single or bulk delete record names, read from any source; nothing else', async () => {
    const ids = Array.from({ length: 6 }, () => randomUUID());
    const { removed, left } = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE db05_park (id uuid, action text) ON COMMIT DROP`);
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE db05_live ${SOURCE_COLS} ON COMMIT DROP`);
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE db05_other ${SOURCE_COLS} ON COMMIT DROP`);
      for (const id of ids) await tx.$executeRawUnsafe(`INSERT INTO db05_park VALUES ($1::uuid, 'CONFIG_CHANGED')`, id);
      const rows: Array<[string, string, string | null, unknown]> = [
        ['db05_live', 'AUDIT_RECORD_DELETED', ids[0], { id: ids[0] }],
        ['db05_live', 'AUDIT_RECORDS_BULK_DELETED', null, { recordCount: 2, records: [{ id: ids[1] }, { id: 'not-in-the-park' }] }],
        // not a deletion: naming a row does not remove it
        ['db05_live', 'AUDIT_RECORD_UPDATED', ids[3], { id: ids[3] }],
        ['db05_live', 'CONFIG_CHANGED', ids[4], null],
        // a malformed bulk record is ignored, not an error
        ['db05_live', 'AUDIT_RECORDS_BULK_DELETED', null, { records: 'x' }],
        // another source (an earlier park) counts too
        ['db05_other', 'AUDIT_RECORDS_BULK_DELETED', null, { records: [{ id: ids[2] }] }],
      ];
      for (const [t, action, target, before] of rows) {
        await tx.$executeRawUnsafe(`INSERT INTO ${t} VALUES ($1, $2, $3::jsonb)`, action, target, before == null ? null : JSON.stringify(before));
      }
      const n = await dropRecordedDeletions(tx, 'db05_park', ['db05_live', 'db05_other', 'db05_missing']);
      const rest: Array<{ id: string }> = await tx.$queryRawUnsafe(`SELECT id::text AS id FROM db05_park`);
      return { removed: n, left: rest.map((r) => r.id).sort() };
    });
    expect(removed).toBe(3);
    expect(left).toEqual([ids[3], ids[4], ids[5]].sort());
  });

  it('a park without an audit_trail table, or no source at all, removes nothing', async () => {
    const n = await prisma.$transaction(async (tx: any) => {
      await tx.$executeRawUnsafe(`CREATE TEMP TABLE db05_live2 ${SOURCE_COLS} ON COMMIT DROP`);
      return (await dropRecordedDeletions(tx, 'db05_no_such_park', ['db05_live2']))
        + (await dropRecordedDeletions(tx, 'db05_live2', ['db05_no_such_source']));
    });
    expect(n).toBe(0);
  });

  it('refuses an unsafe table name before running any SQL', async () => {
    const tx = { $queryRawUnsafe: async () => { throw new Error('ran SQL'); }, $executeRawUnsafe: async () => { throw new Error('ran SQL'); } };
    await expect(dropRecordedDeletions(tx, 'evil;drop.audit_trail', [])).rejects.toThrow(/unsafe SQL identifier/);
  });
});
