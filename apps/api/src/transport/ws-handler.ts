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
