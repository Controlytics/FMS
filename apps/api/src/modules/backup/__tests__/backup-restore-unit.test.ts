/**
 * The two DESTRUCTIVE restore paths, with the database fully mocked (coverage
 * campaign 2026-10-21). These replace the real scratch-database suite, which was
 * quarantined after it wiped digilog_test_db: nothing in this file can reach a
 * database — lib/prisma, pg-tools and the audit writer are all fakes.
 *
 *   - restoreFromBackup: the statement sequence inside its transaction
 *     (trigger disable/enable, credential carry-over, audit-row parking,
 *     TRUNCATE, two-pass self-reference insert, sequence resync);
 *   - preserveUnbackedAuditRows: both keep-table forms and its guards;
 *   - restoreDump: safety dump first, rollback from it, the two failure codes,
 *     and that the safety copy survives only when the rollback failed.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';

const m = vi.hoisted(() => ({
  prisma: { $queryRawUnsafe: vi.fn(), $executeRawUnsafe: vi.fn(), $transaction: vi.fn() },
  runPgDump: vi.fn(),
  runPgRestore: vi.fn(),
  auditLog: vi.fn(async () => 'audit-row-id'),
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: m.prisma }));
vi.mock('../../../lib/audit.js', () => ({ auditLog: m.auditLog }));
vi.mock('../pg-tools.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runPgDump: m.runPgDump,
  runPgRestore: m.runPgRestore,
}));

import { restoreFromBackup, preserveUnbackedAuditRows } from '../backup.repository.js';
import { restoreDump } from '../backup.service.js';
import { PgToolError } from '../pg-tools.js';

const SENTINEL = '__BACKUP_STRIPPED__';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TABLES = ['users', 'password_history', 'asset_instances', 'audit_trail', 'deviations'];

/** A fake catalog + a transaction client that records every statement. */
function wire(opts: { keepCount?: number; keepCols?: string[]; dbCols?: Record<string, string[]> } = {}) {
  const log: Array<{ kind: 'q' | 'x'; sql: string; args: unknown[] }> = [];
  const dbCols = opts.dbCols ?? {
    users: ['id', 'username', 'password_hash'],
    password_history: ['id', 'user_id', 'password_hash'],
    asset_instances: ['id', 'name', 'parent_id'],
    audit_trail: ['id', 'action', 'chain_position'],
    deviations: ['id', 'deviation_number'],
  };
  m.prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM pg_tables')) return TABLES.map(tablename => ({ tablename }));
    if (sql.includes('key_column_usage')) return [{ table_name: 'asset_instances', column_name: 'parent_id', is_nullable: 'YES' }, { table_name: 'users', column_name: 'manager_id', is_nullable: 'NO' }];
    if (sql.includes("constraint_type = 'FOREIGN KEY'")) return [{ table_name: 'password_history', referenced_table: 'users' }];
    throw new Error(`unexpected catalog query: ${sql}`);
  });
  const tx = {
    $queryRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => {
      log.push({ kind: 'q', sql, args });
      if (sql.includes('FROM pg_trigger')) return [
        { relname: 'audit_trail', tgname: 'audit_trail_no_delete' },
        { relname: 'asset_instances', tgname: 'trg_mirror_asset_instance_iud' },
      ];
      if (sql.startsWith('SELECT id, password_hash FROM "users"')) return [{ id: 'u-live', password_hash: '$2b$live-user' }];
      if (sql.startsWith('SELECT id, password_hash FROM "password_history"')) return [{ id: 'h-live', password_hash: '$2b$live-hist' }];
      if (sql.includes("table_schema='public' AND table_name=$1")) return (dbCols[args[0] as string] ?? []).map(column_name => ({ column_name }));
      if (sql.includes("table_name = 'audit_trail'")) return dbCols.audit_trail.map(column_name => ({ column_name }));
      if (sql.includes('pg_temp%')) return (opts.keepCols ?? dbCols.audit_trail).map(column_name => ({ column_name }));
      if (sql.includes('table_schema = $1 AND table_name = $2')) return (opts.keepCols ?? dbCols.audit_trail).map(column_name => ({ column_name }));
      if (sql.includes('COUNT(*)::int AS n')) return [{ n: opts.keepCount ?? 2 }];
      throw new Error(`unexpected tx query: ${sql}`);
    }),
    $executeRawUnsafe: vi.fn(async (sql: string, ...args: unknown[]) => { log.push({ kind: 'x', sql, args }); return 0; }),
  };
  m.prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown, o?: unknown) => { log.push({ kind: 'x', sql: `TX ${JSON.stringify(o)}`, args: [] }); return fn(tx); });
  const idx = (pred: (s: string) => boolean) => log.findIndex(e => pred(e.sql));
  const all = (pred: (s: string) => boolean) => log.filter(e => pred(e.sql));
  return { log, tx, idx, all };
}

