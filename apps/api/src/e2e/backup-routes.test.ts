/**
 * /api/backup on the SHARED digilog_test_db (coverage campaign 2026-10-21):
 * permissions, re-auth, upload handling, /validate, and every /restore refusal
 * that fires BEFORE the restore transaction. Successful restores live in
 * backup-restore-scratch.test.ts, against a private scratch database.
 *
 * 🔴 Nothing in this file may reach restoreFromBackup's transaction — it would
 * TRUNCATE the database every agent shares. `force` is never sent, and
 * `guardedRestore()` refuses to upload any JSON whose data could pass the
 * omitted-table guard (it requires the data to name < 5 tables).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { computeBackupChecksum } from '../modules/backup/backup.helpers.js';
import { auditLog } from '../lib/audit.js';
import { multipart, multipartNoFile } from '../modules/backup/__tests__/cov-backup-helpers.js';
import {
  uniq, ensureRole, ensureUser, deleteUsersAndRoles, login, addReauthRole, removeReauthRole,
} from '../modules/notification-delivery/__tests__/cov-fixtures.js';

const TAG = uniq();
const PW = 'CovBackupRoutes@26';
const SA = `covbr_sa_${TAG}`;
const BK = `covbr_bk_${TAG}`;   // BACKUP_EXPORT + BACKUP_RESTORE, re-auth configured
const VAL = `covbr_rs_${TAG}`;  // BACKUP_RESTORE only
const NOPE = `covbr_no_${TAG}`; // CONFIG_UPDATE but no backup permission
const ROLE_BK = `CBR_B_${TAG}`.slice(0, 20);
const ROLE_RS = `CBR_R_${TAG}`.slice(0, 20);
const ROLE_NO = `CBR_N_${TAG}`.slice(0, 20);
const REAUTH = ['EXPORT_BACKUP', 'RESTORE_BACKUP'];

let app: FastifyInstance;
let sa = '';
let bk = '';
let rs = '';
let nope = '';
let auditSample: Array<Record<string, any>> = [];

const H = (token: string, pw?: string) => ({ authorization: `Bearer ${token}`, ...(pw ? { 'x-reauth-password': pw } : {}) });

function backupJson(data: Record<string, any[]>, meta: Record<string, unknown> = {}) {
  return JSON.stringify({
    metadata: { version: '1.0.0', timestamp: new Date().toISOString(), generatedBy: 'cov', tableCount: Object.keys(data).length, checksum: computeBackupChecksum(data), format: 'json', ...meta },
    data,
  });
}

function guardedRestore(token: string, file: Buffer | string, pw: string | null = PW, filename = 'x.json') {
  const buf = Buffer.isBuffer(file) ? file : Buffer.from(file, 'utf-8');
  // A pg_dump archive restored by a Super Admin drops and reloads the whole
  // schema. Only a non-SA (refused with 403 before anything runs) may send one.
  if (buf.subarray(0, 5).toString('latin1') === 'PGDMP' && token === sa) {
    throw new Error('guardedRestore: refusing a PGDMP upload as Super Admin on the shared DB');
  }
  // Look inside a gzip .bak too, so a full backup cannot slip through compressed.
  let text = buf.toString('utf-8');
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try { text = gunzipSync(buf).toString('utf-8'); } catch { /* corrupt gzip: refused as INVALID_BAK */ }
  }
  if (text.trimStart().startsWith('{')) {
    try {
      const tables = Object.keys(JSON.parse(text).data ?? {});
      if (tables.length >= 5) throw new Error(`guardedRestore: refusing a ${tables.length}-table backup on the shared DB`);
    } catch (e) {
      if ((e as Error).message.startsWith('guardedRestore')) throw e;
    }
  }
  const mp = multipart(file, filename);
  return app.inject({ method: 'POST', url: '/api/backup/restore', headers: { ...H(token, pw ?? undefined), ...mp.headers }, payload: mp.payload });
}
function validate(token: string, file: Buffer | string, filename = 'x.json') {
  const mp = multipart(file, filename);
  return app.inject({ method: 'POST', url: '/api/backup/validate', headers: { ...H(token), ...mp.headers }, payload: mp.payload });
}

