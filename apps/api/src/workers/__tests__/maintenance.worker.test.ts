import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockProcessDLQ,
  mockCheckInactivityTimeouts,
  mockGetRedisConnection,
  mockWorkerOn,
  mockWorkerClose,
  mockQueueAdd,
  mockQueueClose,
} = vi.hoisted(() => ({
  mockProcessDLQ: vi.fn(),
  mockCheckInactivityTimeouts: vi.fn(),
  mockGetRedisConnection: vi.fn(),
  mockWorkerOn: vi.fn(),
  mockWorkerClose: vi.fn().mockResolvedValue(undefined),
  mockQueueAdd: vi.fn().mockResolvedValue({ id: 'job-1' }),
  mockQueueClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../modules/data-ingestion/dlq-manager.js', () => ({
  processDLQ: mockProcessDLQ,
}));

vi.mock('../../modules/data-ingestion/connectivity-tracker.js', () => ({
  checkInactivityTimeouts: mockCheckInactivityTimeouts,
}));

vi.mock('@digilog/queue', () => ({
  getRedisConnection: mockGetRedisConnection,
  QUEUES: {
    MAINTENANCE: { name: 'maintenance', defaultJobOptions: {} },
  },
}));

let capturedProcessor: ((job: any) => Promise<any>) | null = null;

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: any) {
      capturedProcessor = processor;
    }
    on = mockWorkerOn;
    close = mockWorkerClose;
  },
  Queue: class MockQueue {
    add = mockQueueAdd;
    close = mockQueueClose;
  },
}));

import { startMaintenanceWorker, stopMaintenanceWorker } from '../maintenance.worker.js';

describe('maintenance.worker', () => {
  beforeEach(async () => {
    // Reset module-level singleton so each test gets a fresh worker
    await stopMaintenanceWorker();
    vi.clearAllMocks();
    capturedProcessor = null;
  });

  describe('startMaintenanceWorker', () => {
    it('schedules DLQ check and connectivity check repeatable jobs', async () => {
      await startMaintenanceWorker();

      expect(mockQueueAdd).toHaveBeenCalledTimes(2);

      const calls = mockQueueAdd.mock.calls;
      const jobNames = calls.map((c: any[]) => c[0]);
      expect(jobNames).toContain('dlq_check');
      expect(jobNames).toContain('connectivity_check');
    });

    it('configures repeatable jobs with 60s interval', async () => {
      await startMaintenanceWorker();

      const dlqCall = mockQueueAdd.mock.calls.find((c: any[]) => c[0] === 'dlq_check');
      expect(dlqCall![2].repeat.every).toBe(60_000);

      const connCall = mockQueueAdd.mock.calls.find((c: any[]) => c[0] === 'connectivity_check');
      expect(connCall![2].repeat.every).toBe(60_000);
    });

    it('registers failed and error event handlers', async () => {
      await startMaintenanceWorker();

      const events = mockWorkerOn.mock.calls.map((c: any[]) => c[0]);
      expect(events).toContain('failed');
      expect(events).toContain('error');
    });

    it('is a no-op when already started', async () => {
      await startMaintenanceWorker();
      mockQueueAdd.mockClear();

      await startMaintenanceWorker();
      // Should not schedule jobs again
      expect(mockQueueAdd).not.toHaveBeenCalled();
    });
  });

  describe('job processor', () => {
    it('handles dlq_check task', async () => {
      await startMaintenanceWorker();
      expect(capturedProcessor).toBeDefined();

      mockProcessDLQ.mockResolvedValue({ requeued: 2, dead: 1 });

      const result = await capturedProcessor!({ data: { task: 'dlq_check' } } as any);

      expect(mockProcessDLQ).toHaveBeenCalledOnce();
      expect(result.task).toBe('dlq_check');
      expect(result.requeued).toBe(2);
    });

    it('handles connectivity_check task', async () => {
      await startMaintenanceWorker();

      mockCheckInactivityTimeouts.mockResolvedValue(5);

      const result = await capturedProcessor!({ data: { task: 'connectivity_check' } } as any);

      expect(mockCheckInactivityTimeouts).toHaveBeenCalledOnce();
      expect(result.task).toBe('connectivity_check');
      expect(result.offlineCount).toBe(5);
    });

    it('handles unknown task gracefully', async () => {
      await startMaintenanceWorker();

      const result = await capturedProcessor!({ data: { task: 'unknown_task' } } as any);

      expect(result.task).toBe('unknown_task');
      expect(result.skipped).toBe(true);
    });
  });

  describe('stopMaintenanceWorker', () => {
    it('closes both worker and queue', async () => {
      await startMaintenanceWorker();
      await stopMaintenanceWorker();

      expect(mockWorkerClose).toHaveBeenCalledOnce();
      expect(mockQueueClose).toHaveBeenCalledOnce();
    });

    it('is safe to call when not started', async () => {
      await stopMaintenanceWorker();
      expect(mockWorkerClose).not.toHaveBeenCalled();
      expect(mockQueueClose).not.toHaveBeenCalled();
    });
  });
});
