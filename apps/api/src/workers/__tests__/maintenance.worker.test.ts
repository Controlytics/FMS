import { describe, it, expect, vi } from 'vitest';

// Mock the underlying business-logic modules so the task functions can run
// without requiring a Prisma client, TSDB pool, or Redis.
vi.mock('../../modules/data-ingestion/dlq-manager.js', () => ({
  processDLQ: vi.fn(async () => ({ processed: 0, retried: 0 })),
}));
vi.mock('../../modules/data-ingestion/connectivity-tracker.js', () => ({
  checkInactivityTimeouts: vi.fn(async () => 0),
}));
vi.mock('../maintenance-retention.js', () => ({
  runRetentionCleanup: vi.fn(async () => ({ enabled: false, results: [] })),
}));
// The barrel re-exports start/stopMaintenanceWorker from the BullMQ sibling,
// which pulls in `bullmq` + Redis at module load. Stub bullmq the same way the
// other worker tests do so the import resolves without a Redis connection.
vi.mock('bullmq', () => ({
  Worker: class {
    on() {}
    async close() {}
  },
  Queue: class {
    async add() {
      return { id: 'job-1' };
    }
    async close() {}
  },
}));
vi.mock('@digilog/queue', () => ({
  getQueueConnection: vi.fn(),
  getWorkerConnection: vi.fn(),
  QUEUES: {
    MAINTENANCE: { name: 'maintenance', defaultJobOptions: {} },
  },
}));

import {
  dlqCheckTask,
  connectivityCheckTask,
  retentionCleanupTask,
} from '../maintenance.worker.js';

describe('maintenance task functions (graphile-worker)', () => {
  const helpers = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as never;

  it('dlqCheckTask logs the processDLQ result', async () => {
    await expect(dlqCheckTask(undefined, helpers)).resolves.not.toThrow();
  });

  it('connectivityCheckTask logs the offlineCount', async () => {
    await expect(connectivityCheckTask(undefined, helpers)).resolves.not.toThrow();
  });

  it('retentionCleanupTask logs the cleanup result', async () => {
    await expect(retentionCleanupTask(undefined, helpers)).resolves.not.toThrow();
  });
});
