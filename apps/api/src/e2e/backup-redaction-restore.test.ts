/**
 * Backups carry their own redaction evidence (security assessment P1 follow-up,
 * 2026-10-22).
 *
 * A redacted audit row is verified against its redaction record (the
 * AUDIT_RECORD_REDACTED / AUDIT_RECORDS_BULK_REDACTED meta row). Restore checks
 * a backup's audit chain BEFORE it installs anything (verifyBackupAuditChain),
 * and there the evidence is the meta rows inside the same file. So:
 *   - a backup of a database holding legitimate redactions (single, bulk, and
 *     one made before 2026-10-22 with the old 5-field record) passes that gate;
 *   - a backup holding a forged "redaction" - no record, or a record that does
 *     not match - is refused (400 BACKUP_AUDIT_CHAIN_INVALID) and /validate
 *     reports it.
 *
 * The rows are real: written by auditLog, redacted through the real
 * /api/audit redact routes, then read the way the exporter reads them
 * (`SELECT *` + bigint→string, fetchAllTablesRaw) and round-tripped through
 * JSON like a backup file. Every forgery lives only in the in-memory file.
 *
 * 🔴 A real restore TRUNCATES the database every agent shares, so none may run
 * here (the scratch-database suite is quarantined). The file sent holds ONE
 * table, audit_trail: restore checks the chain first and then refuses a backup
 * that omits tables (400 BACKUP_INCOMPLETE) before its transaction. So
 * "accepted" below means: the chain gate passed and the NEXT guard answered.
 * That is a proxy for a restore, not a restore. Belt and braces:
 * `restoreGuarded` also refuses any other table set and makes
 * restoreFromBackup's own prisma.$transaction throw if it is ever reached.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { auditLog } from '../lib/audit.js';
import { computeBackupChecksum } from '../modules/backup/backup.helpers.js';
import { multipart } from '../modules/backup/__tests__/cov-backup-helpers.js';
import { restoreFromBackup as realRestoreFromBackup } from '../modules/backup/backup.repository.js';
import { runSuffix, createUser, login, deleteUsers } from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `cv_bkred_${SUF}`.toLowerCase();
const PW = 'CovBkRedact@2026x';
const REASON = 'coverage: backup redaction evidence';

type Row = Record<string, any>;

let app: FastifyInstance;
let token = '';
let saId = '';
/** The audit_trail rows of the backup file, exactly as an export would hold them. */
let slice: Row[] = [];
const id = { single: '', bulkA: '', bulkB: '', plain: '', legacy: '' };
const meta = { single: '', bulk: '', legacy: '' };

const H = () => ({ authorization: `Bearer ${token}`, 'x-reauth-password': PW });

/** A backup file holding only these audit rows. Built AFTER any forgery, so the file checksum matches. */
function backupFile(auditRows: Row[]): string {
  const data = { audit_trail: auditRows };
  return JSON.stringify({
    metadata: { version: '1.0.0', timestamp: new Date().toISOString(), generatedBy: SA, tableCount: 1, checksum: computeBackupChecksum(data), format: 'json' },
    data,
  });
}

/**
 * Make restoreFromBackup's transaction (TRUNCATE + reinsert) impossible while
 * `fn` runs. Every other $transaction (auditLog, re-auth) passes through.
 *
 * Plain assignment, NOT vi.spyOn: the Prisma 6 client is a Proxy whose
 * getOwnPropertyDescriptor reports `$transaction` without a value, so
 * spy.mockRestore() put back `undefined` and broke $transaction for the rest
 * of the process (seen on the first run of this file).
 */
async function withRestoreGuard<T>(fn: () => Promise<T>): Promise<{ result: T; trips: number }> {
  const client = prisma as unknown as { $transaction: (...a: unknown[]) => unknown };
  const original = client.$transaction;
  if (typeof original !== 'function') throw new Error('withRestoreGuard: prisma.$transaction is not a function');
  let trips = 0;
  client.$transaction = function guarded(this: unknown, ...args: unknown[]) {
    if (/\bat (?:async )?restoreFromBackup\b/.test(new Error().stack ?? '')) {
      trips++;
      throw new Error('GUARD: restoreFromBackup reached its write phase on the shared test database');
    }
    return original.apply(this, args);
  };
  try {
    return { result: await fn(), trips };
  } finally {
    client.$transaction = original;
  }
}

