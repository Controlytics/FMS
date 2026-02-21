import { gzipSync, gunzipSync } from 'node:zlib';
import AdmZip from 'adm-zip';

import { auditLog } from '../../lib/audit.js';
import type { RequestContext } from '../../types/context.js';
import {
  fetchAllTablesRaw,
  fetchAllTablesPrisma,
  restoreFromBackup,
  resetAuditSequence,
} from './backup.repository.js';
import {
  computeBackupChecksum,
  DB_TABLES,
  escapeSqlValue,
  generateCsv,
  type BackupData,
} from './backup.helpers.js';

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Generate a date string suitable for filenames (e.g. "2026-02-21_10-30-00"). */
function dateStamp(): string {
  return new Date()
    .toISOString()
    .replace(/T/, '_')
    .replace(/:/g, '-')
    .replace(/\..+/, '');
}

/**
 * Parse a raw backup file buffer into a BackupData object.
 * Handles gzip detection (.bak) and JSON parsing.
 * Throws with structured { code, message } on failure.
 */
function parseBackupFile(rawBuffer: Buffer): BackupData {
  // Detect gzip (.bak) — gzip magic bytes: 0x1f 0x8b
  let content: string;
  if (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
    try {
      content = gunzipSync(rawBuffer).toString('utf-8');
    } catch {
      throw Object.assign(new Error('Failed to decompress .bak file. File may be corrupted.'), {
        code: 'INVALID_BAK',
      });
    }
  } else {
    content = rawBuffer.toString('utf-8');
  }

  let backup: BackupData;
  try {
    backup = JSON.parse(content);
  } catch {
    throw Object.assign(new Error('Backup file is not valid JSON'), {
      code: 'INVALID_JSON',
    });
  }

  if (!backup.metadata || !backup.data) {
    throw Object.assign(new Error('Backup file is missing metadata or data sections'), {
      code: 'INVALID_BACKUP',
    });
  }

  return backup;
}

// ---------------------------------------------------------------------------
// Export: JSON format (default)
// ---------------------------------------------------------------------------

export async function exportJson(
  username: string,
  ctx: RequestContext,
): Promise<{ backup: BackupData; filename: string }> {
  const data = await fetchAllTablesPrisma();
  const checksum = computeBackupChecksum(data);
  const timestamp = new Date().toISOString();

  const backup: BackupData = {
    metadata: {
      version: '1.0.0',
      timestamp,
      generatedBy: username,
      tableCount: Object.keys(data).length,
      checksum,
      format: 'json',
    },
    data,
  };

  await auditLog({
    userId: ctx.userId,
    userRole: ctx.userRole,
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
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    sessionId: ctx.sessionId,
  });

  return { backup, filename: `digilog_backup_${dateStamp()}.json` };
}

// ---------------------------------------------------------------------------
// Export: BAK format (gzip-compressed JSON)
// ---------------------------------------------------------------------------

export async function exportBak(
  username: string,
  ctx: RequestContext,
): Promise<{ compressed: Buffer; filename: string }> {
  const data = await fetchAllTablesPrisma();
  const checksum = computeBackupChecksum(data);
  const timestamp = new Date().toISOString();

  const backup: BackupData = {
    metadata: {
      version: '1.0.0',
      timestamp,
      generatedBy: username,
      tableCount: Object.keys(data).length,
      checksum,
      format: 'bak',
    },
    data,
  };

  const jsonStr = JSON.stringify(backup);
  const compressed = gzipSync(Buffer.from(jsonStr, 'utf-8'), { level: 9 });

  await auditLog({
    userId: ctx.userId,
    userRole: ctx.userRole,
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
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    sessionId: ctx.sessionId,
  });

  return { compressed, filename: `digilog_backup_${dateStamp()}.bak` };
}

// ---------------------------------------------------------------------------
// Export: SQL format
// ---------------------------------------------------------------------------

