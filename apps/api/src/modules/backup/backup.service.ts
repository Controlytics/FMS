import { gzipSync, gunzipSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import { runPgDump, runPgRestore, PgToolError } from './pg-tools.js';

/**
 * Decompression ceiling for uploaded backups (2 GB).
 *
 * The upload limit (100 MB, backup/routes.ts) bounds the COMPRESSED bytes only.
 * gzip hits ~1000:1 on repetitive input, so without a ceiling a max-size upload
 * can demand ~100 GB of heap and OOM a single-process API that the whole tablet
 * fleet depends on.
 *
 * 2 GB is chosen to sit above any plausible real backup — the live dev DB dumps
 * to ~29 MB — while staying under Node's ~2 GB max string length, which
 * `.toString('utf-8')` would hit anyway.
 */
const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

import { auditLog } from '../../lib/audit.js';
import { prisma } from '../../lib/prisma.js';
import { restoreNeutralizedFormula } from '../../lib/spreadsheet-safe.js';
import type { RequestContext } from '../../types/context.js';
import {
  fetchAllTablesRaw,
  restoreFromBackup,
  verifyBackupAuditChain,
  normalizeBackupKeys,
  getArrayColumns,
  getSelfReferencingColumns,
  getUserTriggerState,
  getServerMajorVersion,
  resetPublicSchema,
  listParkSchemas,
  dropParkSchemas,
  preserveUnbackedAuditRows,
  dropRecordedDeletions,
  resyncSequencesAfterRestore,
  type BackupChainReport,
} from './backup.repository.js';
import {
  computeBackupChecksum,
  signBackup,
  verifyBackupSignature,
  escapeSqlValue,
  generateCsv,
  type BackupData,
} from './backup.helpers.js';
import { getAuditChainKey } from '../../lib/hash-chain.js';
import { AppError } from '../../lib/errors.js';
import { getModuleLogger } from '../../lib/logger.js';

const backupLog = getModuleLogger('backup');

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

/** A column's type as the live schema states it (information_schema.columns). */
interface ColumnType { dataType: string; udtName: string }
/** table -> column -> type, for the public schema. */
type SchemaColumnTypes = Map<string, Map<string, ColumnType>>;

/**
 * The live schema's column types, which decide how a CSV cell is read back
 * (D-DB-3, 2026-10-22). A CSV cell is only text; guessing its type from that
 * text turned a numeric username in a varchar column into a number, and the
 * audit-chain check then hashed a value the row was never written with.
 */
async function loadSchemaColumnTypes(): Promise<SchemaColumnTypes> {
  const rows = await prisma.$queryRawUnsafe<Array<{ table_name: string; column_name: string; data_type: string; udt_name: string }>>(
    `SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns WHERE table_schema = 'public'`,
  );
  const types: SchemaColumnTypes = new Map();
  for (const r of rows) {
    if (!types.has(r.table_name)) types.set(r.table_name, new Map());
    types.get(r.table_name)!.set(r.column_name, { dataType: r.data_type, udtName: r.udt_name });
  }
  return types;
}

const isCanonicalNumber = (v: string) => v !== '' && Number.isFinite(Number(v)) && String(Number(v)) === v;

/** JSON-shaped text parsed; anything that is not valid JSON stays the text it is. */
function parseJsonCell(val: string): unknown {
  if ((val.startsWith('{') && val.endsWith('}')) || (val.startsWith('[') && val.endsWith(']'))) {
    try {
      return JSON.parse(val);
    } catch {
      // Cell looks JSON-shaped but isn't valid JSON — kept as a plain string on
      // purpose (a hand-edited cell); Postgres decides on reinsert.
    }
  }
  return val;
}

/**
 * How a cell read before 2026-10-22, for a column the live schema does not have
 * (an old backup's dropped column): JSON-shaped text parsed, true/false as
 * booleans, and a number only when the text is its canonical form (#backup-csv:
 * "0055", "+9198…", "1.0", "1e5" stay text). Postgres casts on reinsert.
 */
function guessCellType(val: string): unknown {
  const json = parseJsonCell(val);
  if (json !== val) return json;
  if (val === 'true') return true;
  if (val === 'false') return false;
  if (val.length < 15 && isCanonicalNumber(val)) return Number(val);
  return val;
}

/**
 * One CSV cell back to the value the export read from the database.
 *
 * - An UNQUOTED empty cell is NULL; a QUOTED empty cell ("") is the empty string
 *   (D-DB-4, 2026-10-22 — PostgreSQL's own CSV convention). Files written before
 *   the change wrote '' unquoted too, so they read as NULL, as they always did.
 * - The export's formula neutralisation is undone (2026-10-22).
 * - The type is the COLUMN's (D-DB-3): text, uuid, enums, timestamps, numeric
 *   and bigint stay the exact text written (the export writes bigint as text too,
 *   and numeric must not round); integer and floating columns become numbers,
 *   booleans booleans, json/jsonb and arrays parsed values.
 */
function decodeCsvCell(raw: string, quoted: boolean, type: ColumnType | undefined): unknown {
  if (raw === '') return quoted ? '' : null;
  const val = restoreNeutralizedFormula(raw);
  if (!type) return guessCellType(val);
  switch (type.dataType) {
    case 'boolean':
      return val === 'true' ? true : val === 'false' ? false : val;
    case 'smallint':
    case 'integer':
    case 'real':
    case 'double precision':
      return isCanonicalNumber(val) ? Number(val) : val;
    case 'json':
    case 'jsonb':
    case 'ARRAY':
      return parseJsonCell(val);
    default:
      return val;
  }
}

/**
 * Parse a CSV string into an array of objects using the header row as keys,
 * each cell typed by its column in `columnTypes` (the table's live columns).
 */
function parseCsvContent(csvString: string, columnTypes?: Map<string, ColumnType>): Record<string, any>[] {
  const records = parseCsvRecords(csvString);
  if (records.length < 2) return [];

  const headers = records[0].map(f => f.value);
  const rows: Record<string, any>[] = [];

  for (let i = 1; i < records.length; i++) {
    const values = records[i];
    const row: Record<string, any> = {};
    for (let j = 0; j < headers.length; j++) {
      const cell = values[j];
      row[headers[j]] = decodeCsvCell(cell?.value ?? '', cell?.quoted ?? false, columnTypes?.get(headers[j]));
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Split CSV text into records of fields, honouring quotes ACROSS line breaks.
 *
 * D4 (2026-10-21): this used to split the whole file on '\n' first and only then
 * parse quotes line by line. escapeCsvValue quotes any value containing a line
 * break, so a multi-line cell (the seeded help_articles.content, a multi-line
 * remark) was cut into fragments that shifted every later column — restoring
 * the app's own CSV export failed with 22P02 on a uuid column. A record now ends
 * only at a line break OUTSIDE quotes; CRLF and a bare CR end a record too. A
 * line break inside quotes is kept verbatim. Blank lines are skipped, as before.
 */
/** One CSV field: its text, and whether it was written in quotes ("" = empty string, D-DB-4). */
interface CsvField { value: string; quoted: boolean }

function parseCsvRecords(csv: string): CsvField[][] {
  const records: CsvField[][] = [];
  let record: CsvField[] = [];
  let field = '';
  let quoted = false;
  let inQuotes = false;
  const endField = () => {
    record.push({ value: field, quoted });
    field = '';
    quoted = false;
  };
  const endRecord = () => {
    endField();
    if (!(record.length === 1 && !record[0].quoted && record[0].value.trim() === '')) records.push(record);
    record = [];
  };
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (inQuotes) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else if (ch === '"') {
      if (field === '') quoted = true;
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== '' || quoted || record.length > 0) endRecord();
  return records;
}

/**
 * Parse SQL backup into BackupData by extracting INSERT statements.
 */
function parseSqlBackup(sqlContent: string): BackupData {
  const data: Record<string, any[]> = {};

  // Seed all tables referenced by TRUNCATE statements — this captures empty tables too
  const truncateRegex = /TRUNCATE TABLE "([^"]+)"/g;
  let tm;
  while ((tm = truncateRegex.exec(sqlContent)) !== null) {
    if (!data[tm[1]]) data[tm[1]] = [];
  }

  // Parse each INSERT with a STRING-AWARE scanner. The previous single regex
  // (/...VALUES\s*\((.+?)\);/g) had two silent data-loss bugs on real data:
  //   1. `.` doesn't match newlines → any row with a newline inside a text value
  //      (multi-line reason / description / address) was SILENTLY DROPPED — the
  //      INSERT simply failed to match, so the row vanished on restore.
  //   2. `\);` is lazy → a value containing `);` (e.g. "cleaned filter (A); redo")
  //      terminated the match at the FIRST `);` → the row was truncated to the
  //      wrong column count and reinserted corrupt (or rejected).
  // Fix: match only the fixed `INSERT INTO "t" (cols) VALUES (` header (identifiers
  // never contain newlines or `)`), then scan the values with full single-quote /
  // `''`-escape awareness to find the TRUE top-level `)`. A stray `INSERT INTO …`
  // substring living inside a string value can't be re-matched because the cursor
  // always advances past the statement we just consumed.
  const headerRegex = /INSERT INTO "([^"]+)"\s*\(([^)]+)\)\s*VALUES\s*\(/g;
  let cursor = 0;
  for (;;) {
    headerRegex.lastIndex = cursor;
    const m = headerRegex.exec(sqlContent);
    if (!m) break;
    const table = m[1];
    const columns = m[2].split(',').map(c => c.trim().replace(/"/g, ''));
    const valuesStart = headerRegex.lastIndex; // first char after VALUES '('
    const valuesEnd = findValuesClose(sqlContent, valuesStart);
    if (valuesEnd === -1) {
      // Truncated/malformed tail (no unquoted close paren). Stop rather than
      // silently mis-parse the remainder into bad rows.
      break;
    }
    const valuesStr = sqlContent.slice(valuesStart, valuesEnd);

    // Parse values (handle quoted strings, NULL, booleans, numbers, jsonb)
    const values = parseSqlValues(valuesStr);

    if (!data[table]) data[table] = [];
    const row: Record<string, any> = {};
    for (let i = 0; i < columns.length; i++) {
      row[columns[i]] = values[i] ?? null;
    }
    data[table].push(row);

    cursor = valuesEnd + 1; // past this statement's close paren
  }

  applySelfReferenceUpdates(sqlContent.slice(cursor), data);

  // Extract metadata from SQL comments
  let generatedBy = 'unknown';
  let timestamp = new Date().toISOString();
  const byMatch = sqlContent.match(/-- Generated By: (.+)/);
  if (byMatch) generatedBy = byMatch[1].trim();
  const tsMatch = sqlContent.match(/-- Generated: (.+)/);
  if (tsMatch) timestamp = tsMatch[1].trim();

  return {
    metadata: {
      version: '1.0.0',
      timestamp,
      generatedBy,
      tableCount: Object.keys(data).length,
      checksum: computeBackupChecksum(data),
      format: 'sql',
    },
    data,
  };
}

/**
 * Parse a PostgreSQL array literal — `{"A","B"}` / `{1,2}` / `{}` — into a JS
 * array. Elements may be bare or double-quoted; inside a quoted element, `\"`
 * and `\\` are escapes, and a bare `NULL` is a null element.
 *
 * Inverse of `arrayElementLiteral` in backup.helpers.ts; the pair keeps the
 * .sql export and the in-app .sql import round-tripping.
 */
export function parsePgArrayLiteral(literal: string): any[] {
  const body = literal.trim().replace(/^\{/, '').replace(/\}$/, '');
  if (body.trim() === '') return [];
  const out: any[] = [];
  let cur = '';
  let quoted = false;
  let sawQuote = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (quoted) {
      if (ch === '\\') { cur += body[++i] ?? ''; }
      else if (ch === '"') { quoted = false; }
      else cur += ch;
    } else if (ch === '"') {
      quoted = true;
      sawQuote = true;
    } else if (ch === ',') {
      out.push(!sawQuote && cur.trim().toUpperCase() === 'NULL' ? null : cur);
      cur = '';
      sawQuote = false;
    } else {
      cur += ch;
    }
  }
  out.push(!sawQuote && cur.trim().toUpperCase() === 'NULL' ? null : cur);
  return out;
}

/** Parse SQL VALUES string into JS values */
function parseSqlValues(valuesStr: string): any[] {
  const result: any[] = [];
  let current = '';
  let inString = false;
  let depth = 0;

  for (let i = 0; i < valuesStr.length; i++) {
    const ch = valuesStr[i];
    if (inString) {
      if (ch === "'" && valuesStr[i + 1] === "'") { current += "'"; i++; }
      else if (ch === "'") {
        inString = false;
        // Check for ::jsonb cast
        if (valuesStr.substring(i + 1, i + 8) === '::jsonb') {
          i += 7;
          try { result.push(JSON.parse(current)); } catch { result.push(current); }
        } else {
          // Array cast — `::"NotificationEventType"[]` (2026-08-08). The SQL
          // exporter now emits real Postgres array literals for ARRAY columns
          // instead of ::jsonb. Without this branch the in-app restore of its
          // OWN .sql would hand the raw literal `{"A","B"}` to
          // jsonb_populate_recordset as a STRING, which cannot populate an
          // array column — the export fix would have broken the import path.
          const arrayCast = /^::"?[A-Za-z_][A-Za-z0-9_]*"?\[\]/.exec(valuesStr.slice(i + 1));
          if (arrayCast) {
            i += arrayCast[0].length;
            result.push(parsePgArrayLiteral(current));
          } else {
            result.push(current);
          }
        }
        current = '';
      }
      else { current += ch; }
    } else {
      if (ch === "'") { inString = true; current = ''; }
      else if (ch === ',' && depth === 0) {
        const trimmed = current.trim();
        if (trimmed === 'NULL') result.push(null);
        else if (trimmed === 'TRUE') result.push(true);
        else if (trimmed === 'FALSE') result.push(false);
        else if (trimmed && !isNaN(Number(trimmed))) result.push(Number(trimmed));
        current = '';
      }
      else { current += ch; }
    }
  }
  // Handle last value
  if (!inString) {
    const trimmed = current.trim();
    if (trimmed === 'NULL') result.push(null);
    else if (trimmed === 'TRUE') result.push(true);
    else if (trimmed === 'FALSE') result.push(false);
    else if (trimmed && !isNaN(Number(trimmed))) result.push(Number(trimmed));
    else if (trimmed) result.push(trimmed);
  }

  return result;
}

/**
 * D2 (2026-10-21): apply the exporter's second pass for self-referencing FKs.
 *
 * buildSqlScript writes every self-referencing column (asset_instances.parent_id)
 * as NULL in its INSERT and restores it afterwards with
 *   UPDATE "<table>" SET "<col>" = <value> WHERE "id" = <value>;
 * so that psql never meets a child before its parent. The in-app importer read
 * only the INSERTs, so restoring a .sql backup silently unparented every
 * asset_instance — the whole Block → Area → AHU → Filter tree — and answered 200.
 *
 * `tail` is the script AFTER the last INSERT the scanner consumed, which is where
 * the exporter writes this pass; text inside an INSERT value can therefore never
 * be applied. Values use the same literal syntax as the INSERTs (escapeSqlValue),
 * so they go through the same parser. An UPDATE for a table or id the file does
 * not contain is ignored: there is no row in this backup for it to change.
 */
function applySelfReferenceUpdates(tail: string, data: Record<string, any[]>): void {
  const literal = `('(?:[^']|'')*'|[^\\s;]+)`;
  const updateRegex = new RegExp(`UPDATE "([^"]+)" SET "([^"]+)" = ${literal} WHERE "id" = ${literal};`, 'g');
  for (const m of tail.matchAll(updateRegex)) {
    const [, table, column, valueSql, idSql] = m;
    const rows = data[table];
    if (!rows) continue;
    const [id] = parseSqlValues(idSql);
    const row = rows.find(r => r.id != null && String(r.id) === String(id));
    if (!row) continue;
    const [value] = parseSqlValues(valueSql);
    row[column] = value ?? null;
  }
}

/**
 * Given a serialized SQL VALUES list, scan from `start` (the first char AFTER
 * the opening `(`) and return the index of the matching TOP-LEVEL `)` — the one
 * that is NOT inside a quoted string. Single quotes escape as `''` (SQL
 * standard, matching escapeSqlValue). Newlines, `)`, `;` and `,` inside a quoted
 * string are all skipped. Returns -1 if no unquoted close paren exists
 * (truncated input). This is what makes multi-line values and values containing
 * `);` parse correctly.
 */
function findValuesClose(sql: string, start: number): number {
  let inString = false;
  for (let i = start; i < sql.length; i++) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'") {
        if (sql[i + 1] === "'") { i++; continue; } // '' escaped quote — skip both
        inString = false;
      }
      // any other char (incl. newline / ')' / ';') stays inside the string
    } else {
      if (ch === "'") inString = true;
      else if (ch === ')') return i; // top-level close paren
    }
  }
  return -1;
}



