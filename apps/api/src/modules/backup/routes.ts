import { type FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { enforceReauth } from '../../lib/reauth-check.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { buildContext } from '../../lib/build-context.js';
import * as backupService from './backup.service.js';

export default async function backupRoutes(app: FastifyInstance) {

  // GET /api/backup/export — Generate and download backup.
  // Permission gate (2026-05-14): BACKUP_EXPORT is implicitly granted to
  // any role that holds BACKUP_MANAGE via the suffix-expansion map in
  // packages/shared/src/types/permissions.ts (`_EXPORT` ∈ MANAGE_PERMISSION_SUFFIXES).
  // SUPER_ADMIN and ADMIN have BACKUP_MANAGE seeded, so behavior is
  // unchanged for them. Pre-fix this checked CONFIG_UPDATE — a role with
  // generic config edit but no backup-specific scope still passed the gate.
  app.get('/export', {
    preHandler: [app.requirePermission('BACKUP_EXPORT')],
    schema: {
      tags: ['Backup'],
      summary: 'Export database backup',
      description: 'Generates a backup of the database. Formats: **dump** (pg_dump custom archive — full SCHEMA + data, the only true full backup and the only format pgAdmin\'s Restore dialog accepts), **json** (data-only, restorable in-app), **bak** (gzip-compressed JSON, ~7x smaller), **sql** (data-only PostgreSQL script, replayable with `psql -v ON_ERROR_STOP=1 -f`), **csv** (ZIP of per-table CSVs, export only). JSON and BAK include a SHA-256 checksum.',
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['dump', 'json', 'sql', 'csv', 'bak'], default: 'dump' },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('EXPORT_BACKUP', req, reply);
    if (!ok) return;

    const ctx = buildContext(req);
    const { format = 'dump' } = req.query as { format?: string };

    // BackupTooLargeError is thrown by fetchAllTablesRaw when any table
    // exceeds BACKUP_MAX_ROWS_PER_TABLE — closes the silent OOM mode of
    // May 16 §1.9 / delta-audit C6 until the streaming refactor lands.
    // (The `dump` path streams through pg_dump and is not subject to it.)
    try {
      if (format === 'dump') {
        const { filePath, filename, cleanup } = await backupService.exportDump(req.user.username, ctx);
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        // Stream from disk — a full dump can be far larger than the JSON
        // exports and must not be buffered into the API's heap. The temp dir is
        // removed once the response has finished either way.
        const stream = createReadStream(filePath);
        stream.on('close', () => { void cleanup(); });
        stream.on('error', () => { void cleanup(); });
        return reply.send(stream);
      }
      if (format === 'sql') {
        const { sqlContent, filename } = await backupService.exportSql(req.user.username, ctx);
        reply.header('Content-Type', 'application/sql');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return reply.send(sqlContent);
      }
      if (format === 'csv') {
        const { zipBuffer, filename } = await backupService.exportCsv(req.user.username, ctx);
        reply.header('Content-Type', 'application/zip');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return reply.send(zipBuffer);
      }
      if (format === 'bak') {
        const { compressed, filename } = await backupService.exportBak(req.user.username, ctx);
        reply.header('Content-Type', 'application/octet-stream');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return reply.send(compressed);
      }
      const { backup, filename } = await backupService.exportJson(req.user.username, ctx);
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(JSON.stringify(backup, null, 2));
    } catch (err: any) {
      if (err?.name === 'BackupTooLargeError') {
        return reply.code(413).send({
          error: 'BACKUP_TOO_LARGE',
          message: err.message,
          table: err.table,
          rowCount: err.rowCount,
          limit: err.limit,
        });
      }
      // pg_dump missing / too old / failed — actionable, not a 500.
      if (err?.name === 'PgToolError') {
        return reply.code(503).send({ error: err.code, message: err.message });
      }
      throw err;
    }
  });

  // POST /api/backup/restore — Restore from backup file.
  // Permission gate (2026-05-14): BACKUP_RESTORE is an EXPLICIT permission —
  // it is INTENTIONALLY NOT implied by BACKUP_MANAGE (`_RESTORE` is not in
  // MANAGE_PERMISSION_SUFFIXES). Restoring overwrites history and is a
  // higher-risk grant than export; roles must be granted it directly.
  // SUPER_ADMIN and ADMIN have it seeded. Pre-fix this checked CONFIG_UPDATE
  // and a generic config-edit role could overwrite the database.
  app.post('/restore', {
    preHandler: [app.requirePermission('BACKUP_RESTORE')],
    schema: {
      tags: ['Backup'],
      summary: 'Restore database from backup',
      description: 'Upload a JSON or BAK backup file to restore the database. Validates checksum and audit-chain integrity before restoring; a chain anomaly returns 400 BACKUP_AUDIT_CHAIN_INVALID with a `chainReport` summary, which the operator can override by sending `force=true` (recorded as forced=true on the BACKUP_RESTORED audit row). Temporarily disables audit trail immutability triggers during restore.',
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            backupTimestamp: { type: 'string', format: 'date-time' },
            backupVersion: { type: 'string' },
          },
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('RESTORE_BACKUP', req, reply);
    if (!ok) return;

    try {
      const file = await req.file({ limits: { fileSize: 100 * 1024 * 1024 } });
      if (!file) {
        return reply.code(400).send({ error: 'NO_FILE', message: 'No backup file uploaded' });
      }

      const chunks: Buffer[] = [];
      for await (const chunk of file.file) {
        chunks.push(chunk);
      }
      const rawBuffer = Buffer.concat(chunks);

      // A file over the 100 MB limit is TRUNCATED, not rejected — the stream
      // just ends early and `truncated` is set once it does. Unchecked, that is
      // silent destruction: parseSqlBackup deliberately `break`s at a malformed
      // tail and returns a valid-looking partial BackupData, whose audit_trail
      // prefix is chain-consistent and so passes verifyBackupAuditChain. Restore
      // then truncates every table and reinserts only the pre-cut rows — HTTP
      // 200, most of the database gone. Mirrors the bulk-upload guard added
      // 2026-07-04 (assets/routes/instance.routes.ts).
      if ((file.file as any).truncated) {
        return reply.code(413).send({
          error: 'FILE_TOO_LARGE',
          message: 'Backup file exceeds the 100 MB upload limit and was truncated. Restoring it would silently discard every row past the cut.',
        });
      }

      const ctx = buildContext(req);
      // Audit 2026-05-04 fix #7: optional `force` field on the multipart
      // form bypasses the audit-chain integrity check. Audited as
      // forced=true on the BACKUP_RESTORED row for the regulator trail.
      // Default false — refuse tampered backups silently overwriting
      // history.
      const forceField = (file.fields as any)?.force;
      const force = forceField?.value === 'true' || forceField?.value === true;

      // A pg_dump custom archive starts with the magic string "PGDMP". It is a
      // physical schema+data restore and goes through pg_restore, not through
      // the row-level JSON path (which cannot recreate schema, sequences or
      // triggers). Detected by content rather than filename so a renamed file
      // still routes correctly.
      if (rawBuffer.subarray(0, 5).toString('latin1') === 'PGDMP') {
        return await backupService.restoreDump(rawBuffer, ctx);
      }

      const result = await backupService.restore(rawBuffer, ctx, { force });
      return result;
    } catch (err: any) {
      // Structured errors from the service carry a code property. These are all
      // "the uploaded file is bad" — a client error, not a server fault. INVALID_ZIP
      // is the declared-size zip-bomb guard (VAPT-3, 2026-08-18): before this it fell
      // through to the catch-all 500 below, which misreported an attacker-supplied
      // file as a server error and buried it among genuine 500s in monitoring.
      if (err.code && ['INVALID_ZIP', 'INVALID_BAK', 'INVALID_JSON', 'INVALID_BACKUP', 'INVALID_METADATA', 'CHECKSUM_MISMATCH'].includes(err.code)) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      // pg_restore path. RESTORE_FAILED means the database was rolled back to
      // its pre-restore state; RESTORE_FAILED_NO_ROLLBACK means it was NOT and
      // the operator must act on the preserved safety dump — never collapse
      // those two into one message.
      if (err.code === 'RESTORE_FAILED' || err.code === 'RESTORE_FAILED_NO_ROLLBACK') {
        return reply.code(err.code === 'RESTORE_FAILED' ? 400 : 500)
          .send({ error: err.code, message: err.message });
      }
      if (err?.name === 'PgToolError') {
        return reply.code(503).send({ error: err.code, message: err.message });
      }
      // Audit 2026-05-04 fix #7: structured chain-integrity refusal
      // surfaces as 400 with the BACKUP_AUDIT_CHAIN_INVALID code so the
      // operator UI can show "tampered backup, pass force to override".
      // Audit 2026-05-04 fix #7: structured chain-integrity refusal surfaces as
      // 400 with the BACKUP_AUDIT_CHAIN_INVALID code. The report rides along so
      // the operator UI can show WHAT failed and HOW MUCH before offering the
      // audited override — a bare "row 0 is bad" gives them nothing to judge.
      if (err.statusCode === 400 && typeof err.message === 'string' && err.message.startsWith('BACKUP_AUDIT_CHAIN_INVALID')) {
        return reply.code(400).send({
          error: 'BACKUP_AUDIT_CHAIN_INVALID',
          message: err.message,
          chainReport: err.chainReport ?? null,
        });
      }
      // A request-shaped error must keep its own status (2026-09-04 audit). This
      // catch-all stamped EVERY unmatched error as `500 RESTORE_FAILED` —
      // including Fastify's own FST_INVALID_MULTIPART_CONTENT_TYPE, which carries
      // statusCode 406 — so a client that simply forgot the multipart body was
      // told "Database restore failed", and the 500 landed in error monitoring
      // beside genuine restore failures. Same class as the INVALID_ZIP note above.
      if (typeof err?.statusCode === 'number' && err.statusCode >= 400 && err.statusCode < 500) {
        return reply.code(err.statusCode).send({
          error: err.code ?? 'BAD_REQUEST',
          message: err.message || 'Invalid restore request.',
        });
      }
      app.log.error(err);
      return reply.code(500).send({
        error: 'RESTORE_FAILED',
        message: err.message || 'Database restore failed.',
      });
    }
  });

  // POST /api/backup/validate — Validate a backup file without restoring
  app.post('/validate', {
    // Validate is a read-only dry-run over an uploaded backup, so it belongs to
    // the BACKUP_* family like its siblings above — not CONFIG_UPDATE, which the
    // 2026-05-14 pass left behind. That mismatch broke in both directions: a
    // CONFIG_UPDATE holder with no backup rights could parse an uploaded backup,
    // and a BACKUP_RESTORE holder without CONFIG_UPDATE got a 403 on the
    // validate step the restore page calls before restoring.
    preHandler: [app.requireAnyPermission('BACKUP_EXPORT', 'BACKUP_RESTORE')],
    schema: {
      tags: ['Backup'],
      summary: 'Validate backup file',
      description: 'Upload a JSON or BAK backup file to validate its structure and checksum without performing a restore.',
      consumes: ['multipart/form-data'],
      response: {
        200: {
          type: 'object',
          properties: {
            valid: { type: 'boolean' },
            metadata: { type: 'object', additionalProperties: true },
            tableSummary: { type: 'object', additionalProperties: { type: 'number' } },
            checksumValid: { type: 'boolean' },
            checksumSupported: { type: 'boolean' },
            totalRecords: { type: 'number' },
            // Audit-chain integrity of the backup's audit_trail rows, reported
            // here (read-only) so the operator sees anomalies BEFORE restoring.
            // null when the backup carries no audit rows.
            auditChain: {
              type: ['object', 'null'],
              additionalProperties: true,
              properties: {
                totalRows: { type: 'number' },
                preChainRows: { type: 'number' },
                chainedRows: { type: 'number' },
                checksumFailures: { type: 'number' },
                linkFailures: { type: 'number' },
              },
            },
          },
          additionalProperties: true,
        },
        ...errorResponses,
      },
    },
  }, async (req, reply) => {
    const file = await req.file({ limits: { fileSize: 100 * 1024 * 1024 } });
    if (!file) {
      return reply.code(400).send({ error: 'NO_FILE', message: 'No backup file uploaded' });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const rawBuffer = Buffer.concat(chunks);

    // See the restore handler above. Validating a truncated file is worse than
    // useless: it reports the surviving prefix as a valid backup, which is
    // exactly the reassurance an operator relies on before restoring it.
    if ((file.file as any).truncated) {
      return reply.code(413).send({
        error: 'FILE_TOO_LARGE',
        message: 'Backup file exceeds the 100 MB upload limit and was truncated; it cannot be validated.',
      });
    }

    try {
      const result = await backupService.validate(rawBuffer);
      return result;
    } catch (err: any) {
      if (err.code && ['INVALID_BAK', 'INVALID_JSON', 'INVALID_BACKUP'].includes(err.code)) {
        return reply.code(400).send({ valid: false, error: err.code, message: err.message });
      }
      throw err;
    }
  });
}
