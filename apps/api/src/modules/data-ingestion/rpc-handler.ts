/**
 * RPC Flow Helpers — Publish RPC requests to devices via MQTT, track responses in PostgreSQL.
 * Replaces Redis key-value caching with in-memory Map (RPC requests are short-lived, 30s TTL).
 */

import { randomUUID } from 'node:crypto';
import { getMqttClient } from '../../transport/mqtt-client.js';
import { prisma } from '../../lib/prisma.js';

const RPC_TTL_SECONDS = 30; // Default RPC response timeout

// In-memory RPC request/response tracking (short-lived, auto-cleaned)
const rpcRequests = new Map<string, { entityId: string; method: string; params: Record<string, unknown>; createdAt: string; expiresAt: number }>();
const rpcResponses = new Map<string, RpcResponse>();

// Periodic cleanup of expired entries (every 30s)
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, req] of rpcRequests) {
    if (now > req.expiresAt) rpcRequests.delete(id);
  }
  for (const [id] of rpcResponses) {
    if (!rpcRequests.has(id)) rpcResponses.delete(id);
  }
}, 30_000);
if (cleanupTimer.unref) cleanupTimer.unref();

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
 * Publish an RPC request to a device via MQTT and cache the request in memory.
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

  let topic: string;
  if (!unsMapping) {
    // Fallback: try entity's unsPath field
    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { unsPath: true },
    });
    if (!entity?.unsPath) {
      throw new Error(`No UNS path found for entity ${entityId}`);
    }
    topic = `${entity.unsPath}/rpc/request/${requestId}`;
  } else {
    topic = `${unsMapping.unsPath}/rpc/request/${requestId}`;
  }

  const payload = JSON.stringify({ method, params, requestId });

  const client = getMqttClient();
  if (client) {
    await client.publishAsync(topic, payload, { qos: 1 });
  }

  // Cache the request in memory with TTL
  rpcRequests.set(requestId, {
    entityId,
    method,
    params,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlSeconds * 1000,
  });

  return requestId;
}

/**
 * Check cache for an RPC response.
 * Returns the response data or null if not yet received.
 */
export async function getRpcResponse(requestId: string): Promise<RpcResponse | null> {
  return rpcResponses.get(requestId) ?? null;
}

/**
 * Called by mqtt-handler when an rpc/response message arrives.
 * Stores the response in memory so the polling endpoint can return it.
 */
export async function onRpcResponse(requestId: string, responseData: Record<string, unknown>): Promise<void> {
  const response: RpcResponse = {
    requestId,
    data: responseData,
    receivedAt: new Date().toISOString(),
  };
  rpcResponses.set(requestId, response);
}

/**
 * Clean up on shutdown.
 */
export async function closeRpcHandler(): Promise<void> {
  clearInterval(cleanupTimer);
  rpcRequests.clear();
  rpcResponses.clear();
}
