import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma, mockAddTelemetryRow, mockTsdbPool } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRawUnsafe: vi.fn(),
    assetInstance: { findUnique: vi.fn(), update: vi.fn() },
    dataStream: { upsert: vi.fn() },
    checklistReview: { create: vi.fn() },
  },
  mockAddTelemetryRow: vi.fn(),
  mockTsdbPool: { query: vi.fn() },
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('@digilog/db', () => ({
  addTelemetryRow: mockAddTelemetryRow,
  getTsdbPool: () => mockTsdbPool,
}));

// Mock fs/promises for saveBinary
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { saveTelemetry, saveAttributes, saveChecklist } from '../ingestion.repository.js';

const makeMsg = (overrides: Record<string, any> = {}) => ({
  messageId: 'msg-1',
  timestamp: '2026-01-01T00:00:00Z',
  protocol: 'mqtt' as const,
  entityId: 'e1',
  entityName: 'Pump-1',
  templateId: 't1',
  unsPath: 'digilog/v1/ent/pump-1',
  credentialId: 'cred-1',
  sourceIp: '192.168.1.1',
  messageType: 'POST_TELEMETRY' as const,
  data: { temperature: 25, pressure: 1.5 },
  metadata: {},
  traceId: 'trace-1',
  ...overrides,
});

describe('ingestion.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRawUnsafe.mockResolvedValue([]);
    mockAddTelemetryRow.mockReturnValue(undefined);
    mockPrisma.dataStream.upsert.mockResolvedValue({});
    mockTsdbPool.query.mockResolvedValue({ rows: [] });
  });

  describe('saveTelemetry', () => {
    it('writes telemetry data and returns key count', async () => {
      const msg = makeMsg({ data: { temperature: 25, pressure: 1.5 } });
      const result = await saveTelemetry(msg);

      expect(result.keysWritten).toBe(2);
      expect(mockAddTelemetryRow).toHaveBeenCalledTimes(2);
    });

    it('skips keys starting with underscore', async () => {
      const msg = makeMsg({ data: { temperature: 25, _internal: true } });
      const result = await saveTelemetry(msg);

      expect(result.keysWritten).toBe(1);
    });

    it('handles empty data', async () => {
      const msg = makeMsg({ data: {} });
      const result = await saveTelemetry(msg);
      expect(result.keysWritten).toBe(0);
    });

    it('classifies different value types correctly', async () => {
      const msg = makeMsg({
        data: {
          numVal: 42,
          floatVal: 3.14,
          boolVal: true,
          strVal: 'hello',
          objVal: { nested: true },
        },
      });
      const result = await saveTelemetry(msg);
      expect(result.keysWritten).toBe(5);
    });
  });

  describe('saveAttributes', () => {
    it('writes attribute data and merges with existing', async () => {
      const msg = makeMsg({
        messageType: 'POST_ATTRIBUTES',
        data: { firmware: '2.0' },
      });
      mockPrisma.assetInstance.findUnique.mockResolvedValue({
        attributes: { firmware: '1.0', serial: 'ABC' },
      });
      mockPrisma.assetInstance.update.mockResolvedValue({});

      const result = await saveAttributes(msg);

      expect(result.keysWritten).toBe(1);
      expect(mockTsdbPool.query).toHaveBeenCalled(); // ts_attributes INSERT
      expect(mockPrisma.assetInstance.update).toHaveBeenCalledWith({
        where: { id: 'e1' },
        data: { attributes: expect.objectContaining({ firmware: '2.0', serial: 'ABC' }) },
      });
    });

    it('skips keys starting with underscore', async () => {
      const msg = makeMsg({
        messageType: 'POST_ATTRIBUTES',
        data: { firmware: '2.0', _meta: 'skip' },
      });
      mockPrisma.assetInstance.findUnique.mockResolvedValue({ attributes: {} });
      mockPrisma.assetInstance.update.mockResolvedValue({});

      const result = await saveAttributes(msg);
      expect(result.keysWritten).toBe(1);
    });
  });

  describe('saveChecklist', () => {
    it('saves checklist response and creates review', async () => {
      const msg = makeMsg({
        messageType: 'POST_TELEMETRY',
        data: { q1: 'yes', q2: 'no', _remarks: 'test note', _userId: 'op1' },
      });
      mockPrisma.checklistReview.create.mockResolvedValue({ id: 'cr1' });

      const result = await saveChecklist(msg);

      expect(result.checklistId).toBeDefined();
      expect(mockTsdbPool.query).toHaveBeenCalled();
      expect(mockPrisma.checklistReview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          currentStep: 'SUBMITTED',
          currentSequence: 1,
        }),
      });
    });
  });

});
