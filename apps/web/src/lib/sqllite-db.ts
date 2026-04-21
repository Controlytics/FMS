import {CapacitorSQLite, SQLiteConnection} from '@capacitor-community/sqlite';
import {CURRENT_SCHEMA_VERSION, SCHEMA_SQL} from './sqllite-schema';

const DB_NAME = 'digilog_offline';
const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbConnection: any = null;

async function openDB() {
    if (dbConnection) {
        return dbConnection;
    }

    const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
    dbConnection = isConn ? await sqlite.retrieveConnection(DB_NAME, false) : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1,false);

    await dbConnection.open();
    await runMigrations();
    return dbConnection;
}

async function runMigrations() {
    for (const sql of SCHEMA_SQL) {
        await dbConnection.execute(sql);
    }

    await dbConnection.run(
        `INSERT OR IGNORE INTO schema_version (version, applied_at) VALUES (?, ?)`,
        [CURRENT_SCHEMA_VERSION, new Date().toISOString()]
    );
}

export async function dbRun(sql: string, params: any[] = []) {
    const db = await openDB();
    return db.run(sql, params);
}

export async function dbQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const db = await openDB();
    const res = await db.query(sql, params);
    return res.values ?? [];
}

export async function dbQueryOne<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await dbQuery<T>(sql, params);
    return rows[0] ?? null;
}

export async function dbTransaction(statements: { statement: string; values?: any[] }[]) {
    const db = await openDB();
    return db.executeSet(statements);
}

/**
 * Initialize the offline SQLite database.
 * Call once at app startup (from main.tsx). Idempotent — safe to call multiple times.
 */
export async function initOfflineDB(): Promise<void> {
    await openDB();
}

export async function closeDB() {
    if (dbConnection) {
        await sqlite.closeConnection(DB_NAME, false);
        dbConnection = null;
    }
}