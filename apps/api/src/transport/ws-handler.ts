/**
 * WebSocket Handler — Real-time data streaming over @fastify/websocket.
 *
 * Flow:
 *   1. Client connects to /api/ws
 *   2. Must send AUTH { type: "AUTH", token: "JWT" } within 5 seconds
 *   3. Server validates JWT → AUTH_OK or close 4001
 *   4. SUBSCRIBE { type: "SUBSCRIBE", entityId, keys } / UNSUBSCRIBE { type: "UNSUBSCRIBE", entityId }
 *   5. Server subscribes to internal-bus channel `ws:events` for broadcasting
 *      (Phase 4 — was Redis pub/sub)
 *   6. Track connections per user, max from SystemConfig (default 5)
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type WebSocket from 'ws';
import { bus, type BusUnsubscribe } from '../lib/internal-bus.js';
import { verifyToken } from '../lib/jwt.js';
import { prisma } from '../lib/prisma.js';

interface WsClient {
  userId: string;
  username: string;
  role: string;
  ws: WebSocket;
  subscriptions: Set<string>; // entityId set
  authenticated: boolean;
}

// Track active connections per user
const connectionsByUser = new Map<string, Set<WsClient>>();
const allClients = new Set<WsClient>();

// Default max connections per user
const DEFAULT_MAX_CONNECTIONS = 5;

// Per-client subscription cap. Closes the May 16 H4 DoS where any
// authenticated user could call Set.add(entityId) repeatedly to grow
// the bus-relay walk cost without bound. Real installs have <2k entities;
// 1000 is generous headroom.
const MAX_SUBSCRIPTIONS_PER_CLIENT = 1000;

let busUnsubscribe: BusUnsubscribe | null = null;

async function getMaxConnectionsPerUser(): Promise<number> {
  try {
    const config = await prisma.systemConfig.findUnique({
      where: { configKey: 'session' },
    });
    if (config?.configValue) {
      const val = config.configValue as Record<string, unknown>;
      if (typeof val.maxWebsocketConnectionsPerUser === 'number') {
        return val.maxWebsocketConnectionsPerUser;
      }
    }
  } catch {
    // Ignore — use default
  }
  return DEFAULT_MAX_CONNECTIONS;
}

/**
 * Phase 4: subscribe to internal-bus 'ws:events' channel. Replaces the prior
 * Redis pub/sub subscription. Same payload shape, same broadcast semantics.
 */
function initBusSubscriber(): void {
  if (busUnsubscribe) return;
  busUnsubscribe = bus.on<{ entityId: string; type: string; data: Record<string, unknown> }>('ws:events', (event) => {
    if (!event || typeof event !== 'object' || typeof event.entityId !== 'string') return;
    const deadClients: WsClient[] = [];
    for (const client of allClients) {
      if (!client.authenticated) continue;
      if (!client.subscriptions.has(event.entityId)) continue;
      try {
        client.ws.send(JSON.stringify({
          type: 'DATA',
          entityId: event.entityId,
          dataType: event.type,
          data: event.data,
          timestamp: new Date().toISOString(),
        }));
      } catch {
        deadClients.push(client);
      }
    }
    for (const dead of deadClients) {
      removeConnection(dead);
    }
  });
  console.info('[WS] Subscribed to internal-bus channel ws:events');
}

/**
 * Per-entity authorization for WS SUBSCRIBE.
 *
 * Delta-audit 2026-05-20 §C3 / May 16 §1.4 fix. Pre-fix any authenticated
 * user could subscribe to any entityId and receive live telemetry / RPC /
 * attribute streams for entities outside their visibility scope.
 *
 * Mirrors the HTTP-route visibility semantics from
 * `apps/api/src/modules/assets/routes/instance.routes.ts` so WS and REST
 * answer the same question the same way:
 *   - SUPER_ADMIN / ADMIN bypass.
 *   - Otherwise, opt-in scoping: if any EntityAssignment / TemplateAssignment
 *     row targets this user (USER) or their role (ROLE), only those entities
 *     (plus the user's own creations) are visible. If no rows target the
 *     user, scoping is OFF and ASSET_VIEW alone is the gate.
 *
 * This deliberately does NOT call requirePermission('ASSET_VIEW') — the
 * @fastify/websocket plugin doesn't run pre-handlers. The JWT verify step
 * already established the user is authenticated; we treat any authenticated
 * principal as having read access UNLESS opt-in scoping is active.
 */
async function canSubscribeToEntity(client: WsClient, entityId: string): Promise<boolean> {
  if (client.role === 'SUPER_ADMIN' || client.role === 'ADMIN') return true;

  const entity = await prisma.assetInstance.findUnique({
    where: { id: entityId },
    select: { id: true, templateId: true, createdBy: true },
  });
  if (!entity) return false; // refuse subscriptions to non-existent entities

  // Opt-in scoping check — keyed by USER + ROLE.
  const [entityRows, templateRows] = await Promise.all([
    prisma.entityAssignment.findMany({
      where: {
        OR: [
          { assigneeType: 'USER', userId: client.userId },
          { assigneeType: 'ROLE', roleValue: client.role },
        ],
      },
      select: { entityId: true },
      take: 10000,
    }),
    prisma.templateAssignment.findMany({
      where: { assigneeType: 'USER', userId: client.userId },
      select: { templateId: true },
      take: 10000,
    }),
  ]);

  const assignedEntityIds = new Set(entityRows.map((r) => r.entityId));
  const assignedTemplateIds = new Set(templateRows.map((r) => r.templateId));
  const hasExplicit = assignedEntityIds.size > 0 || assignedTemplateIds.size > 0;
  if (!hasExplicit) return true; // opt-in scoping inactive → ASSET_VIEW grants all

  if (assignedEntityIds.has(entityId)) return true;
  if (entity.templateId && assignedTemplateIds.has(entity.templateId)) return true;
  if (entity.createdBy && entity.createdBy === client.username) return true;
  return false;
}