/**
 * Parse a CSV ZIP backup into BackupData, each table's cells typed by that
 * table's live columns. The archive is checked first, so a bad upload is refused
 * before the schema is read.
 */
async function parseCsvZipBackup(rawBuffer: Buffer): Promise<BackupData> {
  // D9 (2026-10-21): a file with the ZIP signature but no readable archive made
  // AdmZip throw an UNCODED error, which both routes reported as a 500 (and
  // /restore echoed AdmZip's text). It is a bad upload: a coded INVALID_ZIP.
  const invalidZip = (err: unknown) => Object.assign(
    new Error('Backup file is not a valid ZIP archive. Upload the .zip produced by the CSV export, unmodified.'),
    { code: 'INVALID_ZIP', cause: err },
  );
  let entries: AdmZip.IZipEntry[];
  try {
    entries = new AdmZip(rawBuffer).getEntries();
  } catch (err) {
    throw invalidZip(err);
  }
  const readEntry = (entry: AdmZip.IZipEntry): string => {
    try {
      return entry.getData().toString('utf-8');
    } catch (err) {
      throw invalidZip(err);
    }
  };

  // AdmZip decompresses entries fully into memory, so a zip bomb inside the
  // 100 MB upload cap can exhaust the heap before any of our parsing runs. The
  // central directory declares each entry's uncompressed size up front, so the
  // total can be rejected without decompressing anything.
  const declaredTotal = entries.reduce((sum, e) => sum + (e.header?.size ?? 0), 0);
  if (declaredTotal > MAX_DECOMPRESSED_BYTES) {
    throw Object.assign(
      new Error(`Backup expands to ${Math.round(declaredTotal / 1e6)} MB, beyond the ${Math.round(MAX_DECOMPRESSED_BYTES / 1e6)} MB decompression limit.`),
      { code: 'INVALID_ZIP' },
    );
  }

  // Read metadata
  const metaEntry = entries.find(e => e.entryName === '_metadata.json');
  let generatedBy = 'unknown';
  let timestamp = new Date().toISOString();
  if (metaEntry) {
    const metaText = readEntry(metaEntry);
    try {
      const meta = JSON.parse(metaText);
      generatedBy = meta.generatedBy ?? 'unknown';
      timestamp = meta.timestamp ?? timestamp;
    } catch (err) {
      // Corrupted _metadata.json. Restore can still proceed with default
      // metadata, but a malformed metadata file is a real signal that the
      // backup may be partially corrupt — log so QA can investigate.
      backupLog.warn({ err }, '_metadata.json could not be parsed; using defaults');
    }
  }

  const csvEntries = entries.filter(e => e.entryName !== '_metadata.json' && e.entryName.endsWith('.csv'));
  const schemaTypes = csvEntries.length > 0 ? await loadSchemaColumnTypes() : new Map() as SchemaColumnTypes;
  const data: Record<string, any[]> = {};
  for (const entry of csvEntries) {
    const tableName = entry.entryName.replace('.csv', '');
    data[tableName] = parseCsvContent(readEntry(entry), schemaTypes.get(tableName));
  }

  return {
    metadata: {
      version: '1.0.0',
      timestamp,
      generatedBy,
      tableCount: Object.keys(data).length,
      checksum: computeBackupChecksum(data),
      format: 'csv',
    },
    data,
  };
}