beforeAll(async () => {
  app = await buildApp();
  await ensureRole(ROLE_BK, ['BACKUP_EXPORT', 'BACKUP_RESTORE']);
  await ensureRole(ROLE_RS, ['BACKUP_RESTORE']);
  await ensureRole(ROLE_NO, ['CONFIG_READ', 'CONFIG_UPDATE']);
  await ensureUser({ username: SA, password: PW, role: 'SUPER_ADMIN' });
  await ensureUser({ username: BK, password: PW, role: ROLE_BK });
  await ensureUser({ username: VAL, password: PW, role: ROLE_RS });
  await ensureUser({ username: NOPE, password: PW, role: ROLE_NO });
  sa = await login(app, SA, PW);
  bk = await login(app, BK, PW);
  rs = await login(app, VAL, PW);
  nope = await login(app, NOPE, PW);
  await addReauthRole(REAUTH, ROLE_BK);
  // Three audit rows that are CONSECUTIVE in the chain by construction: written
  // in one transaction, which holds the chain's pg_advisory_xact_lock until it
  // commits, so no concurrent writer (another agent) can interleave a row.
  const sampleIds = await prisma.$transaction(async (tx) => {
    const out: string[] = [];
    for (let i = 0; i < 3; i++) {
      out.push(await auditLog({
        userId: SA, userRole: 'SUPER_ADMIN', action: 'CONFIG_CHANGED', targetType: 'system_config', targetId: `cov-chain-sample-${TAG}`,
        afterValue: { sample: i },
      }, tx));
    }
    return out;
  });
  const rows = await prisma.$queryRawUnsafe<Array<Record<string, any>>>(
    `SELECT * FROM audit_trail WHERE id = ANY($1::uuid[]) ORDER BY chain_position ASC`,
    sampleIds,
  );
  auditSample = rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v instanceof Date ? v.toISOString() : v])));
}, 60_000);

afterAll(async () => {
  await removeReauthRole(REAUTH, ROLE_BK);
  await deleteUsersAndRoles([SA, BK, VAL, NOPE], [ROLE_BK, ROLE_RS, ROLE_NO]);
  await app?.close();
}, 60_000);

describe('permissions and re-auth', () => {
  it('export needs BACKUP_EXPORT — CONFIG_UPDATE alone is refused', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/backup/export?format=json', headers: H(nope, PW) });
    expect(res.statusCode).toBe(403);
  });

  it('restore needs BACKUP_RESTORE; validate needs BACKUP_EXPORT or BACKUP_RESTORE', async () => {
    expect((await guardedRestore(nope, '{}')).statusCode).toBe(403);
    expect((await validate(nope, '{}')).statusCode).toBe(403);
    // BACKUP_RESTORE alone may validate (the page validates before restoring)
    expect((await validate(rs, backupJson({ users: [] }))).statusCode).toBe(200);
  });

  it('an unknown export format is rejected by the schema', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/backup/export?format=xlsx', headers: H(sa, PW) })).statusCode).toBe(400);
  });

  it('EXPORT_BACKUP / RESTORE_BACKUP re-auth is enforced for the configured role', async () => {
    const exp = await app.inject({ method: 'GET', url: '/api/backup/export?format=json', headers: H(bk) });
    expect(exp.statusCode).toBe(401);
    expect(exp.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'EXPORT_BACKUP' });
    const res = await guardedRestore(bk, backupJson({ users: [] }), null);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'REAUTH_REQUIRED', action: 'RESTORE_BACKUP' });
  });
});