export async function exportSql(
  username: string,
  ctx: RequestContext,
): Promise<{ sqlContent: string; filename: string }> {
  const rawData = await fetchAllTablesRaw();
  const totalRecords = Object.values(rawData).reduce((sum, arr) => sum + arr.length, 0);

  const sqlParts: string[] = [];
  sqlParts.push('-- DigiLog Database Backup');
  sqlParts.push(`-- Generated: ${new Date().toISOString()}`);
  sqlParts.push(`-- Generated By: ${username}`);
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
      sqlParts.push(
        `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`,
      );
    }
    sqlParts.push('');
  }

  // Reset audit_trail sequence
  sqlParts.push(`-- Reset auto-increment sequence`);
  sqlParts.push(
    `SELECT setval(pg_get_serial_sequence('audit_trail', 'id'), COALESCE((SELECT MAX(id) FROM audit_trail), 0) + 1, false);`,
  );
  sqlParts.push('');
  sqlParts.push('COMMIT;');

  await auditLog({
    userId: ctx.userId,
    userRole: ctx.userRole,
    action: 'BACKUP_CREATED',
    targetType: 'system',
    targetId: 'database_backup',
    afterValue: { format: 'sql', timestamp: new Date().toISOString(), totalRecords },
    signatureMeaning: 'SQL database backup created by administrator',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    sessionId: ctx.sessionId,
  });

  return { sqlContent: sqlParts.join('\n'), filename: `digilog_backup_${dateStamp()}.sql` };
}

// ---------------------------------------------------------------------------
// Export: CSV format (ZIP archive of per-table CSVs)
// ---------------------------------------------------------------------------

export async function exportCsv(
  username: string,
  ctx: RequestContext,
): Promise<{ zipBuffer: Buffer; filename: string }> {
  const rawData = await fetchAllTablesRaw();
  const totalRecords = Object.values(rawData).reduce((sum, arr) => sum + arr.length, 0);

  const zip = new AdmZip();

  for (const table of DB_TABLES) {
    const rows = rawData[table];
    const csvContent = generateCsv(rows);
    zip.addFile(`${table}.csv`, Buffer.from(csvContent, 'utf-8'));
  }

  // Add a metadata file
  const metaContent = JSON.stringify(
    {
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      generatedBy: username,
      format: 'csv',
      tableCount: DB_TABLES.length,
      totalRecords,
      tables: Object.fromEntries(DB_TABLES.map(t => [t, rawData[t].length])),
    },
    null,
    2,
  );
  zip.addFile('_metadata.json', Buffer.from(metaContent, 'utf-8'));

  await auditLog({
    userId: ctx.userId,
    userRole: ctx.userRole,
    action: 'BACKUP_CREATED',
    targetType: 'system',
    targetId: 'database_backup',
    afterValue: { format: 'csv', timestamp: new Date().toISOString(), totalRecords },
    signatureMeaning: 'CSV database backup created by administrator',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    sessionId: ctx.sessionId,
  });

  return { zipBuffer: zip.toBuffer(), filename: `digilog_backup_${dateStamp()}.zip` };
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export async function restore(
  fileBuffer: Buffer,
  ctx: RequestContext,
): Promise<{
  success: boolean;
  message: string;
  backupTimestamp: string;
  backupVersion: string;
}> {
  const backup = parseBackupFile(fileBuffer);

  if (!backup.metadata.checksum || !backup.metadata.version) {
    throw Object.assign(new Error('Backup metadata is incomplete'), {
      code: 'INVALID_METADATA',
    });
  }

  const computedChecksum = computeBackupChecksum(backup.data);
  if (computedChecksum !== backup.metadata.checksum) {
    throw Object.assign(new Error(
      'Backup file integrity check failed. The file may have been tampered with or corrupted.',
    ), { code: 'CHECKSUM_MISMATCH' });
  }

  await restoreFromBackup(backup);
  await resetAuditSequence();

  // Audit log the restore
  await auditLog({
    userId: ctx.userId,
    userRole: ctx.userRole,
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
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    sessionId: ctx.sessionId,
  });

  return {
    success: true,
    message: 'Database restored successfully',
    backupTimestamp: backup.metadata.timestamp,
    backupVersion: backup.metadata.version,
  };
}

// ---------------------------------------------------------------------------
// Validate (no DB mutation)
// ---------------------------------------------------------------------------

export async function validate(
  fileBuffer: Buffer,
): Promise<{
  valid: boolean;
  metadata: BackupData['metadata'];
  tableSummary: Record<string, number>;
  checksumValid: boolean;
  totalRecords: number;
}> {
  const backup = parseBackupFile(fileBuffer);

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
}
