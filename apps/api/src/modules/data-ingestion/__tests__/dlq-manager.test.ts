import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockCreate,
  mockFindMany,
  mockUpdate,
  mockUpdateMany,
  mockCount,
  mockEnqueueIngestionJob,
  mockGetConfigOrDefault,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockCount: vi.fn(),
  mockEnqueueIngestionJob: vi.fn(),
  mockGetConfigOrDefault: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    deadLetterQueue: {
      create: mockCreate,
      findMany: mockFindMany,
      update: mockUpdate,
      updateMany: mockUpdateMany,
      count: mockCount,
    },
  },
}));

vi.mock('@digilog/queue', () => ({
  QUEUES: {
    INGESTION: {
      name: 'ingestion',
      defaultJobOptions: { attempts: 3, removeOnComplete: true, removeOnFail: false },
    },
  },
  JOB_PRIORITY: {
    TELEMETRY: 5,
  },
}));

// Mock ingestion.service so dlq-manager's `enqueueIngestionJob` import does
// not transitively pull in `@digilog/db` (which vitest-vite cannot resolve
// as a workspace package in this test environment). The DLQ manager itself
// only needs the helper to be callable; we assert on the helper directly.
vi.mock('../ingestion.service.js', () => ({
  enqueueIngestionJob: mockEnqueueIngestionJob,
}));

vi.mock('../ingestion-config.service.js', () => ({
  getConfigOrDefault: mockGetConfigOrDefault,
}));

// ── Import SUT (after mocks) ──────────────────────────────────────────

import { addToDLQ, processDLQ, resolveDLQEntry, getDLQStats } from '../dlq-manager.js';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeMessage(overrides?: Record<string, unknown>) {
  return {
    messageId: 'msg-001',
    timestamp: '2026-02-25T12:00:00Z',
    protocol: 'mqtt' as const,
    entityId: 'entity-001',
    entityName: 'Sensor-A',
    templateId: 'tmpl-001',
    unsPath: 'digilog/v1/sensors/temp',
    credentialId: 'cred-001',
    sourceIp: '192.168.1.10',
    messageType: 'TELEMETRY',
    data: { temperature: 25.5 },
    metadata: {},
    traceId: 'trace-001',
    ...overrides,
  };
}

