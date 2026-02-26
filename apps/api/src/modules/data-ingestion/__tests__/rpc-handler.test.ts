import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockRedis, mockPrisma, mockGetMqttClient } = vi.hoisted(() => ({
  mockRedis: {
    setex: vi.fn(),
    get: vi.fn(),
    ttl: vi.fn(),
    quit: vi.fn(),
  },
  mockPrisma: {
    unsMapping: { findUnique: vi.fn() },
    assetInstance: { findUnique: vi.fn() },
  },
  mockGetMqttClient: vi.fn(),
}));

vi.mock('ioredis', () => {
  function MockIORedis() { return mockRedis; }
  return { default: MockIORedis };
});

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../transport/mqtt-client.js', () => ({ getMqttClient: mockGetMqttClient }));

import { publishRpcRequest, getRpcResponse, onRpcResponse, closeRpcRedis } from '../rpc-handler.js';

describe('rpc-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.get.mockResolvedValue(null);
    mockRedis.ttl.mockResolvedValue(30);
    mockRedis.quit.mockResolvedValue('OK');
  });

  describe('publishRpcRequest', () => {
    it('publishes RPC request via MQTT and stores in Redis', async () => {
      mockPrisma.unsMapping.findUnique.mockResolvedValue({ unsPath: 'digilog/v1/ent/pump-1' });
      const mockMqttClient = { publishAsync: vi.fn().mockResolvedValue(undefined) };
      mockGetMqttClient.mockReturnValue(mockMqttClient);

      const requestId = await publishRpcRequest('entity-1', 'getData', { key: 'temp' });

      expect(requestId).toBeDefined();
      expect(typeof requestId).toBe('string');
      expect(mockMqttClient.publishAsync).toHaveBeenCalledWith(
        expect.stringContaining('rpc/request'),
        expect.any(String),
        expect.objectContaining({ qos: 1 }),
      );
      expect(mockRedis.setex).toHaveBeenCalled();
    });

    it('falls back to assetInstance.unsPath when no UNS mapping', async () => {
      mockPrisma.unsMapping.findUnique.mockResolvedValue(null);
      mockPrisma.assetInstance.findUnique.mockResolvedValue({ unsPath: 'digilog/v1/ent/pump-2' });
      const mockMqttClient = { publishAsync: vi.fn().mockResolvedValue(undefined) };
      mockGetMqttClient.mockReturnValue(mockMqttClient);

      const requestId = await publishRpcRequest('entity-2', 'getStatus', {});
      expect(requestId).toBeDefined();
      expect(mockMqttClient.publishAsync).toHaveBeenCalled();
    });

    it('throws when no UNS path found', async () => {
      mockPrisma.unsMapping.findUnique.mockResolvedValue(null);
      mockPrisma.assetInstance.findUnique.mockResolvedValue(null);

      await expect(publishRpcRequest('bad', 'test', {})).rejects.toThrow('No UNS path');
    });
  });

  describe('getRpcResponse', () => {
    it('returns parsed response from Redis', async () => {
      const response = { requestId: 'r1', data: { temp: 25 }, receivedAt: '2026-01-01' };
      mockRedis.get.mockResolvedValue(JSON.stringify(response));

      const result = await getRpcResponse('r1');
      expect(result).toEqual(response);
    });

    it('returns null when no response stored', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await getRpcResponse('missing');
      expect(result).toBeNull();
    });
  });

  describe('onRpcResponse', () => {
    it('stores response in Redis with TTL', async () => {
      mockRedis.ttl.mockResolvedValue(25);

      await onRpcResponse('r1', { temp: 25 });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('res:r1'),
        expect.any(Number),
        expect.any(String),
      );
    });

    it('uses default TTL when request TTL is negative', async () => {
      mockRedis.ttl.mockResolvedValue(-1);

      await onRpcResponse('r2', { value: 'ok' });

      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('res:r2'),
        60,
        expect.any(String),
      );
    });
  });

  describe('closeRpcRedis', () => {
    it('quits redis connection', async () => {
      await closeRpcRedis();
      // Should not throw even if called multiple times
    });
  });
});
