import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Phase 2 Task 2.4: enqueueNotificationJob test.
 *
 * Mirrors the producer-only test added for enqueueIngestionJob in Task 2.3.
 * Task 2.10 dropped the BullMQ branch — this suite now only verifies the
 * graphile-worker `addJob('notification', payload, …)` path.
 */

const {
  mockAddJob,
  mockRelease,
  mockGetProducer,
} = vi.hoisted(() => ({
  mockAddJob: vi.fn(),
  mockRelease: vi.fn(),
  mockGetProducer: vi.fn(),
}));

vi.mock('@digilog/queue', () => ({
  getProducer: mockGetProducer,
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

// Mock @digilog/db so we don't trigger live Postgres/Timescale calls during
// import (matches the pattern in ingestion.service.test.ts).
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
    mockRelease.mockReset();
    mockGetProducer.mockReset();
    mockGetProducer.mockResolvedValue({ addJob: mockAddJob, release: mockRelease });
  });

  it('routes to graphile-worker with the fixed task identifier', async () => {
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
  });
});