const assets = Array.from({ length: 501 }, (_, i) => ({ id: uuid(1000 + i), name: `A${i}`, parent_id: i === 0 ? null : uuid(1000) }));
function fullBackup(extra: Record<string, any[]> = {}) {
  return {
    metadata: { version: '1.0.0', timestamp: '2026-01-01T00:00:00Z', generatedBy: 'cov', tableCount: 5, checksum: 'x' },
    data: {
      users: [
        { id: 'u-live', username: 'live', password_hash: SENTINEL, not_a_column: 'dropped' },
        { id: 'u-gone', username: 'gone', password_hash: SENTINEL },
        { id: 'u-plain', username: 'plain', password_hash: '$2b$from-backup' },
      ],
      password_history: [
        { id: 'h-live', user_id: 'u-live', password_hash: SENTINEL },
        { id: 'h-gone', user_id: 'u-live', password_hash: SENTINEL },
      ],
      asset_instances: assets,
      // ids in a backup that are not uuids are never used in the ANY($1::uuid[]) filter
      audit_trail: [],
      deviations: [{ id: 'd1', deviation_number: 'DEV-000042' }],
      ...extra,
    },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('restoreFromBackup — inside the transaction', () => {
  it('runs the full, ordered statement sequence and returns the preserved-row count', async () => {
    const w = wire({ keepCount: 3 });
    const preserved = await restoreFromBackup(fullBackup({ retired_table: [{ id: 1 }] }), { force: true });
    expect(preserved).toBe(3);

    expect(w.log[0].sql).toBe('TX {"timeout":300000,"maxWait":30000}');
    // 1) every user trigger on the restored tables is disabled, then re-enabled
    const disables = w.all(s => s.includes('DISABLE TRIGGER')).map(e => e.sql);
    const enables = w.all(s => s.includes('ENABLE TRIGGER') && !s.includes('DISABLE')).map(e => e.sql);
    expect(disables).toEqual(['ALTER TABLE "audit_trail" DISABLE TRIGGER "audit_trail_no_delete"', 'ALTER TABLE "asset_instances" DISABLE TRIGGER "trg_mirror_asset_instance_iud"']);
    expect(enables).toEqual(disables.map(s => s.replace('DISABLE', 'ENABLE')));
    const truncateAt = w.idx(s => s.startsWith('TRUNCATE TABLE'));
    expect(w.idx(s => s.includes('DISABLE TRIGGER'))).toBeLessThan(truncateAt);
    expect(w.idx(s => s.includes(' ENABLE TRIGGER'))).toBeGreaterThan(w.idx(s => s.startsWith('INSERT INTO "audit_trail"')));

    // 2) live audit rows are parked before the wipe, excluding the backup's own ids
    const park = w.log[w.idx(s => s.includes('CREATE TEMP TABLE audit_trail_keep'))];
    expect(park.args).toEqual([[]]);
    expect(w.idx(s => s.includes('CREATE TEMP TABLE audit_trail_keep'))).toBeLessThan(truncateAt);

    // 3) one TRUNCATE naming every table
    // FK-safe topological order, alphabetical within a layer
    expect(w.log[truncateAt].sql).toBe(`TRUNCATE TABLE ${['asset_instances', 'audit_trail', 'deviations', 'users', 'password_history'].map(t => `"${t}"`).join(', ')} CASCADE`);

    // 4) credentials: live hash re-applied only where the id still exists; unknown columns stripped
    const userInsert = JSON.parse(w.all(s => s.startsWith('INSERT INTO "users"'))[0].args[0] as string);
    expect(userInsert).toEqual([
      { id: 'u-live', username: 'live', password_hash: '$2b$live-user' },
      { id: 'u-gone', username: 'gone', password_hash: SENTINEL },
      { id: 'u-plain', username: 'plain', password_hash: '$2b$from-backup' },
    ]);
    const histInsert = JSON.parse(w.all(s => s.startsWith('INSERT INTO "password_history"'))[0].args[0] as string);
    expect(histInsert.map((h: any) => h.password_hash)).toEqual(['$2b$live-hist', SENTINEL]);

    // 5) self-references: NULL on insert (in 500-row batches), patched after
    const assetInserts = w.all(s => s.startsWith('INSERT INTO "asset_instances"'));
    expect(assetInserts).toHaveLength(2);
    const firstBatch = JSON.parse(assetInserts[0].args[0] as string);
    expect(firstBatch).toHaveLength(500);
    expect(firstBatch.every((r: any) => r.parent_id === null)).toBe(true);
    const fixups = w.all(s => s.startsWith('UPDATE "asset_instances" t'));
    expect(fixups).toHaveLength(1); // 500 children fit one batch; the root has no parent and is skipped
    expect(fixups[0].sql).toContain('SET "parent_id" = s."parent_id"');
    const patched = JSON.parse(fixups[0].args[0] as string);
    expect(patched).toHaveLength(500);
    expect(patched[0]).toEqual({ id: uuid(1001), parent_id: uuid(1000) });
    // empty tables are not inserted at all
    expect(w.all(s => s.startsWith('INSERT INTO "audit_trail" SELECT * FROM jsonb'))).toHaveLength(0);
    // a table only the backup knows is skipped, not created
    expect(w.all(s => s.includes('retired_table'))).toHaveLength(0);

    // 6) parked rows come back, then sequences are realigned (audit_trail always)
    expect(w.idx(s => s.startsWith('INSERT INTO "audit_trail" ("id", "action", "chain_position") SELECT'))).toBeGreaterThan(-1);
    const setvals = w.all(s => s.includes('setval')).map(e => e.sql);
    expect(setvals.some(s => s.includes("'audit_trail_chain_position_seq'"))).toBe(true);
    expect(setvals.some(s => s.includes("'deviation_number_seq'"))).toBe(true);
    expect(setvals.some(s => s.includes("'qnn_seq'"))).toBe(false); // quality_notifications not restored
  });

  it('passes only well-formed uuids from the backup into the audit parking filter', async () => {
    const w = wire();
    await restoreFromBackup(fullBackup({ audit_trail: [{ id: uuid(7), action: 'A' }, { id: 'not-a-uuid', action: 'B' }, { id: 42, action: 'C' }] }), { force: true });
    expect(w.log[w.idx(s => s.includes('CREATE TEMP TABLE audit_trail_keep'))].args).toEqual([[uuid(7)]]);
  });

  it('resyncs audit_trail even when the backup carried no audit table', async () => {
    const w = wire();
    const b = fullBackup();
    delete b.data.audit_trail;
    await restoreFromBackup(b, { force: true });
    expect(w.all(s => s.includes("'audit_trail_chain_position_seq'"))).toHaveLength(1);
  });
});

describe('restoreFromBackup — before the transaction', () => {
  it('names omitted tables without the §11 warning when audit_trail is present, and never opens a transaction', async () => {
    wire();
    const b = fullBackup();
    delete b.data.deviations;
    const err = await restoreFromBackup(b).catch(e => e);
    expect(err).toMatchObject({ statusCode: 400, code: 'BACKUP_INCOMPLETE' });
    expect(err.message).toBe(
      'Backup omits 1 table(s) that exist in this database: deviations. Restore truncates every table, so these would be permanently emptied. '
      + 'Re-export a full backup, or pass force=true to accept the data loss.',
    );
    expect(m.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('tables in an FK cycle are restored after every acyclic table, in name order', async () => {
    const { getAllTables } = await import('../backup.repository.js');
    m.prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM pg_tables')) return ['zeta', 'cyc_b', 'cyc_a', 'alpha', '_prisma_migrations'].map(tablename => ({ tablename }));
      return [
        { table_name: 'cyc_a', referenced_table: 'cyc_b' },
        { table_name: 'cyc_b', referenced_table: 'cyc_a' },
        { table_name: 'zeta', referenced_table: 'alpha' },
        { table_name: 'alpha', referenced_table: 'alpha' },       // self-reference: ignored here
        { table_name: 'zeta', referenced_table: 'not_listed' },   // outside the set: ignored
      ];
    });
    expect(await getAllTables()).toEqual(['alpha', 'zeta', 'cyc_a', 'cyc_b']);
  });
});

describe('buildSqlScript (the .sql export) over a fake catalog', () => {
  it('writes self-references NULL, patches them after every row exists, and casts enum arrays', async () => {
    const { buildSqlScript } = await import('../backup.service.js');
    const rows: Record<string, any[]> = {
      asset_instances: [
        { id: 'p1', name: "O'Block", parent_id: null },
        { id: 'c1', name: 'Area', parent_id: 'p1' },
      ],
      notification_rules: [{ id: 'r1', event_types: ['DEVICE_ONLINE', 'DEVICE_OFFLINE'] }],
      empty_table: [],
    };
    m.prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM pg_tables')) return Object.keys(rows).map(tablename => ({ tablename }));
      if (sql.includes('key_column_usage')) return [{ table_name: 'asset_instances', column_name: 'parent_id', is_nullable: 'YES' }];
      if (sql.includes("constraint_type = 'FOREIGN KEY'")) return [];
      if (sql.includes("data_type = 'ARRAY'")) return [{ table_name: 'notification_rules', column_name: 'event_types', udt_name: '_NotificationEventType' }];
      const count = /COUNT\(\*\)::bigint AS c FROM "(\w+)"/.exec(sql);
      if (count) return [{ c: BigInt(rows[count[1]].length) }];
      const select = /^SELECT \* FROM "(\w+)"/.exec(sql);
      if (select) return rows[select[1]].map(r => ({ ...r }));
      throw new Error(`unexpected: ${sql}`);
    });
    const { sqlContent, totalRecords } = await buildSqlScript('cov-user');
    expect(totalRecords).toBe(3);
    expect(sqlContent).toContain('-- Generated By: cov-user');
    expect(sqlContent).toContain('-- Table: empty_table (0 rows)');
    expect(sqlContent).toContain(`INSERT INTO "asset_instances" ("id", "name", "parent_id") VALUES ('c1', 'Area', NULL);`);
    expect(sqlContent).toContain(`INSERT INTO "asset_instances" ("id", "name", "parent_id") VALUES ('p1', 'O''Block', NULL);`);
    expect(sqlContent).toContain('-- Self-referencing FKs, applied once every row exists (1 rows).');
    expect(sqlContent).toContain(`UPDATE "asset_instances" SET "parent_id" = 'p1' WHERE "id" = 'c1';`);
    expect(sqlContent).toContain(`'{"DEVICE_ONLINE","DEVICE_OFFLINE"}'::"NotificationEventType"[]`);
    // the fix-ups run after every INSERT, inside the one transaction
    expect(sqlContent.indexOf('UPDATE "asset_instances"')).toBeGreaterThan(sqlContent.lastIndexOf('INSERT INTO'));
    expect(sqlContent.indexOf('BEGIN;')).toBeLessThan(sqlContent.indexOf('TRUNCATE'));
    expect(sqlContent.trimEnd().endsWith('COMMIT;')).toBe(true);
  });
});

describe('preserveUnbackedAuditRows', () => {
  it('a schema-qualified keep table is read through information_schema, renumbers collisions, inserts by position', async () => {
    const w = wire({ keepCount: 5 });
    const n = await preserveUnbackedAuditRows(w.tx, 'digilog_keep.audit_trail');
    expect(n).toBe(5);
    const colQuery = w.log.find(e => e.sql.includes('table_schema = $1 AND table_name = $2'))!;
    expect(colQuery.args).toEqual(['digilog_keep', 'audit_trail']);
    expect(w.log.find(e => e.sql.startsWith('DELETE FROM'))!.sql).toBe('DELETE FROM "digilog_keep"."audit_trail" k WHERE EXISTS (SELECT 1 FROM "audit_trail" a WHERE a.id = k.id)');
    expect(w.log.some(e => e.sql.includes('UPDATE "digilog_keep"."audit_trail" k SET chain_position = mx.m + coll.rn'))).toBe(true);
    expect(w.log.at(-1)!.sql).toBe('INSERT INTO "audit_trail" ("id", "action", "chain_position") SELECT "id", "action", "chain_position" FROM "digilog_keep"."audit_trail" ORDER BY "chain_position"');
  });

  it('without a chain_position column it skips renumbering and orders by id', async () => {
    const w = wire({ dbCols: { audit_trail: ['id', 'action'] } as any, keepCols: ['id', 'action', 'dropped_col'] });
    await preserveUnbackedAuditRows(w.tx, 'audit_trail_keep');
    expect(w.log.some(e => e.sql.includes('SET chain_position'))).toBe(false);
    // a column the live table no longer has is left out of the copy
    expect(w.log.at(-1)!.sql).toBe('INSERT INTO "audit_trail" ("id", "action") SELECT "id", "action" FROM "audit_trail_keep" ORDER BY "id"');
  });

  it('copies nothing when no rows remain, or when the keep table has no id column', async () => {
    let w = wire({ keepCount: 0 });
    expect(await preserveUnbackedAuditRows(w.tx, 'audit_trail_keep')).toBe(0);
    expect(w.log.some(e => e.sql.startsWith('INSERT INTO "audit_trail"'))).toBe(false);
    w = wire({ keepCols: ['action'] });
    expect(await preserveUnbackedAuditRows(w.tx, 'audit_trail_keep')).toBe(0);
    expect(w.tx.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('refuses an unsafe keep-table name before running any SQL', async () => {
    const w = wire();
    await expect(preserveUnbackedAuditRows(w.tx, 'evil;drop.audit_trail')).rejects.toThrow(/^Refusing to use unsafe SQL identifier: "evil;drop"$/);
    await expect(preserveUnbackedAuditRows(w.tx, 'audit trail')).rejects.toThrow(/unsafe SQL identifier/);
    expect(w.tx.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('restoreDump (pg_dump archive restore)', () => {
  const sa = { userId: 'cov-sa', userSub: 's', userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: 'sess' } as any;
  const archive = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(64)]);
  let order: string[];

  /** SHOW server_version, the keep-schema DDL and the reset all go through $executeRawUnsafe / $queryRawUnsafe. */
  function wireDump(opts: { restoreFails?: number; rollbackFails?: boolean; dumpFails?: boolean; preserveFails?: boolean } = {}) {
    order = [];
    let restoreCalls = 0;
    m.prisma.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (sql === 'SHOW server_version') return [{ server_version: '18.3' }];
      throw new Error(`unexpected: ${sql}`);
    });
    m.prisma.$executeRawUnsafe.mockImplementation(async (sql: string) => { order.push(sql); return 0; });
    m.runPgDump.mockImplementation(async (path: string) => {
      order.push(`pg_dump ${path.endsWith('pre-restore-safety.dump') ? 'safety' : path}`);
      if (opts.dumpFails) throw new PgToolError('PG_TOOL_NOT_FOUND', 'pg_dump.exe was not found.', null, '');
    });
    m.runPgRestore.mockImplementation(async (path: string) => {
      restoreCalls++;
      const which = path.endsWith('pre-restore-safety.dump') ? 'safety' : path.endsWith('upload.dump') ? 'upload' : path;
      order.push(`pg_restore ${which}`);
      if (which === 'upload' && opts.restoreFails) throw new PgToolError('PG_TOOL_FAILED', 'pg_restore: error: could not execute query', 1, '');
      if (which === 'safety' && opts.rollbackFails) throw new PgToolError('PG_TOOL_FAILED', 'pg_restore: error: connection lost', 1, '');
      return { stderr: '' };
    });
    m.prisma.$transaction.mockImplementation(async () => {
      order.push('preserve audit rows');
      // a Prisma failure: its text embeds source paths and must never reach the client
      if (opts.preserveFails) throw new Error('Invalid `tx.$executeRawUnsafe()` invocation in C:/app/backup.repository.ts:772');
      return 7;
    });
    return () => restoreCalls;
  }

  it('is refused for anyone but a Super Admin, before anything is touched', async () => {
    wireDump();
    await expect(restoreDump(archive, { ...sa, userRole: 'ADMIN' })).rejects.toMatchObject({ statusCode: 403, code: 'BACKUP_UNSIGNED' });
    expect(m.runPgDump).not.toHaveBeenCalled();
    expect(m.prisma.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it('success: safety dump → park the audit trail → reset → load → bring rows back → drop the park → audit', async () => {
    wireDump();
    const res = await restoreDump(archive, sa);
    expect(res).toMatchObject({ success: true, message: 'Database restored successfully from pg_dump archive.', backupVersion: 'pg_dump' });
    expect(order).toEqual([
      'pg_dump safety',
      'DROP SCHEMA IF EXISTS digilog_keep CASCADE',
      'CREATE SCHEMA digilog_keep',
      'CREATE TABLE digilog_keep.audit_trail AS SELECT * FROM public.audit_trail',
      'DROP SCHEMA public CASCADE',
      'CREATE SCHEMA public',
      'pg_restore upload',
      'preserve audit rows',
      'DROP SCHEMA IF EXISTS digilog_keep CASCADE',
    ]);
    // D5: the server major comes from SHOW server_version's own column
    expect(m.runPgDump.mock.calls[0][1]).toEqual({ serverMajor: 18 });
    expect(m.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'BACKUP_RESTORED', userId: 'cov-sa',
      afterValue: expect.objectContaining({ format: 'dump', bytes: archive.length, auditRowsPreserved: 7 }),
    }));
    // the temp dir (archive + safety dump) is removed
    const uploadPath = m.runPgRestore.mock.calls[0][0] as string;
    expect(existsSync(dirname(uploadPath))).toBe(false);
  });

  it('a failed load is rolled back from the safety dump → RESTORE_FAILED, temp dir removed, nothing audited', async () => {
    wireDump({ restoreFails: 1 });
    const err = await restoreDump(archive, sa).catch(e => e);
    expect(err).toMatchObject({ code: 'RESTORE_FAILED' });
    expect(err.message).toBe('pg_restore: error: could not execute query The database was rolled back to its pre-restore state.');
    // ...then the parked audit trail is dropped (D-DB-10).
    expect(order.slice(-4, -1)).toEqual(['DROP SCHEMA public CASCADE', 'CREATE SCHEMA public', 'pg_restore safety']);
    expect(m.auditLog).not.toHaveBeenCalled();
    expect(existsSync(dirname(m.runPgRestore.mock.calls[0][0] as string))).toBe(false);
  });

  it('a failure while bringing audit rows back is also rolled back — and its raw text never reaches the client', async () => {
    wireDump({ preserveFails: true });
    const err = await restoreDump(archive, sa).catch(e => e);
    expect(err).toMatchObject({ code: 'RESTORE_FAILED' });
    expect(err.message).toBe('An internal error stopped the restore (details are in the server log). The database was rolled back to its pre-restore state.');
    expect(err.message).not.toMatch(/Invalid `|backup\.repository\.ts/);
    expect(order.slice(-2)).toEqual(['pg_restore safety', 'DROP SCHEMA IF EXISTS digilog_keep CASCADE']);
  });

  // D1 (2026-10-21): the parked audit rows come back ABOVE the archive's
  // sequence value; without a resync the next audit row reused a taken
  // chain_position and verify-chain reported the chain broken.
  it('realigns audit_trail_chain_position_seq in the same transaction that brings the audit rows back', async () => {
    wireDump();
    const sql: string[] = [];
    const tx = {
      $queryRawUnsafe: vi.fn(async (q: string) => {
        if (q.includes("table_name = 'audit_trail'") || q.includes('table_schema = $1')) return [{ column_name: 'id' }, { column_name: 'chain_position' }];
        if (q.includes('COUNT(*)')) return [{ n: 2 }];
        throw new Error(`unexpected tx query: ${q}`);
      }),
      $executeRawUnsafe: vi.fn(async (q: string) => { sql.push(q); return 0; }),
    };
    m.prisma.$transaction.mockImplementation(async (fn: (t: unknown) => unknown) => fn(tx));
    const res = await restoreDump(archive, sa);
    expect(res.success).toBe(true);
    const insertAt = sql.findIndex(s => s.startsWith('INSERT INTO "audit_trail"'));
    const setvalAt = sql.findIndex(s => s.includes("setval('audit_trail_chain_position_seq'"));
    expect(insertAt).toBeGreaterThan(-1);
    expect(setvalAt).toBeGreaterThan(insertAt);
    expect(sql[setvalAt]).toContain('COALESCE((SELECT MAX(chain_position) FROM "audit_trail"), 0) + 1, false');
    expect(m.auditLog).toHaveBeenCalledWith(expect.objectContaining({ afterValue: expect.objectContaining({ auditRowsPreserved: 2 }) }));
  });

  it('when the rollback fails too → RESTORE_FAILED_NO_ROLLBACK, and the safety copy is KEPT on disk', async () => {
    wireDump({ restoreFails: 1, rollbackFails: true });
    const err = await restoreDump(archive, sa).catch(e => e);
    expect(err.code).toBe('RESTORE_FAILED_NO_ROLLBACK');
    const safety = m.runPgDump.mock.calls[0][0] as string;
    expect(err.message).toBe(
      `pg_restore: error: could not execute query CRITICAL: the rollback ALSO failed (pg_restore: error: connection lost). The database may be empty. A safety copy was written to ${safety} — do not delete it. The audit trail as it was before the restore is also kept in schema digilog_keep.`,
    );
    expect(err.keepDir).toBe(dirname(safety));
    expect(existsSync(err.keepDir)).toBe(true);
    await rm(err.keepDir, { recursive: true, force: true });
  });

  // D-DB-10 (2026-10-22): the parked copy of the audit trail (schema digilog_keep)
  // was dropped only on success. After a failed restore it stayed in the database:
  // a full, mutable, unchained copy of audit_trail that every later backup carried.
  it('a failed load drops the parked audit trail (digilog_keep) after the rollback', async () => {
    wireDump({ restoreFails: 1 });
    const err = await restoreDump(archive, sa).catch(e => e);
    expect(err).toMatchObject({ code: 'RESTORE_FAILED' });
    expect(order.slice(-4)).toEqual([
      'DROP SCHEMA public CASCADE', 'CREATE SCHEMA public', 'pg_restore safety',
      'DROP SCHEMA IF EXISTS digilog_keep CASCADE',
    ]);
  });

  it('a failure while parking the audit trail drops the half-built digilog_keep and touches nothing else', async () => {
    wireDump();
    m.prisma.$executeRawUnsafe.mockImplementation(async (sql: string) => {
      order.push(sql);
      if (sql.startsWith('CREATE TABLE digilog_keep.audit_trail')) throw new Error('could not extend file: No space left on device');
      return 0;
    });
    await expect(restoreDump(archive, sa)).rejects.toThrow('No space left on device');
    expect(order).toEqual([
      'pg_dump safety',
      'DROP SCHEMA IF EXISTS digilog_keep CASCADE',
      'CREATE SCHEMA digilog_keep',
      'CREATE TABLE digilog_keep.audit_trail AS SELECT * FROM public.audit_trail',
      'DROP SCHEMA IF EXISTS digilog_keep CASCADE',
    ]);
    expect(m.runPgRestore).not.toHaveBeenCalled();
  });

  it('when the rollback fails too, the parked audit trail is KEPT with the safety dump (it may be the only other copy)', async () => {
    wireDump({ restoreFails: 1, rollbackFails: true });
    const err = await restoreDump(archive, sa).catch(e => e);
    expect(err.code).toBe('RESTORE_FAILED_NO_ROLLBACK');
    expect(order.at(-1)).toBe('pg_restore safety');
    expect(err.message).toMatch(/The audit trail as it was before the restore is also kept in schema digilog_keep\.$/);
    await rm(err.keepDir, { recursive: true, force: true });
  });

  it('a pg_dump that cannot run stops before anything destructive; the temp dir is removed', async () => {
    wireDump({ dumpFails: true });
    const err = await restoreDump(archive, sa).catch(e => e);
    expect(err).toBeInstanceOf(PgToolError);
    expect(order).toEqual(['pg_dump safety']);
    expect(m.runPgRestore).not.toHaveBeenCalled();
    expect(existsSync(dirname(m.runPgDump.mock.calls[0][0] as string))).toBe(false);
  });
});

// D5 (2026-10-21): `SHOW server_version` answers in a column NAMED server_version;
// reading `.v` gave '' → 0, which disarmed the pg_dump version gate and wrote
// serverMajor: 0 into every dump BACKUP_CREATED audit row.
describe('getServerMajorVersion', () => {
  it.each([
    ['18.3', 18],
    ['17.6 (Ubuntu 17.6-1.pgdg24.04+1)', 17],
    ['18beta1', 18],
  ])('reads %s as major %i', async (raw, major) => {
    const { getServerMajorVersion } = await import('../backup.repository.js');
    m.prisma.$queryRawUnsafe.mockResolvedValueOnce([{ server_version: raw }]);
    expect(await getServerMajorVersion()).toBe(major);
    expect(m.prisma.$queryRawUnsafe).toHaveBeenLastCalledWith('SHOW server_version');
  });

  it.each([[[{ server_version: 'unknown' }]], [[]], [[{ v: '18.3' }]]])('refuses an unreadable answer (%j) instead of guessing 0', async (rows) => {
    const { getServerMajorVersion } = await import('../backup.repository.js');
    m.prisma.$queryRawUnsafe.mockResolvedValueOnce(rows);
    await expect(getServerMajorVersion()).rejects.toThrow(/^Could not parse PostgreSQL server_version from/);
  });
});

// D10 (2026-10-21): a pg_dump that failed left its digilog-backup-* directory —
// and whatever partial archive pg_dump had written — behind in %TEMP%.
describe('exportDump temp directory', () => {
  const sa = { userId: 'cov-sa', userSub: 's', userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'vitest', sessionId: 'sess' } as any;
  const newBackupDirs = async (before: Set<string>) => {
    const { readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    return (await readdir(tmpdir())).filter(n => n.startsWith('digilog-backup-') && !before.has(n));
  };
  const snapshot = async () => {
    const { readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    return new Set((await readdir(tmpdir())).filter(n => n.startsWith('digilog-backup-')));
  };

  it('is removed when pg_dump fails, and the error still reaches the caller', async () => {
    const { exportDump } = await import('../backup.service.js');
    m.prisma.$queryRawUnsafe.mockResolvedValue([{ server_version: '18.3' }]);
    m.runPgDump.mockImplementationOnce(async (path: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, 'PGDMP partial'); // a half-written archive
      throw new PgToolError('PG_TOOL_TIMEOUT', 'pg_dump exceeded the 30 minute time limit and was terminated.', null, '');
    });
    const before = await snapshot();
    await expect(exportDump('cov-sa', sa)).rejects.toMatchObject({ code: 'PG_TOOL_TIMEOUT' });
    expect(await newBackupDirs(before)).toEqual([]);
    expect(m.auditLog).not.toHaveBeenCalled();
  });

  it('is kept on success (the route streams from it and cleans up afterwards)', async () => {
    const { exportDump } = await import('../backup.service.js');
    m.prisma.$queryRawUnsafe.mockResolvedValue([{ server_version: '18.3' }]);
    m.runPgDump.mockImplementationOnce(async (path: string) => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(path, 'PGDMP full');
    });
    const out = await exportDump('cov-sa', sa);
    expect(existsSync(out.filePath)).toBe(true);
    expect(m.auditLog).toHaveBeenCalledWith(expect.objectContaining({ afterValue: expect.objectContaining({ format: 'dump', bytes: 10, serverMajor: 18 }) }));
    await out.cleanup();
    expect(existsSync(dirname(out.filePath))).toBe(false);
  });
});
