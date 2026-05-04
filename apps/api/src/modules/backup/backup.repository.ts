import { prisma } from '../../lib/prisma.js';
import type { BackupData } from './backup.helpers.js';

// ---------------------------------------------------------------------------
// Dynamic table discovery
// ---------------------------------------------------------------------------

/** Tables that should not be backed up/restored (Prisma internals, etc.) */
const EXCLUDED_TABLES = new Set(['_prisma_migrations']);

/**
 * List every user table in the public schema at call time.
 * Returned in FK-safe insert order (parent tables before children).
 * The reverse of this order is FK-safe for delete/truncate.
 */
export async function getAllTables(): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = rows
    .map(r => r.tablename)
    .filter(name => !EXCLUDED_TABLES.has(name));

  const fks = await getForeignKeys(tables);
  return topologicalSort(tables, fks);
}

/** For each table, list the tables it references via foreign keys. */
async function getForeignKeys(tables: string[]): Promise<Record<string, string[]>> {
  const rows = await prisma.$queryRawUnsafe<{ table_name: string; referenced_table: string }[]>(
    `
    SELECT tc.table_name, ccu.table_name AS referenced_table
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    `,
  );
  const tableSet = new Set(tables);
  const deps: Record<string, string[]> = {};
  for (const t of tables) deps[t] = [];
  for (const r of rows) {
    if (r.table_name === r.referenced_table) continue; // self-reference handled separately
    if (!tableSet.has(r.table_name) || !tableSet.has(r.referenced_table)) continue;
    if (!deps[r.table_name].includes(r.referenced_table)) {
      deps[r.table_name].push(r.referenced_table);
    }
  }
  return deps;
}

/** Find nullable self-referencing FK columns (must be NULLed on first insert, set in a second pass). */
async function getSelfRefColumns(tables: string[]): Promise<Record<string, string[]>> {
  const rows = await prisma.$queryRawUnsafe<{ table_name: string; column_name: string; is_nullable: string }[]>(
    `
    SELECT kcu.table_name, kcu.column_name, c.is_nullable
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    JOIN information_schema.columns c
      ON c.table_schema = kcu.table_schema
     AND c.table_name = kcu.table_name
     AND c.column_name = kcu.column_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = ccu.table_name
    `,
  );
  const tableSet = new Set(tables);
  const result: Record<string, string[]> = {};
  for (const r of rows) {
    if (!tableSet.has(r.table_name)) continue;
    if (r.is_nullable !== 'YES') continue; // non-nullable self-refs can't be NULLed; give up on those
    if (!result[r.table_name]) result[r.table_name] = [];
    if (!result[r.table_name].includes(r.column_name)) {
      result[r.table_name].push(r.column_name);
    }
  }
  return result;
}

/**
 * Kahn's algorithm — returns tables ordered so every table appears AFTER all
 * tables it depends on. Tables in self-referential or cyclic FK groups end up
 * in the trailing block; FK bypass during restore handles those safely.
 */
function topologicalSort(tables: string[], deps: Record<string, string[]>): string[] {
  const remaining = new Set(tables);
  const sorted: string[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining].filter(t => deps[t].every(d => !remaining.has(d)));
    if (ready.length === 0) {
      // Cycle — append whatever is left in stable order
      sorted.push(...[...remaining].sort());
      break;
    }
    ready.sort();
    for (const t of ready) {
      sorted.push(t);
      remaining.delete(t);
    }
  }
  return sorted;
}

// ---------------------------------------------------------------------------
// Fetch all data (raw SQL, snake_case table + column names)
// ---------------------------------------------------------------------------

/**
 * Walk a row object and stringify any BigInt values in place.
 *
 * Audit 2026-05-04 fix C3 added a BIGSERIAL chain_position column on
 * audit_trail; the pg driver returns BIGSERIAL as native BigInt which
 * JSON.stringify (used by every export format + by Fastify's serializer
 * + by computeBackupChecksum) cannot serialize. Stringifying at the
 * source keeps every downstream consumer JSON-clean without scattering
 * replacers across each call site.
 *
 * Stringify is the safest representation: numbers > 2^53 lose precision
 * if cast to Number; strings preserve full bigint width and Postgres
 * accepts the textual form on insert (cast back to bigint by the column).
 */
function stringifyBigInts(rows: Record<string, any>[]): Record<string, any>[] {
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      const v = row[k];
      if (typeof v === 'bigint') row[k] = v.toString();
    }
  }
  return rows;
}