/**
 * Parse a raw backup file buffer into a BackupData object: ZIP (CSV), gzip
 * (.bak), the app's SQL script, or JSON. Throws with structured { code, message }
 * on failure. restore() and validate() both read files through here, so the two
 * always see the same rows (D-DB-3).
 */
async function parseBackupFile(rawBuffer: Buffer): Promise<BackupData> {
  // Detect ZIP (.csv backup) — ZIP magic bytes: 0x50 0x4b
  if (rawBuffer[0] === 0x50 && rawBuffer[1] === 0x4b) {
    return parseCsvZipBackup(rawBuffer);
  }

  // Detect gzip (.bak) — gzip magic bytes: 0x1f 0x8b
  let content: string;
  if (rawBuffer[0] === 0x1f && rawBuffer[1] === 0x8b) {
    try {
      // maxOutputLength is the only thing between a 100 MB upload and an OOM:
      // gzip reaches ~1000:1 on repetitive input, so an unbounded gunzipSync of
      // a max-size upload can demand ~100 GB of heap. This is a single-process
      // API serving the tablet fleet — killing it takes the cleanroom floor with
      // it. zlib throws past the cap, which the catch turns into INVALID_BAK.
      content = gunzipSync(rawBuffer, { maxOutputLength: MAX_DECOMPRESSED_BYTES }).toString('utf-8');
    } catch {
      throw Object.assign(new Error('Failed to decompress .bak file. File may be corrupted or expands beyond the decompression limit.'), {
        code: 'INVALID_BAK',
      });
    }
  } else {
    content = rawBuffer.toString('utf-8');
  }

  // Detect SQL format
  if (content.trimStart().startsWith('-- DigiLog Database Backup')) {
    return parseSqlBackup(content);
  }

  let backup: BackupData;
  try {
    backup = JSON.parse(content);
  } catch {
    throw Object.assign(new Error('Backup file is not valid JSON. Supported formats: .json, .bak, .sql, .zip (CSV)'), {
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
  const data = await fetchAllTablesRaw();
  const checksum = computeBackupChecksum(data);
  const timestamp = new Date().toISOString();

  const backup: BackupData = {
    metadata: {
      version: '1.0.0',
      timestamp,
      generatedBy: username,
      tableCount: Object.keys(data).length,
      checksum,
      signature: signBackup(checksum, timestamp, getAuditChainKey()),
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
  const data = await fetchAllTablesRaw();
  const checksum = computeBackupChecksum(data);
  const timestamp = new Date().toISOString();

  const backup: BackupData = {
    metadata: {
      version: '1.0.0',
      timestamp,
      generatedBy: username,
      tableCount: Object.keys(data).length,
      checksum,
      signature: signBackup(checksum, timestamp, getAuditChainKey()),
      format: 'bak',
    },
    data,
  };

  // BigInt replacer — audit 2026-05-04 fix C3 added a BIGSERIAL chain_position
  // column to audit_trail. The pg driver returns BIGSERIAL as native BigInt,
  // and JSON.stringify throws on BigInt without a replacer. Stringify them
  // here so the backup is JSON-clean. Restore parses them back as strings;
  // operators reading the backup file see the value verbatim.
  const jsonStr = JSON.stringify(backup, (_k, v) =>
    typeof v === 'bigint' ? v.toString() : v,
  );
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

// ---------------------------------------------------------------------------
// Export / restore: DUMP format (pg_dump custom archive) — the real full backup
// ---------------------------------------------------------------------------

/**
 * Full physical backup via `pg_dump -Fc`.
 *
 * Unlike every other format here this carries the SCHEMA as well as the data —
 * sequences, functions, triggers, constraints — so it can rebuild the database
 * from nothing. It is also the only artifact pgAdmin's Restore dialog accepts.
 *
 * pg_dump writes to a file rather than stdout so a partial/failed dump never
 * reaches the operator as a truncated-but-plausible download.
 */
export async function exportDump(
  username: string,
  ctx: RequestContext,
): Promise<{ filePath: string; filename: string; cleanup: () => Promise<void> }> {
  const serverMajor = await getServerMajorVersion();
  const filename = `digilog_backup_${dateStamp()}.dump`;
  const dir = await mkdtemp(join(tmpdir(), 'digilog-backup-'));
  const filePath = join(dir, filename);

  // D10 (2026-10-21): on any failure below the directory used to be left in
  // %TEMP% — with whatever partial archive pg_dump had written, which carries
  // live password hashes. Only a successful export hands the directory to the
  // caller (the route removes it once the download has been streamed).
  let handedOff = false;
  try {
    await runPgDump(filePath, { serverMajor });
    const { size } = await stat(filePath);

    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'BACKUP_CREATED',
      targetType: 'system',
      targetId: 'database_backup',
      afterValue: { format: 'dump', timestamp: new Date().toISOString(), bytes: size, serverMajor },
      signatureMeaning: 'Full pg_dump database backup created by administrator',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    handedOff = true;
    return { filePath, filename, cleanup: () => rm(dir, { recursive: true, force: true }) };
  } finally {
    if (!handedOff) {
      // The export's own error is what the caller must see; a failed cleanup is logged, not thrown.
      await rm(dir, { recursive: true, force: true })
        .catch((err) => backupLog.warn({ err, dir }, 'Could not remove the temp directory of a failed dump export'));
    }
  }
}

/**
 * What a failed pg_dump restore may tell the CLIENT about its cause. A PgToolError
 * carries pg_dump / pg_restore's own output, which the operator needs to act on.
 * Anything else (a Prisma error from the audit-row carry-over, for one) embeds
 * source paths and SQL, so it stays in the server log only (CLAUDE.md strict audit).
 */
/** A schema name for one parked copy of the audit trail; no archive can hold it. */
const newParkName = (): string => `digilog_keep_${randomBytes(8).toString('hex')}`;

function restoreFailureReason(err: unknown): string {
  return err instanceof PgToolError
    ? err.message
    : 'An internal error stopped the restore (details are in the server log).';
}

/**
 * Restore a pg_dump custom archive over this database.
 *
 * Sequence matters:
 *   1. Take a safety dump FIRST. Step 2 is irreversible, and if pg_restore then
 *      fails the operator would be left with an empty database and no way back.
 *   2. Empty the public schema (see resetPublicSchema for why `--clean` cannot
 *      be used on this schema).
 *   3. pg_restore --single-transaction --exit-on-error, so any error aborts the
 *      whole thing rather than leaving a half-restored database reporting success.
 *   4. On failure, roll back to the safety dump.
 *
 * NOTE: this replaces `audit_trail` wholesale, exactly as the JSON/BAK restore
 * does. It is gated on BACKUP_RESTORE + re-auth and is itself audited — but the
 * audit row is written to the RESTORED trail, so the pre-restore trail survives
 * only inside the safety dump.
 */
export async function restoreDump(
  fileBuffer: Buffer,
  ctx: RequestContext,
): Promise<{ success: boolean; message: string; backupTimestamp: string; backupVersion: string }> {
  // Audit 2026-09-24 (api #1): a pg_dump archive carries no server signature and
  // executes whatever it contains — SUPER_ADMIN only.
  if (ctx.userRole !== 'SUPER_ADMIN') {
    throw new AppError(403, 'BACKUP_UNSIGNED', 'Restoring a pg_dump archive requires a Super Admin.');
  }
  const serverMajor = await getServerMajorVersion();
  const dir = await mkdtemp(join(tmpdir(), 'digilog-restore-'));
  const archivePath = join(dir, 'upload.dump');
  const safetyPath = join(dir, 'pre-restore-safety.dump');
  // Set when a failed rollback leaves the safety dump as the ONLY copy of the
  // operator's data — the cleanup below must not delete it.
  let preserveDir = false;
  // D-DB-10 (2026-10-22): the park must not outlive this call. It was dropped
  // only on success, so a failed restore left a full, mutable, unchained copy of
  // audit_trail in the database, carried by every later backup. Dropped on every
  // exit below — except after a failed rollback, where it may be the only other
  // copy of the trail and is kept next to the safety dump.
  let keepParked = false;
  // BR-100 (2026-10-22): the park is named per run. It was always `digilog_keep`,
  // and pg_restore --clean drops every object the archive holds before loading it:
  // an archive that carried a digilog_keep of its own (a dump taken during an
  // in-app restore, or after a failed one before D-DB-10) dropped the parked LIVE
  // trail and loaded its stale copy, so the rows written after the backup were lost
  // while the restore reported success. No archive can name this schema.
  const park = newParkName();
  // Park schemas already in the LIVE database when this run starts: recovery copies
  // an earlier failed restore kept (RESTORE_FAILED_NO_ROLLBACK names one). Trusted
  // (operator decision 2026-10-22): their rows are carried over like live rows the
  // backup lacks, and they are dropped only once that has succeeded. Parks that
  // arrive WITH the archive are not trusted and are dropped unread.
  let earlierParks: Array<{ was: string; now: string }> = [];
  const earlierNote = (): string => (earlierParks.length === 0 ? '' :
    ` The audit rows an earlier failed restore kept are still in schema${earlierParks.length > 1 ? 's' : ''} `
    + `${earlierParks.map((p) => `${p.now} (was ${p.was})`).join(', ')}; they were not carried over.`);

  let auditRowsPreserved = 0;
  let auditRowsFromEarlierFailedRestore = 0;
  let auditRowsSkippedAsDeleted = 0;
  try {
    await writeFile(archivePath, fileBuffer);

    // 1. Safety net before anything destructive.
    await runPgDump(safetyPath, { serverMajor });

    // 1b. Audit 2026-09-24 (compliance F5, closed 2026-09-25): park the live
    // audit trail in a schema the public reset does not touch, so rows the
    // archive does not carry come back after the load instead of being
    // destroyed (the trail is the one table retained permanently).
    keepParked = true;
    // 1c. The earlier parks get fresh names first. pg_restore --clean drops every
    // schema the archive holds, so a park the archive also carries (the fixed
    // `digilog_keep` of every dump taken after a failed restore before D-DB-10)
    // would be replaced by the archive's stale copy.
    earlierParks = (await listParkSchemas()).map((was) => ({ was, now: newParkName() }));
    for (const p of earlierParks) {
      await prisma.$executeRawUnsafe(`ALTER SCHEMA "${p.was}" RENAME TO ${p.now}`);
    }
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${park}`);
    await prisma.$executeRawUnsafe(`CREATE TABLE ${park}.audit_trail AS SELECT * FROM public.audit_trail`);

    // 2 + 3. Empty, then load.
    try {
      await resetPublicSchema();
      await runPgRestore(archivePath);
      auditRowsPreserved = await prisma.$transaction(
        async (tx: unknown) => {
          let kept = await preserveUnbackedAuditRows(tx, `${park}.audit_trail`);
          // Then each earlier park, with the same dedupe: only rows the restored
          // trail (and this run's park) do not already hold come back — and never
          // a row a recorded hard delete names, in the restored trail or in any
          // earlier park: a restore must not undo a deletion (2026-10-22).
          const deletionSources = ['audit_trail', ...earlierParks.map((e) => `${e.now}.audit_trail`)];
          for (const p of earlierParks) {
            const skipped = await dropRecordedDeletions(tx, `${p.now}.audit_trail`, deletionSources);
            if (skipped > 0) {
              backupLog.warn({ schema: p.now, was: p.was, skipped },
                'Audit rows an earlier failed restore kept were not carried over: a recorded hard delete names them');
            }
            auditRowsSkippedAsDeleted += skipped;
            const n = await preserveUnbackedAuditRows(tx, `${p.now}.audit_trail`);
            kept += n;
            auditRowsFromEarlierFailedRestore += n;
          }
          // D1 (2026-10-21): pg_restore set audit_trail_chain_position_seq back
          // to its value at dump time, but the rows just carried over sit ABOVE
          // it (BACKUP_CREATED, written after every dump, is always one of them).
          // Without this the next audit row reused a taken chain_position and
          // verify-chain reported the chain broken. Same realignment as the
          // JSON/BAK path; only audit_trail gained rows the archive lacks — the
          // archive's other sequences arrive consistent with its own data.
          await resyncSequencesAfterRestore(tx, ['audit_trail']);
          return kept;
        },
        { timeout: 300_000, maxWait: 30_000 },
      );
      // Every park: this run's, the earlier ones (their rows are back), and any the
      // archive brought with it.
      await dropParkSchemas();
      keepParked = false;
    } catch (restoreErr: unknown) {
      backupLog.error({ err: restoreErr }, 'pg_dump restore failed — rolling back from the safety dump');
      // 4. Put the database back the way we found it.
      let rollbackNote = '';
      try {
        await resetPublicSchema();
        await runPgRestore(safetyPath);
        rollbackNote = ' The database was rolled back to its pre-restore state.';
      } catch (rollbackErr: unknown) {
        backupLog.error({ err: rollbackErr, safetyPath }, 'Rollback from the safety dump ALSO failed');
        rollbackNote =
          ` CRITICAL: the rollback ALSO failed (${restoreFailureReason(rollbackErr)}). The database may be empty.`
          + ` A safety copy was written to ${safetyPath} — do not delete it.`
          + ` The audit trail as it was before the restore is also kept in schema ${park}.`
          + earlierNote();
        // Keep the safety dump on disk, and the parked trail in the database, for manual recovery.
        preserveDir = true;
        keepParked = false;
        throw Object.assign(new Error(`${restoreFailureReason(restoreErr)}${rollbackNote}`), {
          code: 'RESTORE_FAILED_NO_ROLLBACK',
          keepDir: dir,
        });
      }
      throw Object.assign(new Error(`${restoreFailureReason(restoreErr)}${rollbackNote}${earlierNote()}`), { code: 'RESTORE_FAILED' });
    }

    const timestamp = new Date().toISOString();
    await auditLog({
      userId: ctx.userId,
      userRole: ctx.userRole,
      action: 'BACKUP_RESTORED',
      targetType: 'system',
      targetId: 'database_restore',
      afterValue: {
        format: 'dump', timestamp, bytes: fileBuffer.length, auditRowsPreserved,
        ...(earlierParks.length > 0 ? { auditRowsFromEarlierFailedRestore, auditRowsSkippedAsDeleted } : {}),
      },
      signatureMeaning: 'Database restored from pg_dump archive by administrator (full schema + data)',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      sessionId: ctx.sessionId,
    });

    return {
      success: true,
      message: 'Database restored successfully from pg_dump archive.',
      backupTimestamp: timestamp,
      backupVersion: 'pg_dump',
    };
  } finally {
    if (keepParked) {
      // The restore failed (and the database was rolled back) or stopped while
      // parking: drop this run's park and any the archive brought, keep the earlier
      // ones (under either name, in case a rename did not happen). The caller sees
      // the restore's error; a failed drop is logged, not thrown over it.
      await dropParkSchemas(earlierParks.flatMap((p) => [p.was, p.now]))
        .catch((err: unknown) => backupLog.error({ err, schema: park }, 'Could not drop the parked audit trail after a failed restore; drop the schema by hand'));
    }
    // Leave the directory behind only when a failed rollback needs it.
    if (!preserveDir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Build the plain-SQL restore script.
 *
 * Split out of `exportSql` so the generator can be exercised end-to-end (dump →
 * `psql -v ON_ERROR_STOP=1 -f`) without the audit write that `exportSql`
 * performs — verifying a backup must never leave BACKUP_CREATED rows in the
 * live, immutable 21 CFR audit trail.
 */
export async function buildSqlScript(username: string): Promise<{ sqlContent: string; totalRecords: number }> {
  const rawData = await fetchAllTablesRaw();
  const tables = Object.keys(rawData);
  const totalRecords = Object.values(rawData).reduce((sum, arr) => sum + arr.length, 0);

  // Column/constraint metadata the script needs to be replayable by psql.
  const [arrayColumns, selfRefs] = await Promise.all([
    getArrayColumns(),
    getSelfReferencingColumns(),
  ]);

  const sqlParts: string[] = [];
  sqlParts.push('-- DigiLog Database Backup');
  sqlParts.push(`-- Generated: ${new Date().toISOString()}`);
  sqlParts.push(`-- Generated By: ${username}`);
  sqlParts.push(`-- Total Records: ${totalRecords}`);
  sqlParts.push(`-- Format: PostgreSQL SQL`);
  sqlParts.push('--');
  sqlParts.push('-- Restore with:  psql -d <database> -v ON_ERROR_STOP=1 -f <this file>');
  sqlParts.push('-- This script replaces ALL DATA in the target database. It does NOT');
  sqlParts.push('-- create the schema — the target must already have it (run the migrations');
  sqlParts.push('-- first). For a full schema+data restore, use the .dump format instead,');
  sqlParts.push("-- which is also the only format pgAdmin's Restore dialog can read.");
  sqlParts.push('');
  sqlParts.push('BEGIN;');
  sqlParts.push('');

  // ── Fault 3: mirror triggers create rows we are about to insert ourselves ──
  // asset_instances <-> filters/ahus/areas/blocks are kept in sync by
  // trg_mirror_asset_instance_iud / trg_mirror_typed_to_asset_instance. Loading
  // asset_instances fires the mirror, which INSERTs the matching filters rows;
  // the script's own "INSERT INTO filters" then collides with them and dies on
  // filters_pkey. Disabling USER triggers for the load is also what the in-app
  // restore does (backup.repository.ts), and it covers audit_trail's
  // immutability trigger, which would otherwise block the TRUNCATE.
  //
  // DISABLE TRIGGER USER (not ALL) is deliberate: ALL includes the internal
  // constraint triggers that enforce foreign keys and requires SUPERUSER, which
  // the app's `digilog` role is not.
  //
  // The trigger set is computed on the TARGET at restore time, not baked in
  // from the source at backup time. That distinction is load-bearing and was
  // caught by the end-to-end test: this development database is itself missing
  // the mirror triggers, so a source-derived list named only 3 tables and left
  // the mirrors armed on any correctly-migrated target — reintroducing the very
  // duplicate-key failure this is here to prevent. The original per-trigger
  // enabled/disabled state is captured into a temp table and only those that
  // were enabled get re-enabled, so a trigger an operator had deliberately
  // switched off does not come back armed.
  sqlParts.push('-- Suspend user triggers for the load (original state restored at the end).');
  sqlParts.push(`CREATE TEMP TABLE _digilog_trigger_state ON COMMIT DROP AS
SELECT c.relname::text AS tbl, t.tgname::text AS trg, t.tgenabled::text AS enabled
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE NOT t.tgisinternal AND n.nspname = 'public';`);
  sqlParts.push(`DO $digilog$
DECLARE r record;
BEGIN
  FOR r IN SELECT DISTINCT tbl FROM _digilog_trigger_state LOOP
    EXECUTE format('ALTER TABLE %I DISABLE TRIGGER USER', r.tbl);
  END LOOP;
END
$digilog$;`);
  sqlParts.push('');

  // FK-safe order: delete children first, insert parents first
  const deleteOrder = [...tables].reverse();
  for (const table of deleteOrder) {
    sqlParts.push(`TRUNCATE TABLE "${table}" CASCADE;`);
  }
  sqlParts.push('');

  // ── Fault 2: self-referencing FK enforced mid-load ────────────────────────
  // asset_instances.parent_id -> asset_instances.id, and children can be
  // written before their parent exists.
  //
  // NOT fixed with `SET CONSTRAINTS ALL DEFERRED`: that only affects
  // constraints declared DEFERRABLE, and all 47 FKs in this schema are NOT
  // DEFERRABLE (verified against the live database, and reproduced directly —
  // the FK still fires immediately under SET CONSTRAINTS ALL DEFERRED). Making
  // them deferrable would mean altering all 47 on a populated 21 CFR database
  // to fix a file-format bug. Instead the self-referencing column is written
  // NULL and patched up after every row exists — the same two-pass the in-app
  // restore already uses, with no schema change and nothing left weakened.
  const selfRefUpdates: string[] = [];

  for (const table of tables) {
    const rows = rawData[table];
    if (rows.length === 0) {
      sqlParts.push(`-- Table: ${table} (0 rows)`);
      sqlParts.push('');
      continue;
    }
    const columns = Object.keys(rows[0]);
    const tableArrays = arrayColumns[table] ?? {};
    const tableSelfRefs = selfRefs[table] ?? [];
    sqlParts.push(`-- Table: ${table} (${rows.length} rows)`);
    for (const row of rows) {
      const values = columns.map(col => {
        // Self-ref columns go in NULL on pass 1 (see selfRefUpdates below).
        if (tableSelfRefs.includes(col)) return 'NULL';
        return escapeSqlValue(row[col], tableArrays[col]);
      });
      sqlParts.push(
        `INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${values.join(', ')});`,
      );
    }
    // Pass 2 — restore the self-references now that every row is present.
    for (const col of tableSelfRefs) {
      for (const row of rows) {
        if (row[col] == null || row.id == null) continue;
        selfRefUpdates.push(
          `UPDATE "${table}" SET "${col}" = ${escapeSqlValue(row[col])} WHERE "id" = ${escapeSqlValue(row.id)};`,
        );
      }
    }
    sqlParts.push('');
  }

  if (selfRefUpdates.length) {
    sqlParts.push(`-- Self-referencing FKs, applied once every row exists (${selfRefUpdates.length} rows).`);
    sqlParts.push(...selfRefUpdates);
    sqlParts.push('');
  }

  // Re-arm exactly what was armed before, per trigger (not per table), so a
  // deliberately-disabled trigger stays disabled.
  sqlParts.push('-- Restore the trigger state captured at the top of this script.');
  sqlParts.push(`DO $digilog$
DECLARE r record;
BEGIN
  FOR r IN SELECT tbl, trg FROM _digilog_trigger_state WHERE enabled <> 'D' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE TRIGGER %I', r.tbl, r.trg);
  END LOOP;
END
$digilog$;`);
  sqlParts.push('');

  sqlParts.push('COMMIT;');

  return { sqlContent: sqlParts.join('\n'), totalRecords };
}

export async function exportSql(
  username: string,
  ctx: RequestContext,
): Promise<{ sqlContent: string; filename: string }> {
  const { sqlContent, totalRecords } = await buildSqlScript(username);

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

  return { sqlContent, filename: `digilog_backup_${dateStamp()}.sql` };
}

// ---------------------------------------------------------------------------
// Export: CSV format (ZIP archive of per-table CSVs)
// ---------------------------------------------------------------------------

export async function exportCsv(
  username: string,
  ctx: RequestContext,
): Promise<{ zipBuffer: Buffer; filename: string }> {
  const rawData = await fetchAllTablesRaw();
  const tables = Object.keys(rawData);
  const totalRecords = Object.values(rawData).reduce((sum, arr) => sum + arr.length, 0);

  const zip = new AdmZip();

  for (const table of tables) {
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
      tableCount: tables.length,
      totalRecords,
      tables: Object.fromEntries(tables.map(t => [t, rawData[t].length])),
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

/**
 * Audit 2026-09-24 (api #1): restore TRUNCATEs and re-inserts every table —
 * users.password_hash and roles.permissions included — so a hand-edited file
 * is a SUPER_ADMIN takeover for anyone who may restore (ADMIN holds
 * BACKUP_RESTORE live). The plain checksum cannot stop that: it is recomputed
 * by the attacker. Non-SUPER_ADMIN callers may therefore restore ONLY a file
 * this server signed (metadata.signature, HMAC with AUDIT_CHAIN_KEY); SQL / CSV
 * / legacy unsigned JSON, and pg_dump archives, stay SUPER_ADMIN-only.
 */
function assertRestoreAllowedForCaller(ctx: RequestContext, backup: BackupData): void {
  if (ctx.userRole === 'SUPER_ADMIN') return;
  const fmt = backup.metadata.format ?? 'json';
  const signed = (fmt === 'json' || fmt === 'bak') && verifyBackupSignature(backup.metadata, getAuditChainKey());
  if (!signed) {
    throw new AppError(403, 'BACKUP_UNSIGNED',
      'Only a backup file produced by this server (signed JSON/BAK export) can be restored by your role. Other formats and unsigned files require a Super Admin.');
  }
}

export async function restore(
  fileBuffer: Buffer,
  ctx: RequestContext,
  opts: { force?: boolean } = {},
): Promise<{
  success: boolean;
  message: string;
  backupTimestamp: string;
  backupVersion: string;
}> {
  const backup = await parseBackupFile(fileBuffer);

  if (!backup.metadata.version) {
    throw Object.assign(new Error('Backup metadata is incomplete'), {
      code: 'INVALID_METADATA',
    });
  }

  assertRestoreAllowedForCaller(ctx, backup);

  // Checksum verification (skip for SQL/CSV since checksum is computed on import)
  const fmt = backup.metadata.format ?? 'json';
  if (fmt === 'json' || fmt === 'bak') {
    if (!backup.metadata.checksum) {
      throw Object.assign(new Error('Backup metadata is missing checksum'), {
        code: 'INVALID_METADATA',
      });
    }
    const computedChecksum = computeBackupChecksum(backup.data);
    if (computedChecksum !== backup.metadata.checksum) {
      throw Object.assign(new Error(
        'Backup file integrity check failed. The file may have been tampered with or corrupted.',
      ), { code: 'CHECKSUM_MISMATCH' });
    }
  }

  // Audit 2026-05-04 fix #7: pass force-flag through to restoreFromBackup so
  // a tampered audit_trail chain is refused unless the operator explicitly
  // overrides. Force is itself audited in the BACKUP_RESTORED row below
  // (afterValue.forced=true).
  const auditRowsPreserved = await restoreFromBackup(backup, { force: opts.force });

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
      forced: opts.force === true,
      // F5 (2026-09-25): live audit rows the backup lacked, kept through the restore.
      auditRowsPreserved,
    },
    signatureMeaning: opts.force
      ? 'Database restored from backup by administrator (audit-chain verification BYPASSED)'
      : 'Database restored from backup by administrator',
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
  checksumSupported: boolean;
  totalRecords: number;
  auditChain: BackupChainReport | null;
}> {
  // pg_dump custom archives are binary and start with "PGDMP". They cannot be
  // parsed as rows — their integrity is pg_restore's business — but they MUST
  // report valid here, because the UI validates before it will let the operator
  // restore. Without this branch a .dump upload failed with INVALID_JSON and
  // the new format would have been unusable from the page.
  if (fileBuffer.subarray(0, 5).toString('latin1') === 'PGDMP') {
    return {
      valid: true,
      metadata: {
        version: 'pg_dump',
        timestamp: new Date().toISOString(),
        generatedBy: 'pg_dump',
        tableCount: 0,
        checksum: '',
        format: 'dump',
      },
      tableSummary: {},
      // No independent digest exists for an archive — pg_restore validates its
      // own internal structure on load. Reported honestly rather than as a
      // green "VALID" that means nothing (same reasoning as SQL/CSV below).
      checksumValid: false,
      checksumSupported: false,
      totalRecords: 0,
      auditChain: null,
    };
  }

  const backup = await parseBackupFile(fileBuffer);

  // #low-batch: the checksum is only an INDEPENDENT integrity check for json/bak,
  // whose digest is stored in the file. SQL/CSV synthesize the checksum FROM the
  // parsed data at import time (parseSqlBackup/parseCsvZipBackup), so comparing it
  // to a fresh recompute is a self-comparison that is always true — it verifies
  // nothing. The restore path already skips the checksum for those formats; report
  // it honestly here too via `checksumSupported` instead of a false "VALID".
  const fmt = backup.metadata.format ?? 'json';
  const checksumSupported = fmt === 'json' || fmt === 'bak';
  const checksumValid = checksumSupported
    ? computeBackupChecksum(backup.data) === backup.metadata.checksum
    : false;

  const tableSummary: Record<string, number> = {};
  for (const [key, value] of Object.entries(backup.data)) {
    if (Array.isArray(value)) tableSummary[key] = value.length;
  }

  // Run the SAME audit-chain walk the restore path runs, so the operator learns
  // about chain anomalies on the validate step instead of discovering them as a
  // hard failure after committing to a restore. Read-only — reports, never throws.
  // Normalize first — older backups key this table `auditTrail` with camelCase
  // row keys, and reading `audit_trail` raw would report "no audit rows" on
  // exactly the old files most likely to have chain problems.
  const auditRows = normalizeBackupKeys(backup.data)?.audit_trail;
  const auditChain = Array.isArray(auditRows) && auditRows.length > 0
    ? await verifyBackupAuditChain(auditRows)
    : null;

  return {
    // json/bak: a tampered file (checksum mismatch) is NOT valid. SQL/CSV: no
    // independent checksum exists, but a parseable file is still restorable.
    valid: checksumSupported ? checksumValid : true,
    metadata: backup.metadata,
    tableSummary,
    checksumValid,
    checksumSupported,
    totalRecords: Object.values(tableSummary).reduce((s, n) => s + n, 0),
    auditChain,
  };
}