async function restoreGuarded(file: string) {
  const tables = Object.keys(JSON.parse(file).data ?? {});
  if (tables.length !== 1 || tables[0] !== 'audit_trail') {
    throw new Error(`restoreGuarded: refusing a backup naming ${tables.join(', ')} on the shared DB`);
  }
  const { result, trips } = await withRestoreGuard(() => {
    const mp = multipart(file, 'redactions.json');
    return app.inject({ method: 'POST', url: '/api/backup/restore', headers: { ...H(), ...mp.headers }, payload: mp.payload });
  });
  expect(trips, 'restore must never reach its transaction here').toBe(0);
  return result;
}

async function validate(file: string) {
  const mp = multipart(file, 'redactions.json');
  const res = await app.inject({ method: 'POST', url: '/api/backup/validate', headers: { ...H(), ...mp.headers }, payload: mp.payload });
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
}

const rowOf = (rows: Row[], rowId: string) => {
  const r = rows.find((x) => x.id === rowId);
  if (!r) throw new Error(`row ${rowId} is not in the backup slice`);
  return r;
};

beforeAll(async () => {
  app = await buildApp();
  saId = await createUser(SA, 'SUPER_ADMIN', PW);
  token = await login(app, SA, PW);

  // Five ordinary rows of this file's own, consecutive in the chain: one
  // transaction holds the chain's advisory lock until it commits.
  const created = await prisma.$transaction(async (tx) => {
    const out: string[] = [];
    for (const tag of ['single', 'bulkA', 'bulkB', 'plain', 'legacy']) {
      out.push(await auditLog({
        userId: SA, userName: SA, userRole: 'SUPER_ADMIN', action: 'CV_BACKUP_REDACTION_PROBE', targetType: 'probe', targetId: `${SUF}-${tag}`,
        beforeValue: { secret: `before-${tag}` }, afterValue: { secret: `after-${tag}` }, reason: `probe ${tag}`,
        ipAddress: '10.9.8.6', userAgent: 'vitest', sessionId: `sess-${SUF}`, signatureMeaning: `backup probe ${tag}`,
      }, tx));
    }
    return out;
  });
  [id.single, id.bulkA, id.bulkB, id.plain, id.legacy] = created;

  // Legitimate redactions through the real routes.
  const single = await app.inject({ method: 'POST', url: `/api/audit/${id.single}/redact`, payload: { reason: REASON }, headers: H() });
  expect(single.statusCode, single.body).toBe(200);
  const bulk = await app.inject({ method: 'POST', url: '/api/audit/bulk-redact', payload: { ids: [id.bulkA, id.bulkB], reason: REASON }, headers: H() });
  expect(bulk.statusCode, bulk.body).toBe(200);
  // A redaction made BEFORE 2026-10-22: exactly what the redact handler wrote
  // then - the row update plus a meta row holding the old 5-field record.
  const legacy = (await prisma.$queryRawUnsafe<Row[]>(`SELECT * FROM audit_trail WHERE id = $1::uuid`, id.legacy))[0];
  await prisma.$executeRawUnsafe(
    `UPDATE audit_trail SET before_value = NULL, after_value = NULL, redacted_at = now(), redacted_by = $2, redaction_reason = $3 WHERE id = $1::uuid`,
    id.legacy, saId, REASON);
  meta.legacy = await auditLog({
    userId: SA, userRole: 'SUPER_ADMIN', action: 'AUDIT_RECORD_REDACTED', targetType: 'audit_trail', targetId: id.legacy,
    beforeValue: { id: id.legacy, action: legacy.action, timestamp: legacy.timestamp, userId: legacy.user_id, targetType: legacy.target_type, targetId: legacy.target_id },
    reason: REASON, signatureMeaning: `Audit record ${id.legacy} payload redacted; chain link preserved`,
  });

  meta.single = (await prisma.auditTrail.findFirstOrThrow({ where: { action: 'AUDIT_RECORD_REDACTED', targetId: id.single }, select: { id: true } })).id;
  const bulkMeta = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT id FROM audit_trail WHERE action = 'AUDIT_RECORDS_BULK_REDACTED' AND before_value->'records' @> $1::jsonb`,
    JSON.stringify([{ id: id.bulkA }]));
  expect(bulkMeta).toHaveLength(1);
  meta.bulk = bulkMeta[0].id;

  // The backup's audit rows: this file's chain window, first row to last
  // record, read the way fetchAllTablesRaw reads them and round-tripped
  // through JSON like a backup file.
  const bounds = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT min(chain_position) AS lo, max(chain_position) AS hi FROM audit_trail WHERE id = ANY($1::uuid[])`,
    [...created, meta.single, meta.bulk, meta.legacy]);
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT * FROM "audit_trail" WHERE chain_position BETWEEN $1 AND $2 ORDER BY id ASC`, bounds[0].lo, bounds[0].hi);
  slice = JSON.parse(JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])))));

  // Every chain count below assumes the window holds only this file's rows
  // (its probes, its three records, the re-auth rows its redactions signed).
  // Another agent writing inside it would change those counts for reasons
  // that have nothing to do with redaction - say so instead of failing on a diff.
  const mine = new Set<string>([...created, meta.single, meta.bulk, meta.legacy]);
  const foreign = slice.filter((r) => !mine.has(r.id) && !(r.action === 'REAUTH_SUCCESS' && [SA, saId].includes(r.user_id)));
  if (foreign.length > 0) {
    throw new Error(`Another writer's audit rows landed inside this file's chain window (${foreign
      .map((r) => `${r.action} by ${r.user_id}`).join('; ')}). Not a product failure: re-run this file alone.`);
  }
}, 120_000);

afterAll(async () => {
  // The audit rows stay (audit_trail is append-only; they are a consistent,
  // legitimately redacted set). Only the user goes.
  try { await deleteUsers([saId]); } finally { await app?.close(); }
}, 120_000);

describe('the restore guard used by this file', () => {
  it('really intercepts restoreFromBackup\'s transaction on this Prisma client, and nothing else', async () => {
    // The guard matches the real function's frame name; a rename or wrapper must fail here first.
    expect(realRestoreFromBackup.name).toBe('restoreFromBackup');
    // A stand-in with the same frame name: the guard must stop it.
    async function restoreFromBackup() {
      await Promise.resolve();
      return prisma.$transaction(async () => 'wrote');
    }
    const { result, trips } = await withRestoreGuard(() => restoreFromBackup().then(() => 'no-throw', (e: Error) => e.message));
    expect(result).toMatch(/^GUARD:/);
    expect(trips).toBe(1);
    // Any other caller passes through untouched, and a real transaction runs inside the guard.
    const other = await withRestoreGuard(() => prisma.$transaction(async (tx) => (await tx.$queryRaw<Array<{ n: number }>>`SELECT 1::int AS n`)[0].n));
    expect(other).toEqual({ result: 1, trips: 0 });
    // And the client is whole afterwards (both forms of $transaction).
    expect(await prisma.$transaction(async () => 'after')).toBe('after');
    expect(await prisma.$transaction([prisma.$queryRaw`SELECT 1`])).toHaveLength(1);
  });
});

describe('a backup holding legitimate redactions', () => {
  it('holds the redacted rows and their records as the database does', () => {
    for (const rid of [id.single, id.bulkA, id.bulkB, id.legacy]) {
      expect(rowOf(slice, rid)).toMatchObject({ before_value: null, after_value: null, redaction_reason: REASON });
      expect(rowOf(slice, rid).redacted_at).toEqual(expect.any(String));
    }
    expect(rowOf(slice, id.plain)).toMatchObject({ redacted_at: null, before_value: { secret: 'before-plain' } });
    expect(rowOf(slice, meta.single).before_value).toMatchObject({ snapshotVersion: 2, id: id.single, userId: SA, redactionReason: REASON });
    expect(rowOf(slice, meta.bulk).before_value.records.map((r: Row) => [r.id, r.snapshotVersion])).toEqual(
      expect.arrayContaining([[id.bulkA, 2], [id.bulkB, 2]]));
    expect(rowOf(slice, meta.legacy).before_value).not.toHaveProperty('snapshotVersion');
  });

  it('/validate reports an intact chain, and restore passes the chain gate (stopped only by BACKUP_INCOMPLETE)', async () => {
    const file = backupFile(structuredClone(slice));
    const v = await validate(file);
    expect(v.checksumValid).toBe(true);
    expect(v.auditChain).toMatchObject({ totalRows: slice.length, checksumFailures: 0, linkFailures: 0, samples: [] });

    const res = await restoreGuarded(file);
    expect(res.statusCode, res.body).toBe(400);
    expect(res.json().error).toBe('BACKUP_INCOMPLETE');
  });
});

describe('a backup holding a forged "redaction" is refused', () => {
  /** [label, forge(rows) → the ids that must be named, expected checksum failures, expected link failures] */
  const cases: Array<[string, (rows: Row[]) => string[], number, number]> = [
    ['a row "redacted" in the file with no record (actor rewritten too)', (rows) => {
      Object.assign(rowOf(rows, id.plain), {
        redacted_at: new Date().toISOString(), redacted_by: saId, redaction_reason: 'forged',
        before_value: null, after_value: null, user_id: 'mallory', user_name: 'mallory',
      });
      return [id.plain];
    }, 1, 0],
    ['a redacted row whose actor was rewritten', (rows) => { rowOf(rows, id.single).user_id = 'mallory'; return [id.single]; }, 1, 0],
    ['a redacted row whose action was rewritten', (rows) => { rowOf(rows, id.single).action = 'USER_LOGIN'; return [id.single]; }, 1, 0],
    ['a redacted row whose redactor was rewritten', (rows) => { rowOf(rows, id.single).redacted_by = '00000000-0000-0000-0000-000000000000'; return [id.single]; }, 1, 0],
    ['a redacted row whose redaction reason was rewritten', (rows) => { rowOf(rows, id.single).redaction_reason = 'nothing to see'; return [id.single]; }, 1, 0],
    ['a bulk-redacted row moved in time', (rows) => {
      const r = rowOf(rows, id.bulkB);
      r.timestamp = new Date(new Date(r.timestamp).getTime() + 86_400_000).toISOString();
      return [id.bulkB];
    }, 1, 0],
    ['the redaction record left out of the file', (rows) => {
      rows.splice(rows.findIndex((r) => r.id === meta.single), 1);
      return [id.single];
    }, 1, 1], // the row after the record now links to a row the file lacks
    ['the record rewritten to match a rewritten row', (rows) => {
      rowOf(rows, id.single).user_id = 'mallory';
      rowOf(rows, meta.single).before_value.userId = 'mallory';
      return [id.single, meta.single];
    }, 2, 0], // the record fails its own checksum, so the row it vouches for is unverified
    ['a pre-2026-10-22 redaction whose action was rewritten (a field its 5-field record holds)', (rows) => {
      rowOf(rows, id.legacy).action = 'USER_LOGIN';
      return [id.legacy];
    }, 1, 0],
  ];

  it.each(cases)('%s', async (_label, forge, checksumFailures, linkFailures) => {
    const rows = structuredClone(slice);
    const named = forge(rows);
    const file = backupFile(rows);

    const v = await validate(file);
    expect(v.checksumValid).toBe(true); // the file is self-consistent: only the chain walk can catch this
    expect(v.auditChain).toMatchObject({ checksumFailures, linkFailures });

    const res = await restoreGuarded(file);
    expect(res.statusCode, res.body).toBe(400);
    const body = res.json();
    expect(body.error).toBe('BACKUP_AUDIT_CHAIN_INVALID');
    expect(body.chainReport).toMatchObject({ checksumFailures, linkFailures });
    const flagged = body.chainReport.samples.filter((s: Row) => s.kind === 'checksum').map((s: Row) => s.id);
    expect(flagged.sort()).toEqual([...named].sort());
  });
});
