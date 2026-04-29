import { describe, it, expect, beforeEach, vi } from 'vitest';

const {
  mockGetConfigOrDefault,
  mockProcessIngestionMessage,
  mockGetWorkerConnection,
  mockWorkerOn,
  mockWorkerClose,
} = vi.hoisted(() => ({
  mockGetConfigOrDefault: vi.fn(),
  mockProcessIngestionMessage: vi.fn(),
  mockGetWorkerConnection: vi.fn(),
  mockWorkerOn: vi.fn(),
  mockWorkerClose: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../modules/data-ingestion/ingestion-config.service.js', () => ({
  getConfigOrDefault: mockGetConfigOrDefault,
}));

vi.mock('../../modules/data-ingestion/ingestion.service.js', () => ({
  processIngestionMessage: mockProcessIngestionMessage,
}));

vi.mock('@digilog/queue', () => ({
  getWorkerConnection: mockGetWorkerConnection,
  QUEUES: {
    INGESTION: { name: 'ingestion', defaultJobOptions: {} },
  },
}));

// Track the processor callback and options
let capturedProcessor: ((job: any) => Promise<any>) | null = null;
let capturedOptions: Record<string, unknown> | null = null;

vi.mock('bullmq', () => ({
  Worker: class MockWorker {
    constructor(_name: string, processor: any, options: any) {
      capturedProcessor = processor;
      capturedOptions = options;
    }
    on = mockWorkerOn;
    close = mockWorkerClose;
  },
}));

import {
  startIngestionWorker,
  stopIngestionWorker,
  ingestionTask,
} from '../ingestion.worker.js';
import type { IngestionMessage } from '../../modules/data-ingestion/message-normalizer.js';

describe('ingestion.worker', () => {
  beforeEach(async () => {
    // Reset module-level singleton so each test gets a fresh worker
    await stopIngestionWorker();
    vi.clearAllMocks();
    capturedProcessor = null;
    capturedOptions = null;
    mockGetConfigOrDefault.mockResolvedValue(5); // default concurrency
  });

  describe('startIngestionWorker', () => {
    it('creates worker with configured concurrency', async () => {
      mockGetConfigOrDefault.mockResolvedValue(10);
      await startIngestionWorker();

      expect(mockGetConfigOrDefault).toHaveBeenCalledWith('ingestion.worker_concurrency', 5);
      expect(capturedOptions).toBeDefined();
      expect(capturedOptions!.concurrency).toBe(10);
    });

    it('registers event handlers for completed, failed, and error', async () => {
      await startIngestionWorker();

      const events = mockWorkerOn.mock.calls.map((c: any[]) => c[0]);
      expect(events).toContain('completed');
      expect(events).toContain('failed');
      expect(events).toContain('error');
    });

    it('is a no-op when already started', async () => {
      await startIngestionWorker();
      mockGetConfigOrDefault.mockClear();

      await startIngestionWorker();
      // Should not re-read config
      expect(mockGetConfigOrDefault).not.toHaveBeenCalled();
    });
  });

  describe('job processor', () => {
    it('calls processIngestionMessage with job data', async () => {
      await startIngestionWorker();
      expect(capturedProcessor).toBeDefined();

      const msg = { messageId: 'msg-1', entityId: 'e-1' };
      mockProcessIngestionMessage.mockResolvedValue({ success: true, messageId: 'msg-1', warnings: [] });

      const result = await capturedProcessor!({ data: msg } as any);

      expect(mockProcessIngestionMessage).toHaveBeenCalledWith(msg);
      expect(result.success).toBe(true);
    });

    it('does not throw when message fails (DLQ handles it)', async () => {
      await startIngestionWorker();

      const msg = { messageId: 'msg-fail', entityId: 'e-1' };
      mockProcessIngestionMessage.mockResolvedValue({ success: false, messageId: 'msg-fail', warnings: [] });

      const result = await capturedProcessor!({ data: msg } as any);

      expect(result.success).toBe(false);
    });
  });

  describe('stopIngestionWorker', () => {
    it('calls close on the worker', async () => {
      await startIngestionWorker();
      await stopIngestionWorker();

      expect(mockWorkerClose).toHaveBeenCalledOnce();
    });

    it('is safe to call when worker not started', async () => {
      await stopIngestionWorker();
      expect(mockWorkerClose).not.toHaveBeenCalled();
    });
  });

  // ─── graphile-worker Task tests (Task 2.3) ───────────────
  describe('ingestionTask (graphile-worker)', () => {
    function makeMsg(messageId: string): IngestionMessage {
      return {
        messageId,
        timestamp: new Date().toISOString(),
        protocol: 'mqtt',
        entityId: 'ent-1',
        entityName: 'AHU-01',
        templateId: 'tpl-1',
        unsPath: 'digilog/v1/site/area/ahu',
        credentialId: 'cred-1',
        sourceIp: '',
        messageType: 'POST_TELEMETRY',
        data: { temperature: 22.5 },
        metadata: {},
        ruleChainId: 'rc-1',
        traceId: 'trace-1',
      };
    }

    function makeHelpers() {
      const warn = vi.fn();
      const helpers = { logger: { info: vi.fn(), warn, error: vi.fn() } } as never;
      return { warn, helpers };
    }

    it('processes a wrapped { messageType, msg } payload via processIngestionMessage', async () => {
      mockProcessIngestionMessage.mockResolvedValueOnce({
        success: true,
        messageId: 'msg-ok',
        warnings: [],
      });
      const msg = makeMsg('msg-ok');
      const { helpers, warn } = makeHelpers();

      await expect(
        ingestionTask({ messageType: 'POST_TELEMETRY', msg }, helpers),
      ).resolves.not.toThrow();

      expect(mockProcessIngestionMessage).toHaveBeenCalledWith(msg);
      expect(warn).not.toHaveBeenCalled();
    });

    it('logs a warning via helpers.logger.warn when processIngestionMessage returns success: false', async () => {
      mockProcessIngestionMessage.mockResolvedValueOnce({
        success: false,
        messageId: 'msg-fail',
        warnings: [],
      });
      const msg = makeMsg('msg-fail');
      const { helpers, warn } = makeHelpers();

      await ingestionTask({ messageType: 'POST_TELEMETRY', msg }, helpers);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toEqual(expect.stringContaining('msg-fail'));
    });
  });
});
