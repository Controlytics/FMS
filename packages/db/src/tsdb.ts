import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getTsdbPool(): pg.Pool {
  if (!pool) {
    const user = process.env.TSDB_USER;
    const password = process.env.TSDB_PASSWORD;
    if (process.env.NODE_ENV === 'production' && (!user || !password)) {
      throw new Error('[TSDB] TSDB_USER and TSDB_PASSWORD env vars required in production');
    }
    pool = new Pool({
      host: process.env.TSDB_HOST ?? 'localhost',
      port: parseInt(process.env.TSDB_PORT ?? '5433', 10),
      database: process.env.TSDB_DATABASE ?? 'digilog_tsdb',
      user: user ?? 'digilog_app',
      password: password ?? 'tsdb_secret',
      min: parseInt(process.env.TSDB_POOL_MIN ?? '2', 10),
      max: parseInt(process.env.TSDB_POOL_MAX ?? '20', 10),
      connectionTimeoutMillis: parseInt(process.env.TSDB_CONNECTION_TIMEOUT ?? '5000', 10),
      idleTimeoutMillis: parseInt(process.env.TSDB_IDLE_TIMEOUT ?? '30000', 10),
    });

    pool.on('error', (err) => {
      console.error('[TSDB] Unexpected pool error:', err.message);
      pool = null; // Force recreation on next getTsdbPool() call
    });
  }
  return pool;
}

export async function healthCheck(): Promise<boolean> {
  const p = getTsdbPool();
  try {
    const result = await p.query('SELECT 1');
    return result.rowCount === 1;
  } catch (err) {
    console.error('[TSDB] Health check failed:', err);
    return false;
  }
}

export async function closeTsdbPool(): Promise<void> {
  if (pool) {
    try {
      await pool.end();
    } catch (err) {
      console.error('[TSDB] Error closing pool:', err);
    } finally {
      pool = null;
    }
  }
}
