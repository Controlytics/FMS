import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma, mockGetMqttClient } = vi.hoisted(() => ({
  mockPrisma: {
    unsMapping: { findUnique: vi.fn() },
    assetInstance: { findUnique: vi.fn() },
  },
  mockGetMqttClient: vi.fn(),
}));

vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));
vi.mock('../../../transport/mqtt-client.js', () => ({ getMqttClient: mockGetMqttClient }));

import { publishRpcRequest, getRpcResponse, onRpcResponse } from '../rpc-handler.js';
import { _resetForTests } from '../../../lib/rpc-cache.js';

// Phase 4 (2026-05-01): Redis SETEX-based correlation replaced by an in-process
// TTL Map (apps/api/src/lib/rpc-cache.ts). These tests now exercise the cache
// directly rather than mocking ioredis.

describe('rpc-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetForTests();
  });

  describe('publishRpcRequest', () => {
    it('publishes RPC request via MQTT and stores in the in-process cache', async () => {
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
      // Cache is an in-process Map; we exercise the response path to confirm round-trip works.
      // (No direct mock to introspect anymore — that's the whole point of dropping ioredis.)
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

  describe('round-trip via in-process cache', () => {
    it('onRpcResponse stores and getRpcResponse returns', async () => {
      mockPrisma.unsMapping.findUnique.mockResolvedValue({ unsPath: 'digilog/v1/ent/x' });
      mockGetMqttClient.mockReturnValue({ publishAsync: vi.fn().mockResolvedValue(undefined) });

      const requestId = await publishRpcRequest('entity-x', 'ping', {});
      // Initially no response cached.
      expect(await getRpcResponse(requestId)).toBeNull();

      // Simulate response arriving.
      await onRpcResponse(requestId, { temp: 25 });
      const result = await getRpcResponse(requestId);
      expect(result).not.toBeNull();
      expect(result?.requestId).toBe(requestId);
      expect(result?.data).toEqual({ temp: 25 });
    });

    it('getRpcResponse returns null when no response stored', async () => {
      const result = await getRpcResponse('missing');
      expect(result).toBeNull();
    });

    it('onRpcResponse for unknown requestId still stores with default TTL', async () => {
      await onRpcResponse('orphan-id', { value: 'ok' });
      const result = await getRpcResponse('orphan-id');
      expect(result?.data).toEqual({ value: 'ok' });
    });
  });

});