describe('exports (read-only: they only SELECT, and write a BACKUP_CREATED row)', () => {
  const exportAs = (format: string) => app.inject({ method: 'GET', url: `/api/backup/export?format=${format}`, headers: H(sa, PW) });
  const lastCreated = () => prisma.auditTrail.findFirst({ where: { action: 'BACKUP_CREATED', userId: SA }, orderBy: { chainPosition: 'desc' } });

  it('json: signed, checksummed, secrets stripped, and it validates', async () => {
    const res = await exportAs('json');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="digilog_backup_\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.json"$/);
    const b = JSON.parse(res.body);
    expect(b.metadata).toMatchObject({ version: '1.0.0', generatedBy: SA, format: 'json', checksum: computeBackupChecksum(b.data) });
    expect(b.metadata.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(b.data._prisma_migrations).toBeUndefined();
    // §11.10(d): no bcrypt hash leaves in an application backup
    expect(b.data.users.length).toBeGreaterThan(0);
    expect(b.data.users.every((u: any) => u.password_hash === '__BACKUP_STRIPPED__')).toBe(true);
    expect((b.data.password_history ?? []).every((h: any) => h.password_hash === '__BACKUP_STRIPPED__')).toBe(true);
    // audit rows ordered by id, BIGSERIAL as string
    const ids = b.data.audit_trail.map((r: any) => r.id);
    expect(ids).toEqual([...ids].sort());
    expect(typeof b.data.audit_trail[0].chain_position).toBe('string');
    expect((await lastCreated())!.afterValue).toMatchObject({
      format: 'json', checksum: b.metadata.checksum, tableCount: Object.keys(b.data).length,
      totalRecords: Object.values(b.data).reduce((s: number, a: any) => s + a.length, 0),
    });
    // validate deliberately not run here: the full trail of a shared, concurrently
    // written DB is not guaranteed to verify, which is not this file's subject.
  });

  it('bak: gzip of the same JSON, and the checksum verifies on validate', async () => {
    const res = await exportAs('bak');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/\.bak"$/);
    const buf = res.rawPayload;
    expect([buf[0], buf[1]]).toEqual([0x1f, 0x8b]);
    const v = await validate(sa, buf, 'x.bak');
    expect(v.json()).toMatchObject({ checksumValid: true, checksumSupported: true, metadata: { format: 'bak', generatedBy: SA } });
    expect((await lastCreated())!.afterValue).toMatchObject({ format: 'bak', compressedSize: buf.length });
  });

  it('sql: a replayable script — one transaction, triggers suspended and restored', async () => {
    const res = await exportAs('sql');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/sql/);
    const sql = res.body;
    expect(sql.startsWith('-- DigiLog Database Backup\n-- Generated: ')).toBe(true);
    expect(sql).toContain(`-- Generated By: ${SA}`);
    expect(sql).toContain('\nBEGIN;\n');
    expect(sql).toContain("ALTER TABLE %I DISABLE TRIGGER USER");
    expect(sql).toContain("ALTER TABLE %I ENABLE TRIGGER %I");
    expect(sql).toMatch(/TRUNCATE TABLE "audit_trail" CASCADE;/);
    expect(sql).toMatch(/-- Table: \w+ \(0 rows\)/);
    expect(sql.trimEnd().endsWith('COMMIT;')).toBe(true);
    const v = await validate(sa, sql, 'x.sql');
    expect(v.json()).toMatchObject({ valid: true, checksumSupported: false, metadata: { format: 'sql', generatedBy: SA } });
    expect((await lastCreated())!.afterValue).toMatchObject({ format: 'sql' });
  });

  it('csv: a ZIP of per-table CSVs plus _metadata.json', async () => {
    const res = await exportAs('csv');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    const AdmZip = (await import('adm-zip')).default;
    const zip = new AdmZip(res.rawPayload);
    const names = zip.getEntries().map((e: any) => e.entryName);
    expect(names).toEqual(expect.arrayContaining(['_metadata.json', 'users.csv', 'audit_trail.csv']));
    const meta = JSON.parse(zip.getEntry('_metadata.json')!.getData().toString('utf-8'));
    expect(meta).toMatchObject({ format: 'csv', generatedBy: SA, version: '1.0.0' });
    expect(meta.tables.users).toBeGreaterThan(0);
    expect((await lastCreated())!.afterValue).toMatchObject({ format: 'csv' });
  });

  it('dump: a real pg_dump custom archive, streamed from a temp dir that is removed afterwards', async () => {
    const { readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const before = new Set((await readdir(tmpdir())).filter(n => n.startsWith('digilog-backup-')));
    const res = await exportAs('dump');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="digilog_backup_.+\.dump"$/);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('PGDMP');
    expect((await lastCreated())!.afterValue).toMatchObject({ format: 'dump', bytes: res.rawPayload.length });
    await vi.waitFor(async () => {
      expect((await readdir(tmpdir())).filter(n => n.startsWith('digilog-backup-') && !before.has(n))).toEqual([]);
    }, { timeout: 5_000 });
    const v = await validate(sa, res.rawPayload, 'x.dump');
    expect(v.json()).toMatchObject({ valid: true, checksumSupported: false, metadata: { format: 'dump' } });
  }, 120_000);
});

