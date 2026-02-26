import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getTsdbPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.TSDB_HOST ?? 'localhost',
      port: parseInt(process.env.TSDB_PORT ?? '5433', 10),
      database: process.env.TSDB_DATABASE ?? 'digilog_tsdb',
      user: process.env.TSDB_USER ?? 'digilog_app',
      password: process.env.TSDB_PASSWORD ?? 'tsdb_secret',
      max: parseInt(process.env.TSDB_POOL_MAX ?? '20', 10),
    });
  }
  return pool;
}

export async function closeTsdbPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