export async function fetchAllTablesRaw(): Promise<Record<string, Record<string, any>[]>> {
  const tables = await getAllTables();
  const result: Record<string, Record<string, any>[]> = {};
  for (const table of tables) {
    const orderClause = table === 'audit_trail' ? ' ORDER BY id ASC' : '';
    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "${table}"${orderClause}`,
    ) as Record<string, any>[];
    result[table] = stringifyBigInts(rows);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Restore — dynamic; truncates everything and inserts in FK-safe topological
// order, with a second pass for nullable self-referencing columns.
// ---------------------------------------------------------------------------

export async function restoreFromBackup(backup: BackupData): Promise<void> {
  // Normalize older camelCase-keyed backups to snake_case
  const data = normalizeBackupKeys(backup.data);
  const dbTables = await getAllTables();
  const dbTableSet = new Set(dbTables);
  const selfRefs = await getSelfRefColumns(dbTables);

  // Only restore tables that exist in both the backup and the current DB
  const restoreTables = dbTables.filter(t => Array.isArray(data[t]));

  await prisma.$transaction(async (tx: any) => {
    // Disable audit-trail immutability triggers if present (they're user triggers, so non-superusers can toggle them)
    const triggers: any[] = await tx.$queryRawUnsafe(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = '"audit_trail"'::regclass AND tgname IN ('audit_trail_no_update', 'audit_trail_no_delete')`,
    );
    for (const t of triggers) {
      await tx.$executeRawUnsafe(`ALTER TABLE "audit_trail" DISABLE TRIGGER "${t.tgname}"`);
    }

    // Truncate every DB table in one statement — CASCADE handles all FKs in a single pass
    await tx.$executeRawUnsafe(
      `TRUNCATE TABLE ${dbTables.map(t => `"${t}"`).join(', ')} CASCADE`,
    );

    // Insert in FK-safe order. Self-referential rows are inserted in two passes:
    //   1) INSERT with the self-ref column(s) NULLed out
    //   2) UPDATE to set the real self-ref values
    for (const table of restoreTables) {
      const rows = data[table];
      if (!rows || rows.length === 0) continue;
      const selfRefCols = selfRefs[table] ?? [];
      await insertRows(tx, table, rows, selfRefCols);
      if (selfRefCols.length > 0) {
        await fixupSelfRefs(tx, table, rows, selfRefCols);
      }
    }

    // Warn on backup tables not present in the DB (e.g., migrated-out tables)
    for (const key of Object.keys(data)) {
      if (!dbTableSet.has(key) && !EXCLUDED_TABLES.has(key)) {
        console.warn(`[backup/restore] Skipping unknown table in backup: ${key}`);
      }
    }

    // Re-enable audit-trail immutability triggers
    for (const t of triggers) {
      await tx.$executeRawUnsafe(`ALTER TABLE "audit_trail" ENABLE TRIGGER "${t.tgname}"`);
    }
  }, { timeout: 300_000, maxWait: 30_000 });
}

/**
 * After a self-referential table has been populated (with self-ref columns NULLed),
 * fill in the actual self-ref values. Uses jsonb_populate_recordset so PostgreSQL
 * handles all type coercion (UUID, etc.) from the table's column definitions.
 */
async function fixupSelfRefs(
  tx: any,
  table: string,
  rows: Record<string, any>[],
  selfRefCols: string[],
) {
  // Keep only id + the self-ref columns per row
  const payload = rows
    .filter(r => r['id'] !== undefined && r['id'] !== null)
    .map(r => {
      const out: Record<string, any> = { id: r['id'] };
      for (const col of selfRefCols) {
        if (r[col] !== undefined && r[col] !== null) out[col] = r[col];
      }
      return out;
    })
    .filter(r => selfRefCols.some(c => r[c] !== undefined));

  if (payload.length === 0) return;

  const setClause = selfRefCols.map(c => `"${c}" = s."${c}"`).join(', ');

  const BATCH = 500;
  for (let start = 0; start < payload.length; start += BATCH) {
    const batch = payload.slice(start, start + BATCH);
    const json = JSON.stringify(batch);
    await tx.$executeRawUnsafe(
      `UPDATE "${table}" t
         SET ${setClause}
       FROM jsonb_populate_recordset(null::"${table}", $1::jsonb) s
       WHERE t.id = s.id`,
      json,
    );
  }
}

async function insertRows(
  tx: any,
  table: string,
  rows: Record<string, any>[],
  nullOutColumns: string[] = [],
) {
  if (rows.length === 0) return;

  // Discover actual columns on the target table — skip keys that don't exist
  const colRows: { column_name: string }[] = await tx.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    table,
  );
  const dbColSet = new Set(colRows.map(c => c.column_name));
  const nullSet = new Set(nullOutColumns);

  // Strip unknown columns; null out self-refs on the first pass
  const processed = rows.map(row => {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(row)) {
      if (!dbColSet.has(k)) continue;
      out[k] = nullSet.has(k) ? null : v;
    }
    return out;
  });

  // jsonb_populate_recordset handles all type coercion (uuid, timestamptz, enum, jsonb, arrays)
  // via each column's text input function — one query per batch with a single JSON parameter.
  const BATCH = 500;
  for (let start = 0; start < processed.length; start += BATCH) {
    const batch = processed.slice(start, start + BATCH);
    const json = JSON.stringify(batch);
    await tx.$executeRawUnsafe(
      `INSERT INTO "${table}" SELECT * FROM jsonb_populate_recordset(null::"${table}", $1::jsonb)`,
      json,
    );
  }
}

// ---------------------------------------------------------------------------
// Legacy — no-op kept for call-site compatibility; UUID PKs have no sequences
// ---------------------------------------------------------------------------
export async function resetAuditSequence(): Promise<void> {
  // No-op: audit_trail uses UUID primary key, no sequence to reset
}

// ---------------------------------------------------------------------------
// Backward compat: older backups used Prisma camelCase keys. Convert to snake_case
// so they flow through the raw-SQL restore path unchanged.
// ---------------------------------------------------------------------------

function toSnakeCase(s: string): string {
  const out = s.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
  return out.startsWith('_') ? out.slice(1) : out;
}

function normalizeBackupKeys(data: Record<string, any[]>): Record<string, any[]> {
  const hasCamelCase = Object.keys(data).some(k => /[A-Z]/.test(k))
    || Object.values(data).some(rows =>
      Array.isArray(rows) && rows.length > 0 && Object.keys(rows[0]).some(k => /[A-Z]/.test(k)),
    );
  if (!hasCamelCase) return data;

  const result: Record<string, any[]> = {};
  for (const [tableKey, rows] of Object.entries(data)) {
    const snakeTable = toSnakeCase(tableKey);
    if (!Array.isArray(rows)) {
      result[snakeTable] = rows;
      continue;
    }
    result[snakeTable] = rows.map(row => {
      const out: Record<string, any> = {};
      for (const [col, val] of Object.entries(row)) {
        out[toSnakeCase(col)] = val;
      }
      return out;
    });
  }
  return result;
}
