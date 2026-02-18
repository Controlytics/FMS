import { type FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';
import { enforceReauth } from '../../lib/reauth-check.js';
import { errorResponses } from '../../lib/error-schemas.js';

interface BackupData {
  metadata: {
    version: string;
    timestamp: string;
    generatedBy: string;
    tableCount: number;
    checksum: string;
    format?: string;
  };
  data: Record<string, any[]>;
}

// PostgreSQL table names (from @@map in schema.prisma)
const DB_TABLES = [
  'roles', 'users', 'system_config', 'audit_trail',
  'notifications', 'password_history', 'sessions', 'field_id_config',
  'user_configs', 'role_configs', 'password_reset_requests',
] as const;

// Map Prisma model keys to actual DB table names
const PRISMA_TO_DB: Record<string, string> = {
  users: 'users',
  roles: 'roles',
  systemConfig: 'system_config',
  auditTrail: 'audit_trail',
  notifications: 'notifications',
  passwordHistory: 'password_history',
  sessions: 'sessions',
  fieldIdConfig: 'field_id_config',
  userConfigs: 'user_configs',
  roleConfigs: 'role_configs',
  passwordResetRequests: 'password_reset_requests',
};

function computeBackupChecksum(data: Record<string, any[]>): string {
  // Sort top-level keys for deterministic ordering, then stringify fully
  const sorted: Record<string, any[]> = {};
  for (const key of Object.keys(data).sort()) {
    sorted[key] = data[key];
  }
  const payload = JSON.stringify(sorted);
  return createHash('sha256').update(payload).digest('hex');
}

// Escape a value for PostgreSQL INSERT statement
function escapeSqlValue(value: any): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  // String - escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}

// Escape a value for CSV
function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Generate SQL INSERT statements for a table
function generateSqlInserts(tableName: string, rows: Record<string, any>[]): string {
  if (rows.length === 0) return `-- Table: ${tableName} (0 rows)\n`;

  const columns = Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push(`-- Table: ${tableName} (${rows.length} rows)`);
  lines.push(`TRUNCATE TABLE "${tableName}" CASCADE;`);

  for (const row of rows) {
    const values = columns.map(col => escapeSqlValue(row[col]));
    lines.push(`INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`);
  }
  lines.push('');
  return lines.join('\n');
}

// Generate CSV content for a table
function generateCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push(columns.join(','));
  for (const row of rows) {
    lines.push(columns.map(col => escapeCsvValue(row[col])).join(','));
  }
  return lines.join('\n');
}

async function fetchAllTablesRaw(): Promise<Record<string, Record<string, any>[]>> {
  const result: Record<string, Record<string, any>[]> = {};
  for (const table of DB_TABLES) {
    const orderClause = table === 'audit_trail' ? ' ORDER BY id ASC' : '';
    const rows = await prisma.$queryRawUnsafe<Record<string, any>[]>(`SELECT * FROM "${table}"${orderClause}`);
    result[table] = rows;
  }
  return result;
}

async function fetchAllTablesPrisma() {
  const [
    users, roles, systemConfig, auditTrail,
    notifications, passwordHistory, sessions, fieldIdConfig,
    userConfigs, roleConfigs, passwordResetRequests,
  ] = await Promise.all([
    prisma.user.findMany(),
    prisma.role.findMany(),
    prisma.systemConfig.findMany(),
    prisma.auditTrail.findMany({ orderBy: { id: 'asc' } }),
    prisma.notification.findMany(),
    prisma.passwordHistory.findMany(),
    prisma.session.findMany(),
    prisma.fieldIdConfig.findMany(),
    prisma.userConfig.findMany(),
    prisma.roleConfig.findMany(),
    prisma.passwordResetRequest.findMany(),
  ]);

  return {
    users, roles, systemConfig, auditTrail,
    notifications, passwordHistory, sessions, fieldIdConfig,
    userConfigs, roleConfigs, passwordResetRequests,
  } as Record<string, any[]>;
}

