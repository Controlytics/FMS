import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma, mockNormalizeBatch, mockOnRpcResponse, mockQueueAdd } = vi.hoisted(() => ({
  mockPrisma: {
    unsMapping: { findUnique: vi.fn() },
    assetInstance: { findUnique: vi.fn() },
    deviceCredential: { findUnique: vi.fn() },
    connectivityStatus: { upsert: vi.fn() },
  },
  mockNormalizeBatch: vi.fn(),
  mockOnRpcResponse: vi.fn(),
  mockQueueAdd: vi.fn(),
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../modules/data-ingestion/message-normalizer.js', () => ({
  normalizeBatch: mockNormalizeBatch,
}));
vi.mock('../../modules/data-ingestion/rpc-handler.js', () => ({
  onRpcResponse: mockOnRpcResponse,
}));
vi.mock('bullmq', () => {
  function MockQueue() { return { add: mockQueueAdd }; }
  return { Queue: MockQueue };
});
vi.mock('@digilog/queue', () => ({
  getRedisConnection: vi.fn().mockReturnValue({}),
  QUEUES: {
    INGESTION: {
      name: 'ingestion',
      defaultJobOptions: { removeOnComplete: true },
    },
  },
  JOB_PRIORITY: {
    TELEMETRY: 2,
    ATTRIBUTE_UPDATE: 3,
    DEVICE_EVENT: 4,
    BINARY_METADATA: 5,
  },
}));

import { handleMqttMessage } from '../mqtt-handler.js';

describe('mqtt-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.connectivityStatus.upsert.mockResolvedValue({});
    mockOnRpcResponse.mockResolvedValue(undefined);
  });

  describe('handleMqttMessage', () => {
    it('ignores unparseable topics', async () => {
      await handleMqttMessage('bad/topic', Buffer.from('{}'));
      expect(mockPrisma.unsMapping.findUnique).not.toHaveBeenCalled();
    });

    it('ignores topics with wrong root prefix', async () => {
      await handleMqttMessage('other/v1/ent/pump/telemetry', Buffer.from('{}'));
      expect(mockPrisma.unsMapping.findUnique).not.toHaveBeenCalled();
    });

    it('ignores too-short topics', async () => {
      await handleMqttMessage('digilog/v1', Buffer.from('{}'));
      expect(mockPrisma.unsMapping.findUnique).not.toHaveBeenCalled();
    });

    it('ignores topics with unknown suffix', async () => {
      await handleMqttMessage('digilog/v1/ent/pump/unknown', Buffer.from('{}'));
      expect(mockPrisma.unsMapping.findUnique).not.toHaveBeenCalled();
    });

    it('handles RPC response messages', async () => {
      const topic = 'digilog/v1/ent/pump/rpc/response/req-123';
      const payload = Buffer.from(JSON.stringify({ result: 'ok' }));

      await handleMqttMessage(topic, payload);

      expect(mockOnRpcResponse).toHaveBeenCalled();
    });

    it('resolves entity and enqueues telemetry', async () => {
      const topic = 'digilog/v1/ent/pump/telemetry';
      const payload = Buffer.from(JSON.stringify({ temperature: 25 }));

      mockPrisma.unsMapping.findUnique.mockResolvedValue({ entityId: 'e1' });
      mockPrisma.assetInstance.findUnique.mockResolvedValue({
        id: 'e1',
        name: 'Pump-1',
        isActive: true,
        template: { id: 't1', name: 'Template', defaultRuleChainId: null },
      });
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({ id: 'cred-1' });
      mockNormalizeBatch.mockReturnValue([{ messageId: 'm1', data: { temperature: 25 } }]);
      mockQueueAdd.mockResolvedValue({});

      await handleMqttMessage(topic, payload);

      expect(mockNormalizeBatch).toHaveBeenCalled();
      expect(mockQueueAdd).toHaveBeenCalled();
      expect(mockPrisma.connectivityStatus.upsert).toHaveBeenCalled();
    });

    it('skips when entity not found in UNS mapping', async () => {
      const topic = 'digilog/v1/ent/pump/telemetry';
      const payload = Buffer.from(JSON.stringify({ temp: 10 }));

      mockPrisma.unsMapping.findUnique.mockResolvedValue(null);

      await handleMqttMessage(topic, payload);

      expect(mockNormalizeBatch).not.toHaveBeenCalled();
    });

    it('skips inactive entities', async () => {
      const topic = 'digilog/v1/ent/pump/telemetry';
      const payload = Buffer.from(JSON.stringify({ temp: 10 }));

      mockPrisma.unsMapping.findUnique.mockResolvedValue({ entityId: 'e1' });
      mockPrisma.assetInstance.findUnique.mockResolvedValue({
        id: 'e1',
        isActive: false,
        template: { id: 't1' },
      });

      await handleMqttMessage(topic, payload);

      expect(mockNormalizeBatch).not.toHaveBeenCalled();
    });

    it('handles non-JSON payloads gracefully', async () => {
      const topic = 'digilog/v1/ent/pump/telemetry';
      const payload = Buffer.from('not json');

      mockPrisma.unsMapping.findUnique.mockResolvedValue({ entityId: 'e1' });
      mockPrisma.assetInstance.findUnique.mockResolvedValue({
        id: 'e1',
        name: 'Pump-1',
        isActive: true,
        template: { id: 't1', name: 'Template', defaultRuleChainId: null },
      });
      mockPrisma.deviceCredential.findUnique.mockResolvedValue(null);
      mockNormalizeBatch.mockReturnValue([{ messageId: 'm1' }]);
      mockQueueAdd.mockResolvedValue({});

      await handleMqttMessage(topic, payload);

      // Should still process with base64 fallback
      expect(mockNormalizeBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          rawPayload: expect.objectContaining({ _encoding: 'base64' }),
        }),
      );
    });

    it('processes attribute messages', async () => {
      const topic = 'digilog/v1/ent/pump/attributes';
      const payload = Buffer.from(JSON.stringify({ firmware: '2.0' }));

      mockPrisma.unsMapping.findUnique.mockResolvedValue({ entityId: 'e1' });
      mockPrisma.assetInstance.findUnique.mockResolvedValue({
        id: 'e1',
        name: 'Pump-1',
        isActive: true,
        template: { id: 't1', name: 'Template', defaultRuleChainId: null },
      });
      mockPrisma.deviceCredential.findUnique.mockResolvedValue(null);
      mockNormalizeBatch.mockReturnValue([{ messageId: 'm1' }]);
      mockQueueAdd.mockResolvedValue({});

      await handleMqttMessage(topic, payload);

      expect(mockNormalizeBatch).toHaveBeenCalledWith(
        expect.objectContaining({ messageType: 'POST_ATTRIBUTES' }),
      );
    });
  });
});
