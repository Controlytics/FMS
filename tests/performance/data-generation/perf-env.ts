/**
 * Safety bootstrap shared by the perf data-generation scripts.
 *
 * MUST be imported (and `bootstrapPerfEnv()` called) BEFORE any app module:
 * apps/api/src/lib/prisma.ts builds its PrismaClient at import time from
 * process.env.DATABASE_URL, so the URL has to be the perf one by then.
 *
 * Order:
 *   1. Resolve the target URL (--db-url, else PERF_DATABASE_URL, else the default perf URL).
 *   2. Refuse unless the database name ends in `_perf` — BEFORE anything connects.
 *   3. Pin process.env.DATABASE_URL to it, THEN load apps/api/.env with dotenv
 *      (dotenv never overrides a variable that is already set) for
 *      AUDIT_CHAIN_KEY / AUDIT_CHAIN_KEYED_FROM / BCRYPT_ROUNDS.
 *   4. Re-check DATABASE_URL after dotenv (belt and braces).
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const API_DIR = path.join(REPO_ROOT, 'apps', 'api');
export const RESULTS_DIR = path.join(REPO_ROOT, 'tests', 'performance', 'results');

const DEFAULT_PERF_URL = 'postgresql://digilog:digilog123@localhost:5432/digilog_perf?schema=public';

export function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1];
  const eq = process.argv.find(a => a.startsWith(name + '='));
  return eq ? eq.slice(name.length + 1) : undefined;
}
export function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

export function databaseNameOf(url: string): string {
  let u: URL;
  try { u = new URL(url); } catch { throw new Error(`Refusing to run: connection string is not a valid URL.`); }
  return decodeURIComponent(u.pathname.replace(/^\//, ''));
}

export function assertPerfDbName(name: string): void {
  if (!/_perf$/.test(name)) {
    throw new Error(`Refusing to run: database "${name}" does not end in "_perf". These scripts write synthetic data and may only target a disposable *_perf clone.`);
  }
}

export function bootstrapPerfEnv(): { url: string; dbName: string } {
  const url = argValue('--db-url') ?? process.env.PERF_DATABASE_URL ?? DEFAULT_PERF_URL;
  const dbName = databaseNameOf(url);
  assertPerfDbName(dbName);                       // throws BEFORE any connection exists

  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'production';            // no per-query Prisma event subscription
  process.env.LOG_DIR = process.env.LOG_DIR ?? path.join(RESULTS_DIR, 'logs', 'data-generation');

  const req = createRequire(path.join(API_DIR, 'package.json'));
  const dotenv = req('dotenv') as typeof import('dotenv');
  dotenv.config({ path: path.join(API_DIR, '.env') });   // does not override DATABASE_URL

  if (process.env.DATABASE_URL !== url) throw new Error('DATABASE_URL changed after loading .env — refusing to run.');
  assertPerfDbName(databaseNameOf(process.env.DATABASE_URL));
  return { url, dbName };
}

/** After connecting: the server must agree it is a *_perf database. */
export async function assertConnectedToPerf(prisma: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }): Promise<string> {
  const rows = await prisma.$queryRaw`SELECT current_database() AS db` as Array<{ db: string }>;
  const db = rows[0]?.db ?? '';
  assertPerfDbName(db);
  return db;
}
