import { PrismaClient, type Prisma } from '@prisma/client';
import { getLogger } from './logger.js';

/**
 * Log type 4 — the database channel.
 *
 * Answers "is the DB reachable, and what is slow?". Prisma's own events were
 * previously routed to the console, which in the packaged Windows service meant
 * they landed in a JSON blob nobody reads. They now go to
 * `logs/app/database/` in plain text, and every warning/error is duplicated
 * into `logs/app/error/`.
 */
const dbLog = getLogger('prisma', 'database');

/**
 * Queries slower than this are logged. 500 ms is deliberately generous: this is
 * a fault-finding aid, not a profiler, and a threshold low enough to fire on
 * normal traffic would bury the connection errors that actually matter.
 * Override with SLOW_QUERY_MS.
 */
const SLOW_QUERY_MS = Number(process.env.SLOW_QUERY_MS) > 0
  ? Number(process.env.SLOW_QUERY_MS)
  : 500;

/**
 * Query events are emitted rather than printed so we can apply the threshold —
 * `log: ['query']` would print every single query and drown the channel. In
 * production we do not subscribe to `query` at all.
 */
const logDefinition: Prisma.LogDefinition[] = [
  { level: 'warn', emit: 'event' },
  { level: 'error', emit: 'event' },
  ...(process.env.NODE_ENV === 'production'
    ? []
    : ([{ level: 'query', emit: 'event' }] as Prisma.LogDefinition[])),
];

export const prisma = new PrismaClient({ log: logDefinition });

prisma.$on('warn' as never, (e: Prisma.LogEvent) => {
  dbLog.warn({ target: e.target }, e.message);
});

prisma.$on('error' as never, (e: Prisma.LogEvent) => {
  dbLog.error({ target: e.target }, e.message);
});

if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query' as never, (e: Prisma.QueryEvent) => {
    if (e.duration >= SLOW_QUERY_MS) {
      dbLog.warn(
        { durationMs: e.duration, query: e.query, params: e.params },
        `Slow query (${e.duration}ms)`,
      );
    }
  });
}

/**
 * Probe the connection and record the outcome.
 *
 * This is the line an operator looks for when the app "isn't working": it
 * states, at boot, whether the database was reachable and which database it
 * is — a wrong DATABASE_URL and a stopped Postgres service present identically
 * from the UI, and differently here.
 *
 * Returns rather than throws: `/api/health` already reports DB state, and a
 * database that is briefly down during service start (DigiLogDB and DigiLogAPI
 * start together, with only a service dependency ordering them) must not
 * prevent the API from coming up and retrying.
 */
export async function logDatabaseConnection(): Promise<boolean> {
  const startedAt = Date.now();
  try {
    const rows = await prisma.$queryRaw<
      Array<{ db: string; usr: string; version: string }>
    >`SELECT current_database() AS db, current_user AS usr, version() AS version`;
    const info = rows[0];
    dbLog.info(
      {
        database: info?.db,
        user: info?.usr,
        // version() is a long banner; the first three words are the useful part.
        server: info?.version?.split(' ').slice(0, 2).join(' '),
        connectMs: Date.now() - startedAt,
        slowQueryThresholdMs: SLOW_QUERY_MS,
      },
      `Database connected (${info?.db})`,
    );
    return true;
  } catch (err) {
    dbLog.error(
      { err, connectMs: Date.now() - startedAt },
      'DATABASE CONNECTION FAILED — check that the DigiLogDB service is running and DATABASE_URL is correct',
    );
    return false;
  }
}

/** Logged on graceful shutdown so an unexpected disconnect is distinguishable. */
export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    dbLog.info('Database disconnected cleanly');
  } catch (err) {
    dbLog.warn({ err }, 'Error while disconnecting from database');
  }
}
