/**
 * A CSV backup restores what was exported (2026-10-22, deliverable 05 D-DB-3 / D-DB-4).
 *
 * D-DB-3: the importer guessed each cell's type from its text, so a numeric
 * username ("123456") in audit_trail.user_id came back as the NUMBER 123456 and
 * the audit-chain check hashed a value the row was never written with. On the
 * go-live copy 802 of 35,327 rows "did not match their stored checksum", and the
 * restore refused the app's own backup unless the operator forced it — on a site
 * whose usernames are numeric employee IDs (the install default), every row.
 * Cells are now typed by the column's real type in the live schema.
 *
 * D-DB-4: NULL and '' were both written as an empty cell and both read back as
 * NULL. An empty string is now written as a quoted empty cell ("") and NULL as
 * an unquoted one — PostgreSQL's own CSV convention — and the importer keeps
 * them apart. Files written before the change still read as before.
 *
 * restoreFromBackup is mocked (the real one TRUNCATEs every table); the CSV
 * writer, the importer, the schema lookup, verifyBackupAuditChain and the
 * fixture's audit rows (real auditLog on digilog_test_db) are real.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';

const { mockRestoreFromBackup } = vi.hoisted(() => ({ mockRestoreFromBackup: vi.fn(async () => 0) }));
vi.mock('../backup.repository.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  restoreFromBackup: mockRestoreFromBackup,
}));

import { restore, validate } from '../backup.service.js';
import { generateCsv } from '../backup.helpers.js';
import { auditLog } from '../../../lib/audit.js';
import { prisma } from '../../../lib/prisma.js';

const saCtx = { userId: 'cov-sa', userSub: 's', userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: 'sess' } as any;

function zip(entries: Record<string, string>): Buffer {
  const z = new AdmZip();
  for (const [name, content] of Object.entries(entries)) z.addFile(name, Buffer.from(content, 'utf-8'));
  return z.toBuffer();
}
const restored = () => (mockRestoreFromBackup.mock.calls.at(-1) as any[])[0];

beforeEach(() => { mockRestoreFromBackup.mockClear(); });

describe('CSV backup: audit rows of numeric usernames verify after the round trip (D-DB-3)', () => {
  it('the importer keeps user_id as text, so the chain check passes and restore gets the stored value', async () => {
    const numericUser = String(900000 + Math.floor(Math.random() * 99999));
    const ids: string[] = [];
    for (const [i, userId] of [numericUser, numericUser, `cvz_${randomUUID().slice(0, 8)}`].entries()) {
      ids.push(await auditLog({
        userId, userName: userId, userRole: 'OPERATOR', action: 'CONFIG_CHANGED',
        targetType: 'system_config', targetId: `${100 + i}`, afterValue: { i, n: 7 }, reason: '0055', ipAddress: '127.0.0.1',
      }));
    }
    // The rows exactly as the export reads them (fetchAllTablesRaw: SELECT *).
    const rows = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
      'SELECT * FROM audit_trail WHERE id = ANY($1::uuid[]) ORDER BY chain_position', ids);
    expect(rows).toHaveLength(3);
    const file = zip({ 'audit_trail.csv': generateCsv(rows) });

    const v = await validate(file);
    // Rows of other writers may sit between ours in the chain, so only the
    // per-row checksum is asserted, not the links.
    expect(v.auditChain?.totalRows).toBe(3);
    expect(v.auditChain?.checksumFailures).toBe(0);

    await restore(file, saCtx);
    const back = restored().data.audit_trail as Array<Record<string, unknown>>;
    expect(back.map((r) => r.user_id)).toEqual([numericUser, numericUser, rows[2].user_id]);
    expect(back.every((r) => typeof r.user_id === 'string' && typeof r.target_id === 'string' && r.reason === '0055')).toBe(true);
    expect(back[0].checksum_version).toBe(rows[0].checksum_version);
    expect(back[0].after_value).toEqual({ i: 0, n: 7 });
  });
});

describe('CSV backup: cells are typed by the column\'s real type', () => {
  it('text that looks numeric or boolean stays text in a text column; integer, boolean and jsonb columns are typed', async () => {
    const id = randomUUID();
    const csv = [
      'id,name,display_name,description,hierarchy_level,permissions,color,is_system,is_active',
      `${id},123456,true,0055,7,"[""USER_READ""]",-1,false,true`,
    ].join('\n');
    await restore(zip({ 'roles.csv': csv }), saCtx);
    expect(restored().data.roles).toEqual([{
      id, name: '123456', display_name: 'true', description: '0055', hierarchy_level: 7,
      permissions: ['USER_READ'], color: '-1', is_system: false, is_active: true,
    }]);
  });
});

describe('CSV backup: empty string and NULL stay apart (D-DB-4)', () => {
  it('the exporter writes "" for an empty string and nothing for NULL; the importer reads them back as written', async () => {
    const a = randomUUID(); const b = randomUUID(); const h = randomUUID();
    const file = zip({
      'roles.csv': generateCsv([
        { id: a, name: 'cvz-a', description: '', created_by: null },
        { id: b, name: 'cvz-b', description: null, created_by: '' },
      ]),
      // help_articles.content is NOT NULL text: an empty one turned into NULL would fail the restore.
      'help_articles.csv': generateCsv([{ id: h, key: 'cvz-k', title: 'T', content: '' }]),
    });
    await restore(file, saCtx);
    expect(restored().data.roles).toEqual([
      { id: a, name: 'cvz-a', description: '', created_by: null },
      { id: b, name: 'cvz-b', description: null, created_by: '' },
    ]);
    expect(restored().data.help_articles).toEqual([{ id: h, key: 'cvz-k', title: 'T', content: '' }]);
  });

  it('a file written before the change (empty cell for both) still reads as it always did: NULL', async () => {
    const id = randomUUID();
    await restore(zip({ 'roles.csv': `id,name,description,created_by\n${id},cvz-old,,\n` }), saCtx);
    expect(restored().data.roles).toEqual([{ id, name: 'cvz-old', description: null, created_by: null }]);
  });
});
