import { type FastifyInstance } from 'fastify';
import { enforceReauth } from '../../lib/reauth-check.js';
import { errorResponses } from '../../lib/error-schemas.js';
import { buildContext } from '../../lib/build-context.js';
import * as backupService from './backup.service.js';

export default async function backupRoutes(app: FastifyInstance) {

  // GET /api/backup/export — Generate and download backup
  app.get('/export', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
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

  // POST /api/backup/restore — Restore from backup file
  app.post('/restore', {
    preHandler: [app.requirePermission('CONFIG_UPDATE')],
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
      const result = await backupService.restore(rawBuffer, ctx);
      return result;
    } catch (err: any) {
      // Structured errors from the service carry a code property
      if (err.code && ['INVALID_BAK', 'INVALID_JSON', 'INVALID_BACKUP', 'INVALID_METADATA', 'CHECKSUM_MISMATCH'].includes(err.code)) {
        return reply.code(400).send({ error: err.code, message: err.message });
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
