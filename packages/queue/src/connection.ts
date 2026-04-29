import {
  makeWorkerUtils,
  type WorkerUtils,
  type RunnerOptions,
  type TaskList,
} from 'graphile-worker';

// graphile-worker producer + runner factories.
//
// Phase 2 of the windows-friendly rewrite (see docs/plans/2026-04-29-windows-friendly-rewrite.md
// § Task 2.2) introduces a Postgres-backed job queue alongside the legacy BullMQ-on-Redis path.
// During the migration window the BullMQ exports are still re-exported below from
// connection.bullmq.ts so existing call sites compile until they migrate one at a time
// (Tasks 2.3 – 2.7). They are removed entirely in Task 2.10.

export interface DigilogRunnerOptions {
  taskList: TaskList;
  concurrency?: number;
}

/**
 * Resolve the queue's Postgres connection string.
 *
 * Read lazily (i.e. each call) rather than captured at module-import time, so test code that
 * sets `process.env.DATABASE_URL` inside a `beforeAll` hook still gets picked up. This is a
 * deliberate deviation from the plan's spec (which captured the value at module scope).
 */
function getQueueDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_QUEUE ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[queue] DATABASE_URL_QUEUE or DATABASE_URL must be set for the graphile-worker queue connection',
    );
  }
  return url;
}

let cachedProducer: WorkerUtils | null = null;

export async function getProducer(): Promise<WorkerUtils> {
  if (!cachedProducer) {
    cachedProducer = await makeWorkerUtils({ connectionString: getQueueDatabaseUrl() });
  }
  return cachedProducer;
}

export function getRunnerOptions(input: DigilogRunnerOptions): RunnerOptions {
  return {
    connectionString: getQueueDatabaseUrl(),
    concurrency: input.concurrency ?? 10,
    pollInterval: 1000,
    taskList: input.taskList,
  };
}

export async function closeProducer(): Promise<void> {
  if (cachedProducer) {
    await cachedProducer.release();
    cachedProducer = null;
  }
}

// --- BullMQ-compatible shims (kept during migration; removed in Task 2.10) ---
export {
  getQueueConnection,
  getWorkerConnection,
  getRedisConnection,
  closeRedisConnection,
} from './connection.bullmq.js';
