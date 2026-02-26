/**
 * Debug Recorder — Per-chain ring buffer for debug records.
 * Records node execution details when debug is enabled.
 * Streams to Redis pub/sub for real-time debug panel.
 */

import IORedis from 'ioredis';
import type { DebugRecord } from './types.js';
import { getConfigOrDefault } from '../data-ingestion/ingestion-config.service.js';

// Per-chain ring buffers with LRU eviction
const debugBuffers = new Map<string, DebugRecord[]>();
const chainLastAccess = new Map<string, number>();
const MAX_CHAINS = 1000;
let maxBufferSize = 100;
let redisPub: IORedis | null = null;

function getRedisPublisher(): IORedis {
  if (!redisPub) {
    redisPub = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return redisPub;
}

/** Initialize the debug recorder with config. */
export async function initDebugRecorder(): Promise<void> {
  maxBufferSize = await getConfigOrDefault<number>('rule_engine.debug_buffer_size', 100);
}

/** Record a debug entry for a node execution. */
export function recordDebug(chainId: string, record: DebugRecord): void {
  let buffer = debugBuffers.get(chainId);
  if (!buffer) {
    // Evict least-recently-used chains when at capacity
    if (debugBuffers.size >= MAX_CHAINS) {
      let oldestChain: string | null = null;
      let oldestTime = Infinity;
      for (const [id, ts] of chainLastAccess) {
        if (ts < oldestTime) {
          oldestTime = ts;
          oldestChain = id;
        }
      }
      if (oldestChain) {
        debugBuffers.delete(oldestChain);
        chainLastAccess.delete(oldestChain);
      }
    }
    buffer = [];
    debugBuffers.set(chainId, buffer);
  }

  chainLastAccess.set(chainId, Date.now());
  buffer.push(record);

  // Evict oldest records if over limit
  while (buffer.length > maxBufferSize) {
    buffer.shift();
  }

  // Publish to Redis for real-time streaming
  try {
    const redis = getRedisPublisher();
    redis.publish(`debug:rulechain:${chainId}`, JSON.stringify(record)).catch(() => {
      // Non-critical
    });
  } catch {
    // Non-critical
  }
}

/** Get the debug buffer for a chain. */
export function getDebugBuffer(chainId: string, limit?: number): DebugRecord[] {
  const buffer = debugBuffers.get(chainId) ?? [];
  if (limit && limit < buffer.length) {
    return buffer.slice(-limit);
  }
  return [...buffer];
}

/** Clear the debug buffer for a chain. */
export function clearDebugBuffer(chainId: string): void {
  debugBuffers.delete(chainId);
  chainLastAccess.delete(chainId);
}

/** Check if debug mode is enabled for a chain. */
export async function isChainDebugEnabled(chainId: string): Promise<boolean> {
  try {
    const { prisma } = await import('../../lib/prisma.js');
    const chain = await prisma.ruleChain.findUnique({
      where: { id: chainId },
      select: { configuration: true },
    });
    const config = (chain?.configuration as Record<string, unknown>) ?? {};
    return config.debugEnabled === true;
  } catch {
    return false;
  }
}

/** Close the Redis publisher. */
export async function closeDebugRedis(): Promise<void> {
  if (redisPub) {
    await redisPub.quit();
    redisPub = null;
  }
}
