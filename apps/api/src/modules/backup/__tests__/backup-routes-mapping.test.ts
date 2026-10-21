/**
 * backup/routes.ts error → HTTP mapping, with the service mocked (coverage
 * campaign 2026-10-21). The pg_dump restore outcomes (RESTORE_FAILED /
 * RESTORE_FAILED_NO_ROLLBACK / PgToolError) are DESTRUCTIVE to produce for real,
 * so they are mapped here from fakes and never against a database. The routes
 * run on a bare Fastify with the real multipart plugin; permission and re-auth
 * gates are stubbed open (they are exercised for real in e2e/backup-routes).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const svc = vi.hoisted(() => ({
  exportDump: vi.fn(), exportSql: vi.fn(), exportCsv: vi.fn(), exportBak: vi.fn(), exportJson: vi.fn(),
  restore: vi.fn(), restoreDump: vi.fn(), validate: vi.fn(),
}));
vi.mock('../backup.service.js', () => svc);
vi.mock('../../../lib/reauth-check.js', () => ({ enforceReauth: vi.fn(async () => ({ ok: true })) }));

import backupRoutes from '../routes.js';
import { PgToolError } from '../pg-tools.js';
import { BackupTooLargeError } from '../backup.repository.js';
import { multipart as body } from './cov-backup-helpers.js';

let app: FastifyInstance;
const PGDMP = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(16)]);
const post = (url: string, file: Buffer | string, before: Record<string, string> = {}) => {
  const mp = body(file, 'f.bin', before);
  return app.inject({ method: 'POST', url, headers: mp.headers, payload: mp.payload });
};

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
  app.decorate('requirePermission', () => async () => {});
  app.decorate('requireAnyPermission', () => async () => {});
  app.decorateRequest('user', null as any);
  app.addHook('onRequest', async (req) => { (req as any).user = { username: 'cov', role: 'SUPER_ADMIN', sub: 's', sessionId: 't' }; });
  await app.register(backupRoutes, { prefix: '/api/backup' });
  await app.ready();
});
afterAll(async () => { await app.close(); });
beforeEach(() => { for (const f of Object.values(svc)) f.mockReset(); });

describe('GET /export', () => {
  it('format=dump (the default) streams the archive from disk and cleans up once the response closes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cov-route-dump-'));
    const filePath = join(dir, 'digilog_backup_x.dump');
    await writeFile(filePath, Buffer.from('PGDMP-stream-content'));
    const cleanup = vi.fn(() => rm(dir, { recursive: true, force: true }));
    svc.exportDump.mockResolvedValue({ filePath, filename: 'digilog_backup_x.dump', cleanup });
    const res = await app.inject({ method: 'GET', url: '/api/backup/export' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe('attachment; filename="digilog_backup_x.dump"');
    expect(res.body).toBe('PGDMP-stream-content');
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalled());
    expect(svc.exportDump).toHaveBeenCalledWith('cov', expect.objectContaining({ userId: 'cov', userRole: 'SUPER_ADMIN' }));
  });

  it('a stream error still cleans up', async () => {
    const cleanup = vi.fn(async () => {});
    svc.exportDump.mockResolvedValue({ filePath: join(tmpdir(), `cov-missing-${Date.now()}.dump`), filename: 'x.dump', cleanup });
    const res = await app.inject({ method: 'GET', url: '/api/backup/export?format=dump' });
    expect(res.statusCode).toBe(500);
    await vi.waitFor(() => expect(cleanup).toHaveBeenCalled());
  });

  it.each([
    ['sql', 'exportSql', { sqlContent: '-- sql', filename: 'b.sql' }, 'application/sql', '-- sql'],
    ['csv', 'exportCsv', { zipBuffer: Buffer.from('PKzip'), filename: 'b.zip' }, 'application/zip', 'PKzip'],
    ['bak', 'exportBak', { compressed: Buffer.from('gz'), filename: 'b.bak' }, 'application/octet-stream', 'gz'],
    ['json', 'exportJson', { backup: { metadata: { v: 1 }, data: {} }, filename: 'b.json' }, 'application/json', JSON.stringify({ metadata: { v: 1 }, data: {} }, null, 2)],
  ])('format=%s sends the service output with its content type and filename', async (format, fn, out, type, payload) => {
    (svc as any)[fn].mockResolvedValue(out);
    const res = await app.inject({ method: 'GET', url: `/api/backup/export?format=${format}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(new RegExp(`^${type}`));
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${(out as any).filename}"`);
    expect(res.body).toBe(payload);
  });

  it('maps BackupTooLargeError → 413 with the table detail, PgToolError → 503, anything else → 500', async () => {
    svc.exportJson.mockRejectedValueOnce(new BackupTooLargeError('audit_trail', 600_000, 500_000));
    const big = await app.inject({ method: 'GET', url: '/api/backup/export?format=json' });
    expect(big.statusCode).toBe(413);
    expect(big.json()).toMatchObject({ error: 'BACKUP_TOO_LARGE', table: 'audit_trail', rowCount: 600_000, limit: 500_000 });

    svc.exportDump.mockRejectedValueOnce(new PgToolError('PG_TOOL_VERSION', 'pg_dump is version 16 but the database server is version 18.', null, ''));
    const tool = await app.inject({ method: 'GET', url: '/api/backup/export' });
    expect(tool.statusCode).toBe(503);
    expect(tool.json()).toEqual({ error: 'PG_TOOL_VERSION', message: 'pg_dump is version 16 but the database server is version 18.' });

    svc.exportCsv.mockRejectedValueOnce(new Error('disk full'));
    expect((await app.inject({ method: 'GET', url: '/api/backup/export?format=csv' })).statusCode).toBe(500);
  });
});

describe('POST /restore', () => {
  it('routes a PGDMP upload to the pg_restore path by CONTENT, whatever the filename', async () => {
    svc.restoreDump.mockResolvedValue({ success: true, message: 'ok', backupTimestamp: '2026-01-01T00:00:00.000Z', backupVersion: 'pg_dump' });
    const res = await post('/api/backup/restore', PGDMP);
    expect(res.statusCode).toBe(200);
    expect(svc.restoreDump).toHaveBeenCalledWith(PGDMP, expect.objectContaining({ userId: 'cov' }));
    expect(svc.restore).not.toHaveBeenCalled();
  });

  it.each([
    ['RESTORE_FAILED (rolled back)', Object.assign(new Error('bad archive The database was rolled back to its pre-restore state.'), { code: 'RESTORE_FAILED' }), 400],
    ['RESTORE_FAILED_NO_ROLLBACK', Object.assign(new Error('bad archive CRITICAL: the rollback ALSO failed'), { code: 'RESTORE_FAILED_NO_ROLLBACK' }), 500],
  ])('%s keeps its code and gets status %i — the two are never collapsed', async (_l, err, status) => {
    svc.restoreDump.mockRejectedValue(err);
    const res = await post('/api/backup/restore', PGDMP);
    expect(res.statusCode).toBe(status);
    expect(res.json()).toEqual({ error: (err as any).code, message: err.message });
  });

  it('a pg tool that cannot run → 503 with its code', async () => {
    svc.restoreDump.mockRejectedValue(new PgToolError('PG_TOOL_NOT_FOUND', 'pg_dump.exe was not found.', null, ''));
    const res = await post('/api/backup/restore', PGDMP);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'PG_TOOL_NOT_FOUND', message: 'pg_dump.exe was not found.' });
  });

  it('force reaches the service only when sent as "true" — before or after the file, or as a JSON true', async () => {
    svc.restore.mockResolvedValue({ success: true, message: 'ok', backupTimestamp: '2026-01-01T00:00:00.000Z', backupVersion: '1.0.0' });
    await post('/api/backup/restore', '{}', { force: 'true' });
    expect(svc.restore.mock.calls.at(-1)![2]).toEqual({ force: true });
    await post('/api/backup/restore', '{}', { force: 'yes' });
    expect(svc.restore.mock.calls.at(-1)![2]).toEqual({ force: false });
    await post('/api/backup/restore', '{}');
    expect(svc.restore.mock.calls.at(-1)![2]).toEqual({ force: false });
    const after = body('{}', 'f.json', {}, { force: 'true' });
    await app.inject({ method: 'POST', url: '/api/backup/restore', headers: after.headers, payload: after.payload });
    expect(svc.restore.mock.calls.at(-1)![2]).toEqual({ force: true });
    // a JSON-typed field arrives parsed as the boolean true
    const boundary = 'covjsonforce';
    const payload = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="force"\r\nContent-Type: application/json\r\n\r\ntrue\r\n`
      + `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="f.json"\r\nContent-Type: application/octet-stream\r\n\r\n{}\r\n--${boundary}--\r\n`,
    );
    await app.inject({ method: 'POST', url: '/api/backup/restore', headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
    expect(svc.restore.mock.calls.at(-1)![2]).toEqual({ force: true });
  });

  it('a chain refusal carries its report (or null when the error has none)', async () => {
    svc.restore.mockRejectedValueOnce({ statusCode: 400, message: 'BACKUP_AUDIT_CHAIN_INVALID: 2 chain link(s) are broken', chainReport: { linkFailures: 2 } });
    const withReport = await post('/api/backup/restore', '{}');
    expect(withReport.json()).toEqual({ error: 'BACKUP_AUDIT_CHAIN_INVALID', message: 'BACKUP_AUDIT_CHAIN_INVALID: 2 chain link(s) are broken', chainReport: { linkFailures: 2 } });
    svc.restore.mockRejectedValueOnce({ statusCode: 400, message: 'BACKUP_AUDIT_CHAIN_INVALID: x' });
    expect((await post('/api/backup/restore', '{}')).json().chainReport).toBeNull();
  });

  it('any other 4xx keeps its status; a missing code/message gets a neutral default', async () => {
    svc.restore.mockRejectedValueOnce(Object.assign(new Error(''), { statusCode: 422 }));
    const res = await post('/api/backup/restore', '{}');
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'BAD_REQUEST', message: 'Invalid restore request.' });
  });

  it('an unexpected failure is a 500 RESTORE_FAILED whose body never echoes the internal error', async () => {
    // CLAUDE.md strict audit: only AppError messages may reach a client. A Prisma
    // message embeds the source path and the failing SQL.
    svc.restore.mockRejectedValueOnce(new Error('\nInvalid `prisma.$executeRawUnsafe()` invocation in C:/app/src/x.ts:12\nRaw query failed. Code: `22P02`.'));
    const res = await post('/api/backup/restore', '{}');
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'RESTORE_FAILED', message: 'Database restore failed. The details are in the server log.' });
    svc.restore.mockRejectedValueOnce(new Error(''));
    expect((await post('/api/backup/restore', '{}')).json().message).toBe('Database restore failed. The details are in the server log.');
  });
});

describe('POST /validate', () => {
  // D8 (2026-10-21): the zip-bomb guard's INVALID_ZIP was mapped on /restore only.
  it.each(['INVALID_ZIP', 'INVALID_BAK', 'INVALID_JSON', 'INVALID_BACKUP'])('%s is a 400 with valid:false', async (code) => {
    svc.validate.mockRejectedValueOnce(Object.assign(new Error(`bad file (${code})`), { code }));
    const res = await post('/api/backup/validate', '{}');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ valid: false, error: code, message: `bad file (${code})` });
  });

  it('passes the parsed result through', async () => {
    svc.validate.mockResolvedValue({ valid: true, metadata: {}, tableSummary: {}, checksumValid: true, checksumSupported: true, totalRecords: 0, auditChain: null });
    const res = await post('/api/backup/validate', '{}');
    expect(res.json()).toMatchObject({ valid: true, auditChain: null });
  });

  it('an unexpected server-side failure while validating is a 500, not a "bad file"', async () => {
    svc.validate.mockRejectedValue(new Error('connection terminated'));
    expect((await post('/api/backup/validate', '{}')).statusCode).toBe(500);
  });
});