export default async function backupRoutes(app: FastifyInstance) {

  // GET /api/backup/export — Generate and download backup
  app.get('/export', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
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

    const { format = 'json' } = req.query as { format?: string };
    const dateStr = new Date().toISOString()
      .replace(/T/, '_')
      .replace(/:/g, '-')
      .replace(/\..+/, '');

    if (format === 'sql') {
      // SQL format — raw queries to get actual DB column names
      const rawData = await fetchAllTablesRaw();
      const totalRecords = Object.values(rawData).reduce((sum, arr) => sum + arr.length, 0);

      const sqlParts: string[] = [];
      sqlParts.push('-- DigiLog Database Backup');
      sqlParts.push(`-- Generated: ${new Date().toISOString()}`);
      sqlParts.push(`-- Generated By: ${req.user.username}`);
      sqlParts.push(`-- Total Records: ${totalRecords}`);
      sqlParts.push(`-- Format: PostgreSQL SQL`);
      sqlParts.push('');
      sqlParts.push('BEGIN;');
      sqlParts.push('');

      // FK-safe order: delete children first, insert parents first
      const deleteOrder = [...DB_TABLES].reverse();
      for (const table of deleteOrder) {
        sqlParts.push(`TRUNCATE TABLE "${table}" CASCADE;`);
      }
      sqlParts.push('');

      for (const table of DB_TABLES) {
        const rows = rawData[table];
        if (rows.length === 0) {
          sqlParts.push(`-- Table: ${table} (0 rows)`);
          sqlParts.push('');
          continue;
        }
        const columns = Object.keys(rows[0]);
        sqlParts.push(`-- Table: ${table} (${rows.length} rows)`);
        for (const row of rows) {
          const values = columns.map(col => escapeSqlValue(row[col]));
          sqlParts.push(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`);
        }
        sqlParts.push('');
      }

      // Reset audit_trail sequence
      sqlParts.push(`-- Reset auto-increment sequence`);
      sqlParts.push(`SELECT setval(pg_get_serial_sequence('audit_trail', 'id'), COALESCE((SELECT MAX(id) FROM audit_trail), 0) + 1, false);`);
      sqlParts.push('');
      sqlParts.push('COMMIT;');

      await app.auditLog({
        userId: req.user.username,
        userRole: req.user.role,
        action: 'BACKUP_CREATED',
        targetType: 'system',
        targetId: 'database_backup',
        afterValue: { format: 'sql', timestamp: new Date().toISOString(), totalRecords },
        signatureMeaning: 'SQL database backup created by administrator',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });

      const filename = `digilog_backup_${dateStr}.sql`;
      reply.header('Content-Type', 'application/sql');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(sqlParts.join('\n'));

    } else if (format === 'csv') {
      // CSV format — ZIP of individual CSV files per table
      const rawData = await fetchAllTablesRaw();
      const totalRecords = Object.values(rawData).reduce((sum, arr) => sum + arr.length, 0);

      const zip = new AdmZip();

      for (const table of DB_TABLES) {
        const rows = rawData[table];
        const csvContent = generateCsv(rows);
        zip.addFile(`${table}.csv`, Buffer.from(csvContent, 'utf-8'));
      }

      // Add a metadata file
      const metaContent = JSON.stringify({
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        generatedBy: req.user.username,
        format: 'csv',
        tableCount: DB_TABLES.length,
        totalRecords,
        tables: Object.fromEntries(DB_TABLES.map(t => [t, rawData[t].length])),
      }, null, 2);
      zip.addFile('_metadata.json', Buffer.from(metaContent, 'utf-8'));

      await app.auditLog({
        userId: req.user.username,
        userRole: req.user.role,
        action: 'BACKUP_CREATED',
        targetType: 'system',
        targetId: 'database_backup',
        afterValue: { format: 'csv', timestamp: new Date().toISOString(), totalRecords },
        signatureMeaning: 'CSV database backup created by administrator',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });

      const filename = `digilog_backup_${dateStr}.zip`;
      const zipBuffer = zip.toBuffer();
      reply.header('Content-Type', 'application/zip');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(zipBuffer);

    } else if (format === 'bak') {
      // BAK format — gzip-compressed JSON with checksum (compact, restorable)
      const data = await fetchAllTablesPrisma();

      const checksum = computeBackupChecksum(data);
      const timestamp = new Date().toISOString();

      const backup: BackupData = {
        metadata: {
          version: '1.0.0',
          timestamp,
          generatedBy: req.user.username,
          tableCount: Object.keys(data).length,
          checksum,
          format: 'bak',
        },
        data,
      };

      const jsonStr = JSON.stringify(backup);
      const compressed = gzipSync(Buffer.from(jsonStr, 'utf-8'), { level: 9 });

      await app.auditLog({
        userId: req.user.username,
        userRole: req.user.role,
        action: 'BACKUP_CREATED',
        targetType: 'system',
        targetId: 'database_backup',
        afterValue: {
          format: 'bak',
          timestamp,
          checksum,
          tableCount: Object.keys(data).length,
          totalRecords: Object.values(data).reduce((sum, arr) => sum + arr.length, 0),
          compressedSize: compressed.length,
          originalSize: jsonStr.length,
        },
        signatureMeaning: 'Compressed database backup created by administrator',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });

      const filename = `digilog_backup_${dateStr}.bak`;
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(compressed);

    } else {
      // JSON format (default) — Prisma-based for restore compatibility
      const data = await fetchAllTablesPrisma();

      const checksum = computeBackupChecksum(data);
      const timestamp = new Date().toISOString();

      const backup: BackupData = {
        metadata: {
          version: '1.0.0',
          timestamp,
          generatedBy: req.user.username,
          tableCount: Object.keys(data).length,
          checksum,
          format: 'json',
        },
        data,
      };

      await app.auditLog({
        userId: req.user.username,
        userRole: req.user.role,
        action: 'BACKUP_CREATED',
        targetType: 'system',
        targetId: 'database_backup',
        afterValue: {
          format: 'json',
          timestamp,
          checksum,
          tableCount: Object.keys(data).length,
          totalRecords: Object.values(data).reduce((sum, arr) => sum + arr.length, 0),
        },
        signatureMeaning: 'Full database backup created by administrator',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });

      const filename = `digilog_backup_${dateStr}.json`;
      reply.header('Content-Type', 'application/json');
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      return reply.send(JSON.stringify(backup, null, 2));
    }
  });

  // POST /api/backup/restore — Restore from backup file
  app.post('/restore', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
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

      // Detect gzip (.bak) — gzip magic bytes: 0x1f 0x8b
      let content: string;
      if (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
        try {
          content = gunzipSync(rawBuffer).toString('utf-8');
        } catch {
          return reply.code(400).send({ error: 'INVALID_BAK', message: 'Failed to decompress .bak file. File may be corrupted.' });
        }
      } else {
        content = rawBuffer.toString('utf-8');
      }

      let backup: BackupData;
      try {
        backup = JSON.parse(content);
      } catch {
        return reply.code(400).send({ error: 'INVALID_JSON', message: 'Backup file is not valid JSON' });
      }

      if (!backup.metadata || !backup.data) {
        return reply.code(400).send({ error: 'INVALID_BACKUP', message: 'Backup file is missing metadata or data sections' });
      }

      if (!backup.metadata.checksum || !backup.metadata.version) {
        return reply.code(400).send({ error: 'INVALID_METADATA', message: 'Backup metadata is incomplete' });
      }

      const computedChecksum = computeBackupChecksum(backup.data);
      if (computedChecksum !== backup.metadata.checksum) {
        return reply.code(400).send({
          error: 'CHECKSUM_MISMATCH',
          message: 'Backup file integrity check failed. The file may have been tampered with or corrupted.',
        });
      }

      // Restore in a transaction (delete all → insert all, respecting FK order)
      await prisma.$transaction(async (tx) => {
        // Temporarily disable audit_trail immutability triggers for restore
        await tx.$executeRawUnsafe('ALTER TABLE "audit_trail" DISABLE TRIGGER audit_trail_no_update');
        await tx.$executeRawUnsafe('ALTER TABLE "audit_trail" DISABLE TRIGGER audit_trail_no_delete');

        // Delete in reverse dependency order
        await tx.notification.deleteMany();
        await tx.passwordResetRequest.deleteMany();
        await tx.userConfig.deleteMany();
        await tx.roleConfig.deleteMany();
        await tx.fieldIdConfig.deleteMany();
        await tx.session.deleteMany();
        await tx.passwordHistory.deleteMany();
        await tx.auditTrail.deleteMany();
        await tx.systemConfig.deleteMany();
        await tx.user.deleteMany();
        await tx.role.deleteMany();

        // Insert in dependency order
        if (backup.data.roles?.length)
          await tx.role.createMany({ data: backup.data.roles });
        if (backup.data.users?.length)
          await tx.user.createMany({ data: backup.data.users });
        if (backup.data.systemConfig?.length)
          await tx.systemConfig.createMany({ data: backup.data.systemConfig });
        if (backup.data.fieldIdConfig?.length)
          await tx.fieldIdConfig.createMany({ data: backup.data.fieldIdConfig });
        if (backup.data.passwordHistory?.length)
          await tx.passwordHistory.createMany({ data: backup.data.passwordHistory });
        if (backup.data.sessions?.length)
          await tx.session.createMany({ data: backup.data.sessions });
        if (backup.data.passwordResetRequests?.length)
          await tx.passwordResetRequest.createMany({ data: backup.data.passwordResetRequests });
        if (backup.data.userConfigs?.length)
          await tx.userConfig.createMany({ data: backup.data.userConfigs });
        if (backup.data.roleConfigs?.length)
          await tx.roleConfig.createMany({ data: backup.data.roleConfigs });
        if (backup.data.notifications?.length)
          await tx.notification.createMany({ data: backup.data.notifications });
        if (backup.data.auditTrail?.length)
          await tx.auditTrail.createMany({ data: backup.data.auditTrail });

        // Re-enable audit_trail immutability triggers
        await tx.$executeRawUnsafe('ALTER TABLE "audit_trail" ENABLE TRIGGER audit_trail_no_update');
        await tx.$executeRawUnsafe('ALTER TABLE "audit_trail" ENABLE TRIGGER audit_trail_no_delete');
      });

      // Reset auto-increment sequence for audit_trail (only table with autoincrement)
      await prisma.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('audit_trail', 'id'), COALESCE((SELECT MAX(id) FROM audit_trail), 0) + 1, false)`
      );

      // Audit log the restore
      await app.auditLog({
        userId: req.user.username,
        userRole: req.user.role,
        action: 'BACKUP_RESTORED',
        targetType: 'system',
        targetId: 'database_restore',
        afterValue: {
          backupTimestamp: backup.metadata.timestamp,
          backupVersion: backup.metadata.version,
          backupChecksum: backup.metadata.checksum,
          generatedBy: backup.metadata.generatedBy,
        },
        signatureMeaning: 'Database restored from backup by administrator',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        sessionId: req.user.sessionId,
      });

      return {
        success: true,
        message: 'Database restored successfully',
        backupTimestamp: backup.metadata.timestamp,
        backupVersion: backup.metadata.version,
      };
    } catch (err: any) {
      app.log.error(err);
      return reply.code(500).send({
        error: 'RESTORE_FAILED',
        message: err.message || 'Database restore failed.',
      });
    }
  });

  // POST /api/backup/validate — Validate a backup file without restoring
  app.post('/validate', {
    preHandler: [app.requireRole('SUPER_ADMIN', 'ADMIN')],
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

    // Detect gzip (.bak) — gzip magic bytes: 0x1f 0x8b
    let content: string;
    if (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
      try {
        content = gunzipSync(rawBuffer).toString('utf-8');
      } catch {
        return reply.code(400).send({ valid: false, error: 'INVALID_BAK', message: 'Failed to decompress .bak file' });
      }
    } else {
      content = rawBuffer.toString('utf-8');
    }

    let backup: BackupData;
    try {
      backup = JSON.parse(content);
    } catch {
      return reply.code(400).send({ valid: false, error: 'INVALID_JSON', message: 'File is not valid JSON' });
    }

    if (!backup.metadata || !backup.data) {
      return reply.code(400).send({ valid: false, error: 'INVALID_BACKUP', message: 'Missing metadata or data' });
    }

    const computedChecksum = computeBackupChecksum(backup.data);
    const checksumValid = computedChecksum === backup.metadata.checksum;

    const tableSummary: Record<string, number> = {};
    for (const [key, value] of Object.entries(backup.data)) {
      if (Array.isArray(value)) tableSummary[key] = value.length;
    }

    return {
      valid: checksumValid,
      metadata: backup.metadata,
      tableSummary,
      checksumValid,
      totalRecords: Object.values(tableSummary).reduce((s, n) => s + n, 0),
    };
  });
}
