/**
 * The in-app importers for the CSV (ZIP) and SQL backup formats (coverage
 * campaign 2026-10-21). restoreFromBackup and auditLog are mocked so the parsed
 * BackupData the service hands to the database layer can be asserted exactly;
 * the parsers, checksum, signature gate and metadata handling are real.
 *
 * Multi-line CSV cells are deliberately absent: they are mis-parsed today
 * (reported defect — parseCsvContent splits on '\n' before honouring quotes).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AdmZip from 'adm-zip';

const { mockRestoreFromBackup, mockAuditLog } = vi.hoisted(() => ({
  mockRestoreFromBackup: vi.fn(async () => 4),
  mockAuditLog: vi.fn(async () => 'audit-id'),
}));
vi.mock('../backup.repository.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  restoreFromBackup: mockRestoreFromBackup,
}));
vi.mock('../../../lib/audit.js', () => ({ auditLog: mockAuditLog }));

import { restore, validate } from '../backup.service.js';
import { computeBackupChecksum, generateCsv } from '../backup.helpers.js';

const saCtx = { userId: 'cov-sa', userSub: 's', userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: 'sess' } as any;
const adminCtx = { ...saCtx, userRole: 'ADMIN' };

function zip(entries: Record<string, string>): Buffer {
  const z = new AdmZip();
  for (const [name, content] of Object.entries(entries)) z.addFile(name, Buffer.from(content, 'utf-8'));
  return z.toBuffer();
}
const parsed = () => (mockRestoreFromBackup.mock.calls.at(-1) as any[])[0];

beforeEach(() => {
  mockRestoreFromBackup.mockClear();
  mockAuditLog.mockClear();
});

describe('CSV (ZIP) importer', () => {
  const users = [
    'id,username,active,count,code,phone,ratio,sci,profile,tags,bad,note,empty,missing',
    'u1,"Doe, Jane",true,55,0055,+919876543210,1.0,1e5,"{""a"":1}","[1,2]",{not json},"say ""hi""",',
    'u2,plain,false,-3,abc,x,2.5,12345678901234567,{},[],{x,plain,,',
    '',
  ].join('\n');

  it('types cells canonically and keeps text that only looks numeric', async () => {
    const res = await restore(zip({
      '_metadata.json': JSON.stringify({ generatedBy: 'csv-user', timestamp: '2026-02-02T00:00:00.000Z' }),
      'users.csv': users,
      'roles.csv': 'id,name',          // header only → empty table
      'README.txt': 'ignored',         // not a .csv
    }), saCtx);

    const b = parsed();
    expect(Object.keys(b.data).sort()).toEqual(['roles', 'users']);
    expect(b.data.roles).toEqual([]);
    expect(b.data.users[0]).toEqual({
      id: 'u1', username: 'Doe, Jane', active: true, count: 55,
      code: '0055', phone: '+919876543210', ratio: '1.0', sci: '1e5',   // not coerced (#backup-csv)
      profile: { a: 1 }, tags: [1, 2], bad: '{not json}', note: 'say "hi"',
      empty: null, missing: null,
    });
    expect(b.data.users[1]).toEqual({
      id: 'u2', username: 'plain', active: false, count: -3, code: 'abc', phone: 'x', ratio: 2.5,
      sci: '12345678901234567', // 15+ chars: kept as text, never a lossy float
      profile: {}, tags: [], bad: '{x', note: 'plain', empty: null, missing: null,
    });
    expect(b.metadata).toMatchObject({
      version: '1.0.0', format: 'csv', generatedBy: 'csv-user', timestamp: '2026-02-02T00:00:00.000Z', tableCount: 2,
      checksum: computeBackupChecksum(b.data),
    });
    expect(res).toEqual({ success: true, message: 'Database restored successfully', backupTimestamp: '2026-02-02T00:00:00.000Z', backupVersion: '1.0.0' });
    // no checksum gate for CSV (it would be a self-comparison)
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'BACKUP_RESTORED', userId: 'cov-sa',
      afterValue: expect.objectContaining({ generatedBy: 'csv-user', forced: false, auditRowsPreserved: 4 }),
    }));
  });

  // D4 (2026-10-21): rows were split on '\n' BEFORE quotes were honoured, so any
  // multi-line cell (seeded help_articles.content) broke the row and the restore
  // failed with 22P02 on a shifted column.
  it('keeps a quoted multi-line cell (LF and CRLF) in one row', async () => {
    await restore(zip({
      'help_articles.csv': 'id,content,title\r\n1,"line one\nline two",T\r\n2,"a\r\nb, ""c""",U\n',
    }), saCtx);
    expect(parsed().data.help_articles).toEqual([
      { id: 1, content: 'line one\nline two', title: 'T' },
      { id: 2, content: 'a\r\nb, "c"', title: 'U' },
    ]);
  });

  it('round-trips the exporter\'s own CSV (generateCsv) for multi-line, quoted and comma-bearing text', async () => {
    const rows = [
      { id: 'r1', content: 'para one\n\npara two', note: 'has, comma', quote: 'say "hi"', blank: null },
      { id: 'r2', content: 'single', note: '', quote: 'x', blank: null },
    ];
    await restore(zip({ 'help_articles.csv': generateCsv(rows) }), saCtx);
    expect(parsed().data.help_articles).toEqual([
      { id: 'r1', content: 'para one\n\npara two', note: 'has, comma', quote: 'say "hi"', blank: null },
      { id: 'r2', content: 'single', note: null, quote: 'x', blank: null },
    ]);
  });

  // Operator decision 2026-10-22 ("Exact restore"): the export prefixes ' to text
  // that a spreadsheet would run as a formula, and the restore must take it off
  // again. It never did: "=SUM(A1)" came back as "'=SUM(A1)", and a numeric
  // column read as text ("-1.50") came back as "'-1.50", which Postgres cannot
  // cast. Text that ALREADY began with quotes + a trigger must survive too.
  it('round-trips formula-like text exactly: the export\'s neutralising quote is removed on restore', async () => {
    const values = ['=SUM(A1)', '+91 98765', '-1.50', '@user', '\tTAB', "'=already quoted", "''-twice", "it's fine", "'plain", 'x=1', '-'];
    const rows = values.map((v, i) => ({ id: `r${i}`, text: v }));
    const csv = generateCsv(rows);
    for (const line of csv.split('\n').slice(1)) {
      // still safe to open in a spreadsheet: no cell starts with a trigger
      expect(line.split(',')[1].replace(/^"/, '')).not.toMatch(/^[=+\-@\t\r]/);
    }
    await restore(zip({ 'help_articles.csv': csv }), saCtx);
    expect(parsed().data.help_articles.map((r: any) => r.text)).toEqual(values);
  });

  // D9 (2026-10-21): a file with the ZIP magic but no valid archive behind it
  // threw an uncoded AdmZip error, which both routes reported as a 500.
  it('a malformed ZIP is a coded INVALID_ZIP client error on restore and validate', async () => {
    const bad = Buffer.from('PK\x03\x04 not really a zip archive');
    await expect(restore(bad, saCtx)).rejects.toMatchObject({ code: 'INVALID_ZIP', message: expect.stringMatching(/not a valid ZIP archive/) });
    await expect(validate(bad)).rejects.toMatchObject({ code: 'INVALID_ZIP' });
    expect(mockRestoreFromBackup).not.toHaveBeenCalled();
  });

  it('a ZIP whose directory is intact but whose entry data is corrupt is INVALID_ZIP too', async () => {
    const buf = zip({ 'users.csv': `id,note\n${Array.from({ length: 200 }, (_, i) => `u${i},row number ${i}`).join('\n')}\n` });
    // corrupt the deflated payload of the first entry (after its local header)
    const local = buf.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    for (let i = 0; i < 16; i++) buf[dataStart + 4 + i] ^= 0xff;
    await expect(restore(buf, saCtx)).rejects.toMatchObject({ code: 'INVALID_ZIP' });
    expect(mockRestoreFromBackup).not.toHaveBeenCalled();
  });

  it('falls back to default metadata when _metadata.json is corrupt or absent', async () => {
    const before = Date.now();
    await restore(zip({ '_metadata.json': '{ not json', 'users.csv': 'id\nu1' }), saCtx);
    expect(parsed().metadata.generatedBy).toBe('unknown');
    expect(Date.parse(parsed().metadata.timestamp)).toBeGreaterThanOrEqual(before - 1000);
    await restore(zip({ 'users.csv': 'id\nu9' }), saCtx);
    expect(parsed().metadata.generatedBy).toBe('unknown');
    expect(parsed().data.users).toEqual([{ id: 'u9' }]);
    await restore(zip({ '_metadata.json': JSON.stringify({}), 'users.csv': 'id\nu8' }), saCtx);
    expect(parsed().metadata.generatedBy).toBe('unknown');
  });

  it('force=true reaches the repository and is recorded on the BACKUP_RESTORED row as a bypass', async () => {
    await restore(zip({ 'users.csv': 'id\nu1' }), saCtx, { force: true });
    expect(mockRestoreFromBackup.mock.calls.at(-1)![1]).toEqual({ force: true });
    expect(mockAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'BACKUP_RESTORED',
      afterValue: expect.objectContaining({ forced: true }),
      signatureMeaning: 'Database restored from backup by administrator (audit-chain verification BYPASSED)',
    }));
  });

  it('a CSV file is Super-Admin-only (no server signature to check)', async () => {
    await expect(restore(zip({ 'users.csv': 'id\nu1' }), adminCtx)).rejects.toMatchObject({ statusCode: 403, code: 'BACKUP_UNSIGNED' });
    expect(mockRestoreFromBackup).not.toHaveBeenCalled();
  });

  it('validate reports per-table counts and no checksum claim', async () => {
    const v = await validate(zip({ 'users.csv': users, 'roles.csv': 'id,name' }));
    expect(v).toMatchObject({ valid: true, checksumSupported: false, checksumValid: false, totalRecords: 2, tableSummary: { users: 2, roles: 0 } });
  });

  it('refuses a ZIP whose declared size exceeds the decompression limit, before inflating anything', async () => {
    const buf = zip({ 'users.csv': 'id\nu1' });
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buf.writeUInt32LE(0x90000000, cd + 24);
    await expect(validate(buf)).rejects.toMatchObject({ code: 'INVALID_ZIP', message: expect.stringMatching(/^Backup expands to 2416 MB/) });
  });
});

describe('SQL importer — scalar forms', () => {
  it('parses NULL / booleans / signed decimals / escaped quotes / jsonb / enum arrays, with default metadata', async () => {
    const sql = [
      '-- DigiLog Database Backup',
      `INSERT INTO "t" ("a", "b", "c", "d", "e", "f", "g", "h", "i") VALUES (NULL, TRUE, FALSE, -12.5, 'it''s', '{"k":[1,2]}'::jsonb, '{not json'::jsonb, '{"A",NULL,"x\\"y"}'::"NotificationEventType"[], BAREWORD);`,
      `INSERT INTO "t" ("a") VALUES (42);`,
    ].join('\n');
    const before = Date.now();
    await restore(Buffer.from(sql), saCtx);
    const b = parsed();
    expect(b.data.t[0]).toEqual({
      a: null, b: true, c: false, d: -12.5, e: "it's", f: { k: [1, 2] }, g: '{not json', h: ['A', null, 'x"y'], i: 'BAREWORD',
    });
    expect(b.data.t[1]).toEqual({ a: 42 });
    expect(b.metadata).toMatchObject({ format: 'sql', generatedBy: 'unknown', version: '1.0.0' });
    expect(Date.parse(b.metadata.timestamp)).toBeGreaterThanOrEqual(before - 1000);
  });

  // D2 (2026-10-21): the exporter writes self-references NULL and restores them in
  // a trailing UPDATE pass (buildSqlScript). The importer ignored that pass, so an
  // in-app .sql restore silently unparented every asset_instance.
  it('applies the exporter\'s self-reference UPDATE pass, and only that pass', async () => {
    const sql = [
      '-- DigiLog Database Backup',
      'BEGIN;',
      'TRUNCATE TABLE "asset_instances" CASCADE;',
      '-- Table: asset_instances (3 rows)',
      `INSERT INTO "asset_instances" ("id", "name", "parent_id") VALUES ('p1', 'Block', NULL);`,
      `INSERT INTO "asset_instances" ("id", "name", "parent_id") VALUES ('c1', 'O''Area', NULL);`,
      // a text value that merely LOOKS like an UPDATE must not be applied
      `INSERT INTO "asset_instances" ("id", "name", "parent_id") VALUES ('c2', 'note: UPDATE "asset_instances" SET "parent_id" = ''x'' WHERE "id" = ''p1'';', NULL);`,
      '',
      '-- Self-referencing FKs, applied once every row exists (1 rows).',
      `UPDATE "asset_instances" SET "parent_id" = 'p1' WHERE "id" = 'c1';`,
      '',
      '-- Restore the trigger state captured at the top of this script.',
      'COMMIT;',
    ].join('\n');
    await restore(Buffer.from(sql), saCtx);
    const rows = parsed().data.asset_instances;
    expect(rows.find((r: any) => r.id === 'c1').parent_id).toBe('p1');
    expect(rows.find((r: any) => r.id === 'p1').parent_id).toBeNull();
    expect(rows.find((r: any) => r.id === 'c2').parent_id).toBeNull();
    expect(rows.find((r: any) => r.id === 'c1').name).toBe("O'Area");
    // the checksum is taken over the data AFTER the pass
    expect(parsed().metadata.checksum).toBe(computeBackupChecksum(parsed().data));
  });

  it('a self-reference UPDATE for a row the file does not contain is ignored', async () => {
    const sql = [
      '-- DigiLog Database Backup',
      `INSERT INTO "asset_instances" ("id", "parent_id") VALUES ('a', NULL);`,
      `UPDATE "asset_instances" SET "parent_id" = 'a' WHERE "id" = 'ghost';`,
      `UPDATE "other_table" SET "parent_id" = 'a' WHERE "id" = 'a';`,
    ].join('\n');
    await restore(Buffer.from(sql), saCtx);
    expect(parsed().data).toEqual({ asset_instances: [{ id: 'a', parent_id: null }] });
  });

  it('a row with fewer values than columns fills the rest with null', async () => {
    await restore(Buffer.from(`-- DigiLog Database Backup\nINSERT INTO "t" ("a", "b") VALUES ('only');`), saCtx);
    expect(parsed().data.t).toEqual([{ a: 'only', b: null }]);
  });
});