function makeDLQEntry(overrides?: Record<string, unknown>) {
  return {
    id: 'dlq-001',
    messageId: 'msg-001',
    entityId: 'entity-001',
    messageType: 'TELEMETRY',
    payload: makeMessage(),
    errorMessage: 'Stage 6 failed',
    errorStage: 'NORMALIZE',
    retryCount: 0,
    maxRetries: 3,
    status: 'PENDING',
    createdAt: new Date(Date.now() - 10 * 60 * 1000), // 10 minutes ago
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('dlq-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── addToDLQ ─────────────────────────────────────────────────────────

  describe('addToDLQ', () => {
    it('should create a DB entry with PENDING status', async () => {
      mockCreate.mockResolvedValue({});

      const message = makeMessage();
      await addToDLQ(message, 'Parse error', 'NORMALIZE');

      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0][0];
      expect(call.data.messageId).toBe('msg-001');
      expect(call.data.entityId).toBe('entity-001');
      expect(call.data.messageType).toBe('TELEMETRY');
      expect(call.data.status).toBe('PENDING');
      expect(call.data.retryCount).toBe(0);
      expect(call.data.maxRetries).toBe(3);
    });

    it('should include errorMessage and errorStage in the created entry', async () => {
      mockCreate.mockResolvedValue({});

      const message = makeMessage();
      await addToDLQ(message, 'Schema validation failed', 'VALIDATE');

      const call = mockCreate.mock.calls[0][0];
      expect(call.data.errorMessage).toBe('Schema validation failed');
      expect(call.data.errorStage).toBe('VALIDATE');
    });

    it('should serialize the full message as payload JSON', async () => {
      mockCreate.mockResolvedValue({});

      const message = makeMessage({ data: { ph: 7.2, dissolved_oxygen: 8.1 } });
      await addToDLQ(message, 'Persist error', 'PERSIST');

      const call = mockCreate.mock.calls[0][0];
      const payload = call.data.payload;
      expect(payload.messageId).toBe('msg-001');
      expect(payload.data.ph).toBe(7.2);
      expect(payload.data.dissolved_oxygen).toBe(8.1);
    });

    it('should set entityId to null when message has no entityId', async () => {
      mockCreate.mockResolvedValue({});

      const message = makeMessage({ entityId: '' });
      await addToDLQ(message, 'No entity', 'RESOLVE');

      const call = mockCreate.mock.calls[0][0];
      expect(call.data.entityId).toBeNull();
    });
  });

  // ── processDLQ ───────────────────────────────────────────────────────

  describe('processDLQ', () => {
    it('should return { requeued: 0, dead: 0 } when no pending entries exist', async () => {
      mockFindMany.mockResolvedValue([]);
      mockGetConfigOrDefault.mockResolvedValue(100);
      mockCount.mockResolvedValue(0);

      const result = await processDLQ();

      expect(result).toEqual({ requeued: 0, dead: 0 });
      expect(mockFindMany).toHaveBeenCalledTimes(1);
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(mockEnqueueIngestionJob).not.toHaveBeenCalled();
    });

    it('should re-enqueue entries that are under max retries', async () => {
      const entry = makeDLQEntry({ retryCount: 1, maxRetries: 3 });
      mockFindMany.mockResolvedValue([entry]);
      mockEnqueueIngestionJob.mockResolvedValue(undefined);
      mockUpdate.mockResolvedValue({});
      mockGetConfigOrDefault.mockResolvedValue(100);
      mockCount.mockResolvedValue(0);

      const result = await processDLQ();

      expect(result).toEqual({ requeued: 1, dead: 0 });
      expect(mockEnqueueIngestionJob).toHaveBeenCalledTimes(1);
      // After Task 2.3 review fixes, enqueueIngestionJob takes (msg, options) —
      // messageType is read from msg itself, not passed separately.
      expect(mockEnqueueIngestionJob).toHaveBeenCalledWith(
        entry.payload,
        {
          priority: 5,
          jobId: `dlq-retry-${entry.id}-2`,
        },
      );
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: entry.id },
        data: {
          status: 'RETRYING',
          retryCount: { increment: 1 },
        },
      });
    });

    it('should mark entries as DEAD when retryCount >= maxRetries', async () => {
      const entry = makeDLQEntry({ retryCount: 3, maxRetries: 3 });
      mockFindMany.mockResolvedValue([entry]);
      mockGetConfigOrDefault.mockResolvedValue(100);
      mockCount.mockResolvedValue(0);

      const result = await processDLQ();

      expect(result).toEqual({ requeued: 0, dead: 1 });
      expect(mockUpdate).toHaveBeenCalledWith({
        where: { id: entry.id },
        data: { status: 'DEAD' },
      });
      expect(mockEnqueueIngestionJob).not.toHaveBeenCalled();
    });

    it('should handle a mixed batch with some requeued and some dead', async () => {
      const retryableEntry = makeDLQEntry({ id: 'dlq-retry', retryCount: 1, maxRetries: 3 });
      const deadEntry1 = makeDLQEntry({ id: 'dlq-dead-1', retryCount: 3, maxRetries: 3 });
      const deadEntry2 = makeDLQEntry({ id: 'dlq-dead-2', retryCount: 5, maxRetries: 3 });
      const retryableEntry2 = makeDLQEntry({ id: 'dlq-retry-2', retryCount: 0, maxRetries: 3 });

      mockFindMany.mockResolvedValue([retryableEntry, deadEntry1, deadEntry2, retryableEntry2]);
      mockEnqueueIngestionJob.mockResolvedValue(undefined);
      mockUpdate.mockResolvedValue({});
      mockGetConfigOrDefault.mockResolvedValue(100);
      mockCount.mockResolvedValue(0);

      const result = await processDLQ();

      expect(result).toEqual({ requeued: 2, dead: 2 });

      // Verify dead entries were marked
      const deadUpdateCalls = mockUpdate.mock.calls.filter(
        (c: any[]) => c[0].data.status === 'DEAD',
      );
      expect(deadUpdateCalls).toHaveLength(2);
      const deadIds = deadUpdateCalls.map((c: any[]) => c[0].where.id);
      expect(deadIds).toContain('dlq-dead-1');
      expect(deadIds).toContain('dlq-dead-2');

      // Verify retryable entries were re-enqueued
      expect(mockEnqueueIngestionJob).toHaveBeenCalledTimes(2);
      const retryUpdateCalls = mockUpdate.mock.calls.filter(
        (c: any[]) => c[0].data.status === 'RETRYING',
      );
      expect(retryUpdateCalls).toHaveLength(2);
    });

    it('should not throw when enqueueIngestionJob fails for re-enqueue', async () => {
      const entry = makeDLQEntry({ retryCount: 0, maxRetries: 3 });
      mockFindMany.mockResolvedValue([entry]);
      mockEnqueueIngestionJob.mockRejectedValue(new Error('Queue down'));
      mockGetConfigOrDefault.mockResolvedValue(100);
      mockCount.mockResolvedValue(0);

      const result = await processDLQ();

      // Entry was not requeued because the helper threw
      expect(result).toEqual({ requeued: 0, dead: 0 });
      // The status update to RETRYING should not have been called
      const retryingCalls = mockUpdate.mock.calls.filter(
        (c: any[]) => c[0].data.status === 'RETRYING',
      );
      expect(retryingCalls).toHaveLength(0);
    });

    it('should query for PENDING and RETRYING entries older than 5 minutes', async () => {
      mockFindMany.mockResolvedValue([]);
      mockGetConfigOrDefault.mockResolvedValue(100);
      mockCount.mockResolvedValue(0);

      await processDLQ();

      expect(mockFindMany).toHaveBeenCalledTimes(1);
      const findCall = mockFindMany.mock.calls[0][0];
      expect(findCall.where.status).toEqual({ in: ['PENDING', 'RETRYING'] });
      expect(findCall.where.createdAt.lt).toBeInstanceOf(Date);
      expect(findCall.orderBy).toEqual({ createdAt: 'asc' });
      expect(findCall.take).toBe(50);
    });
  });

  // ── resolveDLQEntry ──────────────────────────────────────────────────

  describe('resolveDLQEntry', () => {
    it('should update matching PENDING/RETRYING entries to RESOLVED', async () => {
      mockUpdateMany.mockResolvedValue({ count: 1 });

      await resolveDLQEntry('msg-resolve-001');

      expect(mockUpdateMany).toHaveBeenCalledTimes(1);
      expect(mockUpdateMany).toHaveBeenCalledWith({
        where: {
          messageId: 'msg-resolve-001',
          status: { in: ['PENDING', 'RETRYING'] },
        },
        data: { status: 'RESOLVED' },
      });
    });

    it('should not throw when no entries match the messageId', async () => {
      mockUpdateMany.mockResolvedValue({ count: 0 });

      await expect(resolveDLQEntry('msg-nonexistent')).resolves.toBeUndefined();
      expect(mockUpdateMany).toHaveBeenCalledTimes(1);
    });
  });

  // ── getDLQStats ──────────────────────────────────────────────────────

  describe('getDLQStats', () => {
    it('should return counts for all statuses and compute total', async () => {
      mockCount
        .mockResolvedValueOnce(10)  // PENDING
        .mockResolvedValueOnce(5)   // RETRYING
        .mockResolvedValueOnce(3)   // DEAD
        .mockResolvedValueOnce(20); // RESOLVED

      const stats = await getDLQStats();

      expect(stats).toEqual({
        pending: 10,
        retrying: 5,
        dead: 3,
        resolved: 20,
        total: 38,
      });

      expect(mockCount).toHaveBeenCalledTimes(4);
      expect(mockCount).toHaveBeenCalledWith({ where: { status: 'PENDING' } });
      expect(mockCount).toHaveBeenCalledWith({ where: { status: 'RETRYING' } });
      expect(mockCount).toHaveBeenCalledWith({ where: { status: 'DEAD' } });
      expect(mockCount).toHaveBeenCalledWith({ where: { status: 'RESOLVED' } });
    });

    it('should return all zeros when no entries exist', async () => {
      mockCount.mockResolvedValue(0);

      const stats = await getDLQStats();

      expect(stats).toEqual({
        pending: 0,
        retrying: 0,
        dead: 0,
        resolved: 0,
        total: 0,
      });
    });
  });
});