function addConnection(client: WsClient): boolean {
  const userConns = connectionsByUser.get(client.userId) ?? new Set();
  connectionsByUser.set(client.userId, userConns);
  userConns.add(client);
  allClients.add(client);
  return true;
}

function removeConnection(client: WsClient): void {
  allClients.delete(client);
  const userConns = connectionsByUser.get(client.userId);
  if (userConns) {
    userConns.delete(client);
    if (userConns.size === 0) {
      connectionsByUser.delete(client.userId);
    }
  }
}

export default async function wsHandler(app: FastifyInstance) {
  // Initialize Redis subscriber for broadcasting
  initBusSubscriber();

  app.get('/api/ws', {
    websocket: true,
    schema: {
      tags: ['WebSocket'],
      summary: 'WebSocket connection',
      description: 'Real-time data streaming. Send AUTH message first, then SUBSCRIBE/UNSUBSCRIBE.',
      security: [],
    },
  }, (socket: WebSocket, _req: FastifyRequest) => {
    const client: WsClient = {
      userId: '',
      username: '',
      role: '',
      ws: socket,
      subscriptions: new Set(),
      authenticated: false,
    };

    // 5-second authentication timeout
    const authTimeout = setTimeout(() => {
      if (!client.authenticated) {
        try {
          socket.close(4001, 'Authentication timeout');
        } catch {
          // Already closed
        }
      }
    }, 5000);

    socket.on('message', async (raw: Buffer | ArrayBuffer | Buffer[]) => {
      let msg: Record<string, unknown>;
      try {
        const str = Buffer.isBuffer(raw) ? raw.toString('utf-8') : String(raw);
        msg = JSON.parse(str);
      } catch {
        socket.send(JSON.stringify({ type: 'ERROR', message: 'Invalid JSON' }));
        return;
      }

      const type = msg.type as string;

      // ─── AUTH ───
      if (type === 'AUTH') {
        clearTimeout(authTimeout);

        if (client.authenticated) {
          socket.send(JSON.stringify({ type: 'ERROR', message: 'Already authenticated' }));
          return;
        }

        const token = msg.token as string;
        if (!token) {
          socket.close(4001, 'Missing token');
          return;
        }

        try {
          const payload = await verifyToken(token);

          // Verify session is active
          const session = await prisma.session.findFirst({
            where: { id: payload.sessionId, isActive: true },
          });

          if (!session || session.expiresAt < new Date()) {
            socket.close(4001, 'Invalid or expired session');
            return;
          }

          // Check max connections per user
          const maxConns = await getMaxConnectionsPerUser();
          const existingConns = connectionsByUser.get(payload.sub);
          if (existingConns && existingConns.size >= maxConns) {
            socket.close(4008, `Max ${maxConns} connections per user`);
            return;
          }

          client.userId = payload.sub;
          client.username = payload.username;
          client.role = payload.role;
          client.authenticated = true;

          addConnection(client);

          socket.send(JSON.stringify({
            type: 'AUTH_OK',
            username: payload.username,
            role: payload.role,
          }));
        } catch {
          socket.close(4001, 'Invalid token');
        }
        return;
      }

      // ─── All subsequent messages require authentication ───
      if (!client.authenticated) {
        socket.send(JSON.stringify({ type: 'ERROR', message: 'Not authenticated. Send AUTH first.' }));
        return;
      }

      // ─── SUBSCRIBE ───
      if (type === 'SUBSCRIBE') {
        const entityId = msg.entityId as string;
        if (!entityId) {
          socket.send(JSON.stringify({ type: 'ERROR', message: 'Missing entityId' }));
          return;
        }

        if (client.subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CLIENT) {
          socket.send(JSON.stringify({
            type: 'ERROR',
            code: 'SUBSCRIPTION_LIMIT',
            message: `Max ${MAX_SUBSCRIPTIONS_PER_CLIENT} subscriptions per connection`,
          }));
          return;
        }

        const allowed = await canSubscribeToEntity(client, entityId);
        if (!allowed) {
          socket.send(JSON.stringify({
            type: 'ERROR',
            code: 'FORBIDDEN',
            message: 'Not authorized to subscribe to this entity',
            entityId,
          }));
          return;
        }

        client.subscriptions.add(entityId);
        socket.send(JSON.stringify({
          type: 'SUBSCRIBED',
          entityId,
          keys: msg.keys ?? [],
        }));
        return;
      }

      // ─── UNSUBSCRIBE ───
      if (type === 'UNSUBSCRIBE') {
        const entityId = msg.entityId as string;
        if (!entityId) {
          socket.send(JSON.stringify({ type: 'ERROR', message: 'Missing entityId' }));
          return;
        }

        client.subscriptions.delete(entityId);
        socket.send(JSON.stringify({
          type: 'UNSUBSCRIBED',
          entityId,
        }));
        return;
      }

      // ─── PING (keepalive) ───
      if (type === 'PING') {
        socket.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        return;
      }

      socket.send(JSON.stringify({ type: 'ERROR', message: `Unknown message type: ${type}` }));
    });

    socket.on('close', () => {
      clearTimeout(authTimeout);
      removeConnection(client);
    });

    socket.on('error', () => {
      clearTimeout(authTimeout);
      removeConnection(client);
    });
  });
}

/**
 * Phase 4: unsubscribe from internal-bus on shutdown. Renamed from
 * `closeWsRedis` to match current architecture (post-Phase-4 retired Redis).
 */
export async function closeWsBus(): Promise<void> {
  if (busUnsubscribe) {
    busUnsubscribe();
    busUnsubscribe = null;
  }
}