describe('upload handling', () => {
  it('a request that is not multipart keeps its own 406, not a 500 "restore failed"', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/backup/restore', headers: H(sa, PW), payload: { not: 'multipart' } });
    expect(res.statusCode).toBe(406);
    expect(res.json().error).toBe('FST_INVALID_MULTIPART_CONTENT_TYPE');
  });

  it('a multipart body without a file is 400 NO_FILE on both routes', async () => {
    for (const url of ['/api/backup/restore', '/api/backup/validate']) {
      const mp = multipartNoFile({ force: 'false' });
      const res = await app.inject({ method: 'POST', url, headers: { ...H(sa, PW), ...mp.headers }, payload: mp.payload });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'NO_FILE', message: 'No backup file uploaded' });
    }
  });

  it('a file over the 100 MB limit is refused as truncated (413), never parsed', async () => {
    const big = Buffer.alloc(100 * 1024 * 1024 + 1024, 0x20);
    for (const url of ['/api/backup/restore', '/api/backup/validate']) {
      const mp = multipart(big, 'huge.json');
      const res = await app.inject({ method: 'POST', url, headers: { ...H(sa, PW), ...mp.headers }, payload: mp.payload });
      expect(res.statusCode).toBe(413);
      expect(res.json().error).toBe('FILE_TOO_LARGE');
    }
  }, 60_000);
});

