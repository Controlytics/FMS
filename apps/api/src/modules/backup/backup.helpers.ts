import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupData {
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Table list is now discovered dynamically at backup time
// (see getAllTables in backup.repository.ts)

// ---------------------------------------------------------------------------
// Pure helper functions (no DB access)
// ---------------------------------------------------------------------------

/**
 * Compute a SHA-256 checksum over the backup data payload.
 * Top-level keys are sorted for deterministic ordering.
 */
export function computeBackupChecksum(data: Record<string, any[]>): string {
  const sorted: Record<string, any[]> = {};
  for (const key of Object.keys(data).sort()) {
    sorted[key] = data[key];
  }
  const payload = JSON.stringify(sorted);
  return createHash('sha256').update(payload).digest('hex');
}

/**
 * Render one element inside a PostgreSQL array literal.
 *
 * Array-literal quoting is NOT SQL quoting: inside `{...}` an element is wrapped
 * in DOUBLE quotes, and backslashes and double quotes within it are
 * backslash-escaped. The whole literal is then wrapped in single quotes by the
 * caller, at which point normal SQL single-quote doubling applies — handled once,
 * outside, so it is not applied twice here.
 */
function arrayElementLiteral(value: any): string {
  if (value === null || value === undefined) return 'NULL'; // unquoted NULL = SQL NULL element
  const s = value instanceof Date ? value.toISOString() : String(value);
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Escape a value for a PostgreSQL INSERT statement.
 *
 * `elementType` must be supplied for ARRAY columns — pass the ELEMENT type name
 * (e.g. `NotificationEventType`), unquoted. Without it a JS array is
 * indistinguishable from any other object and gets emitted as `::jsonb`, which
 * Postgres rejects for an array column with SQLSTATE 42804 and rolls the whole
 * restore back. That was the first of the three faults that made the plain .sql
 * export unrestorable (2026-08-08).
 */
export function escapeSqlValue(value: any, elementType?: string): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return String(value);
  if (value instanceof Date) return `'${value.toISOString()}'`;

  // ARRAY column — emit a Postgres array literal cast to the real type.
  // The element type is quoted because the enum types are CamelCase, and an
  // unquoted CamelCase identifier is folded to lower case and then not found.
  if (elementType) {
    const items = Array.isArray(value) ? value : [value];
    const literal = `{${items.map(arrayElementLiteral).join(',')}}`;
    return `'${literal.replace(/'/g, "''")}'::"${elementType}"[]`;
  }

  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  // String — escape single quotes
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Escape a value for CSV output. */
export function escapeCsvValue(value: any): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return `"${JSON.stringify(value).replace(/"/g, '""')}"`;
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Generate SQL INSERT statements for a single table.
 * NOTE: Does NOT include TRUNCATE — the caller handles truncation separately
 * because export needs a specific FK-safe ordering.
 */
export function generateSqlInserts(tableName: string, rows: Record<string, any>[]): string {
  if (rows.length === 0) return `-- Table: ${tableName} (0 rows)\n`;

  const columns = Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push(`-- Table: ${tableName} (${rows.length} rows)`);

  for (const row of rows) {
    const values = columns.map(col => escapeSqlValue(row[col]));
    lines.push(`INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`);
  }
  lines.push('');
  return lines.join('\n');
}

/** Generate CSV content (header + rows) for a single table. */
export function generateCsv(rows: Record<string, any>[]): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]);
  const lines: string[] = [];
  lines.push(columns.join(','));
  for (const row of rows) {
    lines.push(columns.map(col => escapeCsvValue(row[col])).join(','));
  }
  return lines.join('\n');
}
