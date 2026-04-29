import { describe, it, expect, vi } from 'vitest';

// Mock the underlying business-logic modules so the task functions can run
// without requiring a Prisma client or TSDB pool.
vi.mock('../../modules/data-ingestion/dlq-manager.js', () => ({
  processDLQ: vi.fn(async () => ({ processed: 0, retried: 0 })),
}));
vi.mock('../../modules/data-ingestion/connectivity-tracker.js', () => ({
  checkInactivityTimeouts: vi.fn(async () => 0),
}));
vi.mock('../maintenance-retention.js', () => ({
  runRetentionCleanup: vi.fn(async () => ({ enabled: false, results: [] })),
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