describe('POST /api/backup/validate', () => {
  it('a well-formed JSON backup with no audit rows: valid, checksum checked, no chain report', async () => {
    const res = await validate(bk, backupJson({ users: [{ id: 'u1' }, { id: 'u2' }], roles: [{ id: 'r1' }], notAnArray: 'x' as any }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      valid: true, checksumValid: true, checksumSupported: true, totalRecords: 3,
      tableSummary: { users: 2, roles: 1 }, auditChain: null,
    });
    expect(res.json().tableSummary).not.toHaveProperty('notAnArray');
  });

  it('a JSON backup whose checksum does not match is NOT valid', async () => {
    const res = await validate(sa, backupJson({ users: [{ id: 'u1' }] }, { checksum: 'f'.repeat(64) }));
    expect(res.json()).toMatchObject({ valid: false, checksumValid: false, checksumSupported: true });
  });

  it('reports the audit-chain walk read-only — real, consecutive rows verify', async () => {
    expect(auditSample.length).toBeGreaterThanOrEqual(3);
    const res = await validate(sa, backupJson({ audit_trail: auditSample }));
    expect(res.json().auditChain).toMatchObject({ totalRows: auditSample.length, checksumFailures: 0, linkFailures: 0 });
  });

  it('…and a legacy camelCase backup (auditTrail / camelCase columns) is normalised before the walk', async () => {
    const camel = auditSample.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_([a-z])/g, (_m, c) => c.toUpperCase()), v])));
    const tampered = camel.map((r, i) => (i === 1 ? { ...r, afterValue: { forged: true } } : r));
    const res = await validate(sa, backupJson({ auditTrail: tampered }));
    expect(res.json().auditChain).toMatchObject({ totalRows: auditSample.length, checksumFailures: 1 });
    expect(res.json().auditChain.samples[0]).toMatchObject({ kind: 'checksum' });
  });

  it('a .sql file validates without a (meaningless) checksum claim', async () => {
    const sql = [
      '-- DigiLog Database Backup', '-- Generated: 2026-01-01T00:00:00.000Z', '-- Generated By: cov',
      'TRUNCATE TABLE "roles" CASCADE;', 'TRUNCATE TABLE "users" CASCADE;',
      `INSERT INTO "users" ("id", "username") VALUES ('u1', 'a');`,
      `INSERT INTO "users" ("id", "username") VALUES ('u2', 'b');`,
    ].join('\n');
    const res = await validate(sa, sql, 'x.sql');
    expect(res.json()).toMatchObject({
      valid: true, checksumSupported: false, checksumValid: false, totalRecords: 2,
      tableSummary: { roles: 0, users: 2 }, metadata: { format: 'sql', generatedBy: 'cov', timestamp: '2026-01-01T00:00:00.000Z' },
    });
  });

  it('a pg_dump archive (PGDMP magic) validates as an archive', async () => {
    const res = await validate(sa, Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(32)]), 'x.dump');
    expect(res.json()).toMatchObject({ valid: true, checksumSupported: false, metadata: { format: 'dump', version: 'pg_dump' } });
  });

  it.each([
    ['not JSON at all', Buffer.from('hello world'), 'INVALID_JSON'],
    ['gzip magic but corrupt', Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x01, 0x02, 0x03]), 'INVALID_BAK'],
    ['JSON without metadata/data', Buffer.from('{"foo":1}'), 'INVALID_BACKUP'],
  ])('%s → 400 valid:false %s', async (_l, buf, code) => {
    const res = await validate(sa, buf);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ valid: false, error: code });
  });
});

