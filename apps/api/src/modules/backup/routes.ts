import { type FastifyInstance } from 'fastify';
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
      description: 'Generates a backup of all database tables. Formats: **json** (full, restorable), **bak** (gzip-compressed JSON, ~7x smaller), **sql** (PostgreSQL INSERT statements), **csv** (ZIP of per-table CSVs). JSON and BAK include SHA-256 checksum for integrity verification.',
      querystring: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['json', 'sql', 'csv', 'bak'], default: 'json' },
        },
      },
    },
  }, async (req, reply) => {
    const { ok } = await enforceReauth('EXPORT_BACKUP', req, reply);
    if (!ok) return;

    const ctx = buildContext(req);
    const { format = 'json' } = req.query as { format?: string };

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

    // JSON format (default)
    const { backup, filename } = await backupService.exportJson(req.user.username, ctx);
    reply.header('Content-Type', 'application/json');
    reply.header('Content-Disposition', `attachment; filename="${filename}"`);
    return reply.send(JSON.stringify(backup, null, 2));
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
      description: 'Upload a JSON or BAK backup file to restore the database. Validates checksum before restoring. Temporarily disables audit trail immutability triggers during restore.',
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

      const ctx = buildContext(req);
      // Audit 2026-05-04 fix #7: optional `force` field on the multipart
      // form bypasses the audit-chain integrity check. Audited as
      // forced=true on the BACKUP_RESTORED row for the regulator trail.
      // Default false — refuse tampered backups silently overwriting
      // history.
      const forceField = (file.fields as any)?.force;
      const force = forceField?.value === 'true' || forceField?.value === true;
      const result = await backupService.restore(rawBuffer, ctx, { force });
      return result;
    } catch (err: any) {
      // Structured errors from the service carry a code property
      if (err.code && ['INVALID_BAK', 'INVALID_JSON', 'INVALID_BACKUP', 'INVALID_METADATA', 'CHECKSUM_MISMATCH'].includes(err.code)) {
        return reply.code(400).send({ error: err.code, message: err.message });
      }
      // Audit 2026-05-04 fix #7: structured chain-integrity refusal
      // surfaces as 400 with the BACKUP_AUDIT_CHAIN_INVALID code so the
      // operator UI can show "tampered backup, pass force to override".
      if (err.statusCode === 400 && typeof err.message === 'string' && err.message.startsWith('BACKUP_AUDIT_CHAIN_INVALID')) {
        return reply.code(400).send({ error: 'BACKUP_AUDIT_CHAIN_INVALID', message: err.message });
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
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
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
            totalRecords: { type: 'number' },
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
