import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 2 Task 2.4: enqueueNotificationJob branch test.
 *
 * Mirrors the producer-only test added for enqueueIngestionJob in Task 2.3.
 * Verifies the USE_PG_QUEUE branch routes to graphile-worker's `addJob` and
 * the legacy branch routes to BullMQ's `Queue.add`.
 *
 * NOTE on cache reset: enqueueNotificationJob caches a single BullMQ Queue
 * instance via the module-scoped `bullmqNotificationQueue` singleton. The
 * mock factory below always returns the SAME `mockBullMqAdd` reference, so
 * even if the cache survives across tests, `mockReset()` still hits the live
 * function. (We tried `vi.resetModules()` + dynamic import but it disables
 * vi.mock for `@digilog/db`, which vitest-vite can't resolve as a workspace
 * package — same constraint dlq-manager.test.ts hit during Task 2.3 review.)
 */

const {
  mockAddJob,
  mockBullMqAdd,
  mockRelease,
  mockClose,
  mockGetProducer,
  mockGetRedisConnection,
} = vi.hoisted(() => ({
  mockAddJob: vi.fn(),
  mockBullMqAdd: vi.fn(),
  mockRelease: vi.fn(),
  mockClose: vi.fn(),
  mockGetProducer: vi.fn(),
  mockGetRedisConnection: vi.fn(),
}));

vi.mock('@digilog/queue', () => ({
  getProducer: mockGetProducer,
  getRedisConnection: mockGetRedisConnection,
  QUEUES: {
    INGESTION: {
      name: 'ingestion',
      defaultJobOptions: { attempts: 3, removeOnComplete: true, removeOnFail: false },
    },
    NOTIFICATION: {
      name: 'notification',
      defaultJobOptions: { attempts: 3, removeOnComplete: true, removeOnFail: false },
    },
  },
  JOB_PRIORITY: {
    ALARM_PROCESSING: 2,
    TELEMETRY: 5,
  },
}));

vi.mock('bullmq', () => ({
  Queue: class MockQueue {
    add = mockBullMqAdd;
    close = mockClose;
  },
}));

// Mock @digilog/db so we don't trigger live Postgres/Timescale calls during
// import (matches the pattern in ingestion.service.test.ts). Requires that
// `packages/db` is built (`npx tsc -p packages/db/tsconfig.json`); vitest-vite
// resolves the workspace package via its `dist/` entry.
vi.mock('@digilog/db', () => ({
  flushAll: vi.fn(),
  addDeviceEventRow: vi.fn(),
}));

// Stub prisma so importing ingestion.service.ts doesn't try to instantiate a
// PrismaClient (which would require `prisma generate` to have run).
vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    deviceCredential: { findUnique: vi.fn() },
    assetTemplate: { findUnique: vi.fn() },
    alarm: { updateMany: vi.fn(), findFirst: vi.fn() },
    auditTrail: { create: vi.fn() },
    assetInstance: { findUnique: vi.fn() },
  },
}));

vi.mock('ioredis', () => ({
  default: class MockRedis {
    publish = vi.fn();
    quit = vi.fn();
  },
}));

import { enqueueNotificationJob } from '../ingestion.service.js';

describe('enqueueNotificationJob', () => {
  beforeEach(() => {
    mockAddJob.mockReset();
    mockBullMqAdd.mockReset();
    mockRelease.mockReset();
    mockClose.mockReset();
    mockGetProducer.mockReset();
    mockGetRedisConnection.mockReset();
    mockGetRedisConnection.mockReturnValue({});
    mockGetProducer.mockResolvedValue({ addJob: mockAddJob, release: mockRelease });
    delete process.env.USE_PG_QUEUE;
  });

  it('routes to BullMQ when USE_PG_QUEUE is unset', async () => {
    await enqueueNotificationJob('alarm_notification', { type: 'ALARM' }, { priority: 5 });

    expect(mockBullMqAdd).toHaveBeenCalledTimes(1);
    expect(mockBullMqAdd).toHaveBeenCalledWith(
      'alarm_notification',
      { type: 'ALARM' },
      expect.objectContaining({ priority: 5 }),
    );
    expect(mockAddJob).not.toHaveBeenCalled();
  });

  it('routes to graphile-worker when USE_PG_QUEUE=true', async () => {
    process.env.USE_PG_QUEUE = 'true';

    await enqueueNotificationJob(
      'rule_chain_notification',
      { type: 'INFO' },
      { priority: 7, jobId: 'abc' },
    );

    expect(mockAddJob).toHaveBeenCalledTimes(1);
    expect(mockAddJob).toHaveBeenCalledWith(
      'notification',
      { type: 'INFO' },
      expect.objectContaining({ priority: 7, jobKey: 'abc' }),
    );
    expect(mockBullMqAdd).not.toHaveBeenCalled();
  });
});