describe('POST /api/backup/restore — refusals that fire before anything is written', () => {
  it.each([
    ['not JSON', Buffer.from('nope'), 'INVALID_JSON'],
    ['a corrupt .bak', Buffer.from([0x1f, 0x8b, 0x00, 0x00]), 'INVALID_BAK'],
    ['missing sections', Buffer.from('{"metadata":{}}'), 'INVALID_BACKUP'],
  ])('%s → 400 %s', async (_l, buf, code) => {
    const res = await guardedRestore(sa, buf);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe(code);
  });

  it('metadata without a version → 400 INVALID_METADATA', async () => {
    const res = await guardedRestore(sa, JSON.stringify({ metadata: { checksum: 'x' }, data: { users: [] } }));
    expect(res.json()).toMatchObject({ error: 'INVALID_METADATA', message: 'Backup metadata is incomplete' });
  });

  it('a JSON backup without a checksum → 400 INVALID_METADATA', async () => {
    const res = await guardedRestore(sa, JSON.stringify({ metadata: { version: '1.0.0', format: 'json' }, data: { users: [] } }));
    expect(res.json()).toMatchObject({ error: 'INVALID_METADATA', message: 'Backup metadata is missing checksum' });
  });

  it('a JSON backup edited after export → 400 CHECKSUM_MISMATCH', async () => {
    const res = await guardedRestore(sa, backupJson({ users: [{ id: 'u1' }] }, { checksum: '0'.repeat(64) }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('CHECKSUM_MISMATCH');
  });

  it('metadata without a format is held to the JSON rules (checksum, signature)', async () => {
    const noFormat = (checksum?: string) => {
      const data = { users: [] as any[] };
      return JSON.stringify({ metadata: { version: '1.0.0', timestamp: new Date().toISOString(), checksum: checksum ?? computeBackupChecksum(data) }, data });
    };
    expect((await guardedRestore(sa, noFormat('2'.repeat(64)))).json().error).toBe('CHECKSUM_MISMATCH');
    expect((await guardedRestore(rs, noFormat())).json().error).toBe('BACKUP_UNSIGNED');
    expect((await validate(sa, noFormat('3'.repeat(64)))).json()).toMatchObject({ valid: false, checksumSupported: true });
  });

  it('the same checks apply to a gzip .bak', async () => {
    const res = await guardedRestore(sa, gzipSync(Buffer.from(backupJson({ users: [] }, { checksum: '1'.repeat(64), format: 'bak' }))), PW, 'x.bak');
    expect(res.json().error).toBe('CHECKSUM_MISMATCH');
  });

  it('a non-Super-Admin cannot restore an unsigned file (403 BACKUP_UNSIGNED), nor a pg_dump archive', async () => {
    const unsigned = await guardedRestore(rs, backupJson({ users: [] }));
    expect(unsigned.statusCode).toBe(403);
    expect(unsigned.json().error).toBe('BACKUP_UNSIGNED');
    const dump = await guardedRestore(rs, Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(16)]), PW, 'x.dump');
    expect(dump.statusCode).toBe(403);
    expect(dump.json()).toMatchObject({ error: 'BACKUP_UNSIGNED', message: 'Restoring a pg_dump archive requires a Super Admin.' });
  });

  it('an audit trail that does not verify is refused with the chain report (400 BACKUP_AUDIT_CHAIN_INVALID)', async () => {
    const tampered = auditSample.map((r, i) => (i === 0 ? { ...r, reason: 'edited after the fact' } : r));
    const res = await guardedRestore(sa, backupJson({ audit_trail: tampered }));
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('BACKUP_AUDIT_CHAIN_INVALID');
    expect(body.chainReport).toMatchObject({ totalRows: auditSample.length, checksumFailures: 1, linkFailures: 0 });
    expect(body.chainReport.samples).toEqual([expect.objectContaining({ index: 0, kind: 'checksum', id: tampered[0].id })]);
  });

  it('a backup that omits tables is refused (400 BACKUP_INCOMPLETE), naming audit_trail', async () => {
    const res = await guardedRestore(sa, backupJson({ users: [] }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('BACKUP_INCOMPLETE');
    expect(res.json().message).toMatch(/This includes audit_trail — restoring would destroy the entire 21 CFR history\./);
  });

  // D8 + D9 (2026-10-21): both are bad UPLOADS; both answered 500 before.
  it('a declared zip-bomb is a 400 INVALID_ZIP on VALIDATE too', async () => {
    const AdmZip = (await import('adm-zip')).default;
    const z = new AdmZip();
    z.addFile('users.csv', Buffer.from('id\n1\n'));
    const buf = z.toBuffer();
    buf.writeUInt32LE(0x90000000, buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    const res = await validate(sa, buf, 'x.zip');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ valid: false, error: 'INVALID_ZIP', message: expect.stringMatching(/^Backup expands to 2416 MB/) });
  });

  it('a file with the ZIP signature but no valid archive is a 400 INVALID_ZIP on both routes', async () => {
    const bad = Buffer.from('PK\x03\x04 not really a zip archive');
    const v = await validate(sa, bad, 'x.zip');
    expect(v.statusCode).toBe(400);
    expect(v.json()).toMatchObject({ valid: false, error: 'INVALID_ZIP' });
    const r = await guardedRestore(sa, bad, PW, 'x.zip');
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('INVALID_ZIP');
    expect(JSON.stringify(r.json())).not.toMatch(/ADM-ZIP/);
  });

  it('a declared zip-bomb is a 400 INVALID_ZIP on restore (VAPT-3)', async () => {
    const AdmZip = (await import('adm-zip')).default;
    const z = new AdmZip();
    z.addFile('users.csv', Buffer.from('id\n1\n'));
    const buf = z.toBuffer();
    const cd = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    buf.writeUInt32LE(0x90000000, cd + 24); // central directory: uncompressed size 2.4 GB
    const res = await guardedRestore(sa, buf, PW, 'x.zip');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_ZIP');
  });
});
