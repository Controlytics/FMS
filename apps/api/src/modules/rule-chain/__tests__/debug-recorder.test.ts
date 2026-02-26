import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────

const { mockPublish, mockQuit } = vi.hoisted(() => ({
  mockPublish: vi.fn().mockResolvedValue(1),
  mockQuit: vi.fn().mockResolvedValue('OK'),
}));

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    ruleChain: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('../../data-ingestion/ingestion-config.service.js', () => ({
  getConfigOrDefault: vi.fn().mockResolvedValue(100),
}));

vi.mock('ioredis', () => {
  return {
    default: class MockRedis {
      publish = mockPublish;
      quit = mockQuit;
    },
  };
});

import {
  recordDebug,
  getDebugBuffer,
  clearDebugBuffer,
  initDebugRecorder,
  isChainDebugEnabled,
  closeDebugRedis,
} from '../debug-recorder.js';
import type { DebugRecord } from '../types.js';
import { prisma } from '../../../lib/prisma.js';
import { getConfigOrDefault } from '../../data-ingestion/ingestion-config.service.js';

// ─── Helpers ─────────────────────────────────────────────────

function makeRecord(overrides: Partial<DebugRecord> = {}): DebugRecord {
  return {
    nodeId: overrides.nodeId ?? 'node-1',
    nodeType: overrides.nodeType ?? 'filter',
    nodeName: overrides.nodeName ?? 'Test Filter',
    inputMsg: overrides.inputMsg ?? { temp: 72 },
    outputMsg: overrides.outputMsg ?? { temp: 72 },
    output: overrides.output ?? 'Success',
    durationMs: overrides.durationMs ?? 5,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    error: overrides.error,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe('Debug Recorder', () => {
  beforeEach(() => {
    // Clear all buffers between tests by clearing every chain we might use
    clearDebugBuffer('chain-1');
    clearDebugBuffer('chain-2');
    clearDebugBuffer('chain-ring');
    mockPublish.mockClear();
    mockQuit.mockClear();
  });

  // ═══════════════════════════════════════════════════════
  // recordDebug
  // ═══════════════════════════════════════════════════════

  describe('recordDebug', () => {
    it('adds a single record to the buffer for a chain', () => {
      const record = makeRecord({ nodeId: 'n1' });
      recordDebug('chain-1', record);

      const buffer = getDebugBuffer('chain-1');
      expect(buffer).toHaveLength(1);
      expect(buffer[0].nodeId).toBe('n1');
    });

    it('adds multiple records in order', () => {
      const r1 = makeRecord({ nodeId: 'n1' });
      const r2 = makeRecord({ nodeId: 'n2' });
      const r3 = makeRecord({ nodeId: 'n3' });

      recordDebug('chain-1', r1);
      recordDebug('chain-1', r2);
      recordDebug('chain-1', r3);

      const buffer = getDebugBuffer('chain-1');
      expect(buffer).toHaveLength(3);
      expect(buffer[0].nodeId).toBe('n1');
      expect(buffer[1].nodeId).toBe('n2');
      expect(buffer[2].nodeId).toBe('n3');
    });

    it('keeps separate buffers for different chains', () => {
      recordDebug('chain-1', makeRecord({ nodeId: 'a1' }));
      recordDebug('chain-2', makeRecord({ nodeId: 'b1' }));
      recordDebug('chain-1', makeRecord({ nodeId: 'a2' }));

      expect(getDebugBuffer('chain-1')).toHaveLength(2);
      expect(getDebugBuffer('chain-2')).toHaveLength(1);
      expect(getDebugBuffer('chain-1')[0].nodeId).toBe('a1');
      expect(getDebugBuffer('chain-2')[0].nodeId).toBe('b1');
    });

    it('publishes record to Redis on each call', () => {
      const record = makeRecord({ nodeId: 'n-pub' });
      recordDebug('chain-1', record);

      expect(mockPublish).toHaveBeenCalledWith(
        'debug:rulechain:chain-1',
        JSON.stringify(record),
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  // getDebugBuffer
  // ═══════════════════════════════════════════════════════

  describe('getDebugBuffer', () => {
    it('returns empty array for unknown chain', () => {
      const buffer = getDebugBuffer('nonexistent-chain');
      expect(buffer).toEqual([]);
    });

    it('returns all records when no limit is specified', () => {
      for (let i = 0; i < 5; i++) {
        recordDebug('chain-1', makeRecord({ nodeId: `n-${i}` }));
      }

      const buffer = getDebugBuffer('chain-1');
      expect(buffer).toHaveLength(5);
    });

    it('returns only the last N records when limit is specified', () => {
      for (let i = 0; i < 10; i++) {
        recordDebug('chain-1', makeRecord({ nodeId: `n-${i}` }));
      }

      const limited = getDebugBuffer('chain-1', 3);
      expect(limited).toHaveLength(3);
      // Should return the last 3 (most recent)
      expect(limited[0].nodeId).toBe('n-7');
      expect(limited[1].nodeId).toBe('n-8');
      expect(limited[2].nodeId).toBe('n-9');
    });

    it('returns all records when limit exceeds buffer length', () => {
      recordDebug('chain-1', makeRecord({ nodeId: 'only-one' }));

      const buffer = getDebugBuffer('chain-1', 100);
      expect(buffer).toHaveLength(1);
      expect(buffer[0].nodeId).toBe('only-one');
    });

    it('returns a copy, not a reference to the internal buffer', () => {
      recordDebug('chain-1', makeRecord({ nodeId: 'original' }));

      const copy = getDebugBuffer('chain-1');
      copy.push(makeRecord({ nodeId: 'injected' }));

      // Internal buffer should be unaffected
      expect(getDebugBuffer('chain-1')).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════
  // clearDebugBuffer
  // ═══════════════════════════════════════════════════════

  describe('clearDebugBuffer', () => {
    it('removes all records for the specified chain', () => {
      recordDebug('chain-1', makeRecord());
      recordDebug('chain-1', makeRecord());
      expect(getDebugBuffer('chain-1')).toHaveLength(2);

      clearDebugBuffer('chain-1');
      expect(getDebugBuffer('chain-1')).toEqual([]);
    });

    it('does not affect other chains', () => {
      recordDebug('chain-1', makeRecord({ nodeId: 'a' }));
      recordDebug('chain-2', makeRecord({ nodeId: 'b' }));

      clearDebugBuffer('chain-1');

      expect(getDebugBuffer('chain-1')).toEqual([]);
      expect(getDebugBuffer('chain-2')).toHaveLength(1);
      expect(getDebugBuffer('chain-2')[0].nodeId).toBe('b');
    });

    it('is safe to call on a chain that has no buffer', () => {
      // Should not throw
      expect(() => clearDebugBuffer('never-used-chain')).not.toThrow();
    });
  });

  // ═══════════════════════════════════════════════════════
  // Ring buffer eviction
  // ═══════════════════════════════════════════════════════

  describe('ring buffer eviction', () => {
    it('evicts oldest records when buffer exceeds maxBufferSize (100)', () => {
      // Record 105 items — only the last 100 should remain
      for (let i = 0; i < 105; i++) {
        recordDebug('chain-ring', makeRecord({ nodeId: `n-${i}` }));
      }

      const buffer = getDebugBuffer('chain-ring');
      expect(buffer).toHaveLength(100);
      // Oldest kept should be n-5 (first 5 were evicted)
      expect(buffer[0].nodeId).toBe('n-5');
      // Newest should be n-104
      expect(buffer[99].nodeId).toBe('n-104');
    });
  });

  // ═══════════════════════════════════════════════════════
  // LRU chain eviction
  // ═══════════════════════════════════════════════════════

  describe('LRU chain eviction', () => {
    it('evicts least-recently-used chain when MAX_CHAINS (1000) is exceeded', () => {
      // Fill up to 1000 chains
      for (let i = 0; i < 1000; i++) {
        recordDebug(`lru-chain-${i}`, makeRecord({ nodeId: `n-${i}` }));
      }

      // All 1000 chains should exist
      expect(getDebugBuffer('lru-chain-0')).toHaveLength(1);
      expect(getDebugBuffer('lru-chain-999')).toHaveLength(1);

      // Adding chain 1001 should evict the oldest (lru-chain-0)
      recordDebug('lru-chain-1000', makeRecord({ nodeId: 'n-new' }));

      // lru-chain-0 was evicted
      expect(getDebugBuffer('lru-chain-0')).toEqual([]);
      // New chain exists
      expect(getDebugBuffer('lru-chain-1000')).toHaveLength(1);
      // lru-chain-1 still exists (was second oldest)
      expect(getDebugBuffer('lru-chain-1')).toHaveLength(1);
    });
  });

  // ═══════════════════════════════════════════════════════
  // initDebugRecorder
  // ═══════════════════════════════════════════════════════

  describe('initDebugRecorder', () => {
    it('calls getConfigOrDefault with the correct config key', async () => {
      await initDebugRecorder();

      expect(getConfigOrDefault).toHaveBeenCalledWith(
        'rule_engine.debug_buffer_size',
        100,
      );
    });
  });

  // ═══════════════════════════════════════════════════════
  // isChainDebugEnabled
  // ═══════════════════════════════════════════════════════

  describe('isChainDebugEnabled', () => {
    it('returns true when chain configuration has debugEnabled: true', async () => {
      vi.mocked(prisma.ruleChain.findUnique).mockResolvedValue({
        configuration: { debugEnabled: true },
      } as any);

      const result = await isChainDebugEnabled('chain-1');
      expect(result).toBe(true);
    });

    it('returns false when chain configuration has debugEnabled: false', async () => {
      vi.mocked(prisma.ruleChain.findUnique).mockResolvedValue({
        configuration: { debugEnabled: false },
      } as any);

      const result = await isChainDebugEnabled('chain-1');
      expect(result).toBe(false);
    });

    it('returns false when chain has no configuration', async () => {
      vi.mocked(prisma.ruleChain.findUnique).mockResolvedValue({
        configuration: null,
      } as any);

      const result = await isChainDebugEnabled('chain-1');
      expect(result).toBe(false);
    });

    it('returns false when chain does not exist', async () => {
      vi.mocked(prisma.ruleChain.findUnique).mockResolvedValue(null);

      const result = await isChainDebugEnabled('chain-1');
      expect(result).toBe(false);
    });

    it('returns false when prisma throws an error', async () => {
      vi.mocked(prisma.ruleChain.findUnique).mockRejectedValue(
        new Error('DB connection failed'),
      );

      const result = await isChainDebugEnabled('chain-1');
      expect(result).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════
  // closeDebugRedis
  // ═══════════════════════════════════════════════════════

  describe('closeDebugRedis', () => {
    it('calls quit on the Redis publisher when one exists', async () => {
      // Force Redis publisher to be created by recording a debug entry
      recordDebug('chain-1', makeRecord());
      mockQuit.mockClear();

      await closeDebugRedis();
      expect(mockQuit).toHaveBeenCalledOnce();
    });
  });
});
