/**
 * RPC Flow Helpers — Publish RPC requests to devices via MQTT, track responses
 * in an in-process TTL cache (Phase 4 — was Redis SETEX-based correlation).
 *
 * Why in-process is correct here:
 * the API server that issued the RPC is the same one that subscribes to the
 * device's MQTT response topic. Correlation state never needs to cross process
 * boundaries. Redis was overkill — a Map with periodic expiry sweep is enough.
 */

import { randomUUID } from 'node:crypto';
import { getMqttClient } from '../../transport/mqtt-client.js';
import { prisma } from '../../lib/prisma.js';
import { setRequest, getResponse, setResponse } from '../../lib/rpc-cache.js';

const RPC_TTL_SECONDS = 30; // Default RPC response timeout

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
 * Publish an RPC request to a device via MQTT and cache the request locally.
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

  let unsPath: string | null = null;
  if (unsMapping) {
    unsPath = unsMapping.unsPath;
  } else {
    // Fallback: try entity's unsPath field
    const entity = await prisma.assetInstance.findUnique({
      where: { id: entityId },
      select: { unsPath: true },
    });
    if (!entity?.unsPath) {
      throw new Error(`No UNS path found for entity ${entityId}`);
    }
    unsPath = entity.unsPath;
  }

  const topic = `${unsPath}/rpc/request/${requestId}`;
  const payload = JSON.stringify({ method, params, requestId });

  const client = getMqttClient();
  if (client) {
    await client.publishAsync(topic, payload, { qos: 1 });
  }

  // Cache the request in-process with TTL
  setRequest({
    requestId,
    entityId,
    method,
    params,
    createdAt: new Date().toISOString(),
    ttlSeconds,
  });

  return requestId;
}

/**
 * Check the in-process cache for an RPC response.
 * Returns the response data or null if not yet received.
 */
export async function getRpcResponse(requestId: string): Promise<RpcResponse | null> {
  return getResponse(requestId);
}

/**
 * Called by mqtt-handler when an rpc/response message arrives.
 * Stores the response so the polling endpoint can return it.
 */
export async function onRpcResponse(requestId: string, responseData: Record<string, unknown>): Promise<void> {
  setResponse(requestId, responseData);
}

