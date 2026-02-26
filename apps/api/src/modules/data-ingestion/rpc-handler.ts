/**
 * RPC Flow Helpers — Publish RPC requests to devices via MQTT, track responses in Redis.
 */

import { randomUUID } from 'node:crypto';
import IORedis from 'ioredis';
import { getMqttClient } from '../../transport/mqtt-client.js';
import { prisma } from '../../lib/prisma.js';

const RPC_TTL_SECONDS = 30; // Default RPC response timeout
const RPC_PREFIX = 'rpc:';

let redis: IORedis | null = null;

function getRedis(): IORedis {
  if (!redis) {
    redis = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
  }
  return redis;
}

export interface RpcRequest {
  requestId: string;
  entityId: string;
  method: string;
  params: Record<string, unknown>;
}

export interface RpcResponse {
  requestId: string;
  data: Record<string, unknown>;
  receivedAt: string;
}

/**
 * Publish an RPC request to a device via MQTT and cache the request in Redis.
 * Returns the generated requestId for polling the response.
 */
export async function publishRpcRequest(
  entityId: string,
  method: string,
  params: Record<string, unknown>,
  ttlSeconds: number = RPC_TTL_SECONDS,
): Promise<string> {
  const requestId = randomUUID();

  // Lookup entity's UNS path
  const unsMapping = await prisma.unsMapping.findUnique({
    where: { entityId },
  });

  if (!unsMapping) {
    // Fallback: try entity's unsPath field
    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { unsPath: true },
    });
    if (!entity?.unsPath) {
      throw new Error(`No UNS path found for entity ${entityId}`);
    }
    // Use entity unsPath
    const topic = `${entity.unsPath}/rpc/request/${requestId}`;
    const payload = JSON.stringify({ method, params, requestId });

    const client = getMqttClient();
    if (client) {
      await client.publishAsync(topic, payload, { qos: 1 });
    }

    // Cache the request in Redis with TTL
    const r = getRedis();
    await r.setex(
      `${RPC_PREFIX}req:${requestId}`,
      ttlSeconds,
      JSON.stringify({ requestId, entityId, method, params, createdAt: new Date().toISOString() }),
    );

    return requestId;
  }

  const topic = `${unsMapping.unsPath}/rpc/request/${requestId}`;
  const payload = JSON.stringify({ method, params, requestId });

  const client = getMqttClient();
  if (client) {
    await client.publishAsync(topic, payload, { qos: 1 });
  }

  // Cache the request in Redis with TTL
  const r = getRedis();
  await r.setex(
    `${RPC_PREFIX}req:${requestId}`,
    ttlSeconds,
    JSON.stringify({ requestId, entityId, method, params, createdAt: new Date().toISOString() }),
  );

  return requestId;
}

/**
 * Check Redis cache for an RPC response.
 * Returns the response data or null if not yet received.
 */
export async function getRpcResponse(requestId: string): Promise<RpcResponse | null> {
  const r = getRedis();
  const raw = await r.get(`${RPC_PREFIX}res:${requestId}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as RpcResponse;
  } catch {
    return null;
  }
}

/**
 * Called by mqtt-handler when an rpc/response message arrives.
 * Stores the response in Redis so the polling endpoint can return it.
 */
export async function onRpcResponse(requestId: string, responseData: Record<string, unknown>): Promise<void> {
  const r = getRedis();
  const response: RpcResponse = {
    requestId,
    data: responseData,
    receivedAt: new Date().toISOString(),
  };

  // Store with same TTL as the request (or 60s if request already expired)
  const reqTtl = await r.ttl(`${RPC_PREFIX}req:${requestId}`);
  const ttl = reqTtl > 0 ? reqTtl : 60;

  await r.setex(`${RPC_PREFIX}res:${requestId}`, ttl, JSON.stringify(response));
}

/**
 * Clean up Redis connection on shutdown.
 */
export async function closeRpcRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
