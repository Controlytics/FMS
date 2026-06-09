/**
 * RPC request/response correlation cache (Phase 4 — 2026-05-01).
 *
 * Replaces the Redis SETEX-based correlation in rpc-handler.ts with an
 * in-process Map. RPC correlation was never pub/sub — it was a TTL cache
 * for matching device responses to outstanding requests. In-process is the
 * right scope: the API server that issued an RPC is also the one that
 * receives the MQTT response (subscribes to the device's response topic),
 * so correlation state never needs to cross process boundaries.
 *
 * Periodic sweep cleans expired entries — same effect as Redis TTL.
 */

interface CachedRequest {
  requestId: string;
  entityId: string;
  method: string;
  params: Record<string, unknown>;
  createdAt: string;
  expiresAt: number; // ms epoch
}

interface CachedResponse {
  requestId: string;
  data: Record<string, unknown>;
  receivedAt: string;
  expiresAt: number;
}

const requests = new Map<string, CachedRequest>();
const responses = new Map<string, CachedResponse>();

let sweepHandle: NodeJS.Timeout | null = null;

function scheduleSweep() {
  if (sweepHandle) return;
  sweepHandle = setInterval(() => {
    const now = Date.now();
    for (const [id, r] of requests) if (r.expiresAt <= now) requests.delete(id);
    for (const [id, r] of responses) if (r.expiresAt <= now) responses.delete(id);
  }, 10_000);
  // Don't keep the process alive just for sweep.
  sweepHandle.unref?.();
}

scheduleSweep();

export function setRequest(req: Omit<CachedRequest, 'expiresAt'> & { ttlSeconds: number }): void {
  const { ttlSeconds, ...rest } = req;
  requests.set(rest.requestId, { ...rest, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export function getResponse(requestId: string): { requestId: string; data: Record<string, unknown>; receivedAt: string } | null {
  const r = responses.get(requestId);
  if (!r) return null;
  if (r.expiresAt <= Date.now()) {
    responses.delete(requestId);
    return null;
  }
  return { requestId: r.requestId, data: r.data, receivedAt: r.receivedAt };
}

export function setResponse(requestId: string, data: Record<string, unknown>, fallbackTtlSeconds = 60): void {
  // Match TTL of the original request if it's still cached, else use fallback.
  const reqEntry = requests.get(requestId);
  const ttl = reqEntry ? Math.max(1, Math.floor((reqEntry.expiresAt - Date.now()) / 1000)) : fallbackTtlSeconds;
  responses.set(requestId, {
    requestId,
    data,
    receivedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttl * 1000,
  });
}

/** Test helper — clears state between tests. */
export function _resetForTests(): void {
  requests.clear();
  responses.clear();
}
