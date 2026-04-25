import {CapacitorSQLite, SQLiteConnection} from '@capacitor-community/sqlite';
import {CURRENT_SCHEMA_VERSION, SCHEMA_SQL} from './sqllite-schema';

const DB_NAME = 'digilog_offline';
const sqlite = new SQLiteConnection(CapacitorSQLite);
let dbConnection: any = null;

async function openDB() {
    if (dbConnection) {
        return dbConnection;
    }

    // Clean up any stale connections left over from a previous page load
    // (Capacitor SQLite keeps a connection pool at the native layer; after
    // a hot-reload or app backgrounding, entries can become inconsistent).
    try {
        await sqlite.checkConnectionsConsistency();
    } catch { /* first run — nothing to reconcile */ }

    const isConn = (await sqlite.isConnection(DB_NAME, false)).result;
    dbConnection = isConn
        ? await sqlite.retrieveConnection(DB_NAME, false)
        : await sqlite.createConnection(DB_NAME, false, 'no-encryption', 1, false);

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

/**
 * Quick stats about what's currently in the offline DB.
 * Useful from DevTools to decide whether to reset.
 *
 *   await (await import('/src/lib/sqllite-db.ts')).getOfflineStats()
 */
export async function getOfflineStats(): Promise<{
    pendingOps: number; syncingOps: number; failedOps: number; syncedOps: number;
    filterCount: number; cacheEntries: number; filterStates: number;
}> {
    const db = await openDB();
    const one = async (sql: string): Promise<number> => {
        const rows = (await db.query(sql)).values ?? [];
        return (rows[0]?.n as number) ?? 0;
    };
    return {
        pendingOps:   await one(`SELECT COUNT(*) as n FROM operations WHERE status='pending'`),
        syncingOps:   await one(`SELECT COUNT(*) as n FROM operations WHERE status='syncing'`),
        failedOps:    await one(`SELECT COUNT(*) as n FROM operations WHERE status='failed'`),
        syncedOps:    await one(`SELECT COUNT(*) as n FROM operations WHERE status='synced'`),
        filterCount:  await one(`SELECT COUNT(*) as n FROM filters`),
        cacheEntries: await one(`SELECT COUNT(*) as n FROM reference_cache`),
        filterStates: await one(`SELECT COUNT(*) as n FROM filter_state`),
    };
}

/**
 * Wipe ALL offline data. DEV-ONLY helper invoked from DevTools.
 *
 * SAFETY: Refuses if unsynced operations exist (pending/syncing) unless
 * { force: true }. Unsynced ops are offline 21 CFR audit events that
 * have not yet reached the server — silent deletion would lose audit trail.
 *
 * Production tablets do NOT expose this in the UI. Real reset on a
 * deployed tablet is handled by IT via:
 *   adb shell pm clear com.digilog.filtermanagement
 *
 * DevTools usage:
 *   (async () => {
 *     const m = await import('/src/lib/sqllite-db.ts');
 *     console.log(await m.getOfflineStats());
 *     await m.resetOfflineDB();            // safe — throws if unsynced
 *     // await m.resetOfflineDB({ force: true }); // nuclear override
 *     location.reload();
 *   })();
 */
export async function resetOfflineDB(opts: { force?: boolean } = {}): Promise<void> {
    const stats = await getOfflineStats();
    const unsynced = stats.pendingOps + stats.syncingOps;
    if (unsynced > 0 && !opts.force) {
        throw new Error(
            `Refusing to reset: ${unsynced} unsynced operation(s) exist. ` +
            `Sync first, or pass { force: true } to override.`
        );
    }
    const db = await openDB();
    await db.execute(`DELETE FROM operations;`);
    await db.execute(`DELETE FROM filter_state;`);
    await db.execute(`DELETE FROM filters;`);
    await db.execute(`DELETE FROM reference_cache;`);
    // schema_version left alone — schema is still valid after a reset.
}

/**
 * Clear ONLY the cached master data (checklist profiles, cleaning reasons,
 * templates, identifier map, cleaning profiles). Operations queue and
 * filter_state remain intact.
 *
 * Safe to call anytime — zero 21 CFR risk. Next online login re-populates
 * via syncAllDataForOffline().
 */
export async function clearCachedMasterData(): Promise<void> {
    const db = await openDB();
    await db.execute(`DELETE FROM reference_cache;`);
}