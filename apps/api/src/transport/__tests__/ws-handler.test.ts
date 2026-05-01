import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockBusOn, mockBusEmit, mockUnsubscribe, mockVerifyToken, mockPrisma } = vi.hoisted(() => {
  const mockUnsubscribe = vi.fn();
  return {
    mockBusOn: vi.fn(() => mockUnsubscribe),
    mockBusEmit: vi.fn(),
    mockUnsubscribe,
    mockVerifyToken: vi.fn(),
    mockPrisma: {
      systemConfig: { findUnique: vi.fn() },
      session: { findFirst: vi.fn() },
    },
  };
});

// Phase 4 (2026-05-01): bus replaces Redis pub/sub.
vi.mock('../../lib/internal-bus.js', () => ({
  bus: { on: mockBusOn, emit: mockBusEmit, off: vi.fn(), listenerCount: vi.fn(() => 0) },
}));

vi.mock('../../lib/jwt.js', () => ({ verifyToken: mockVerifyToken }));
vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import wsHandler, { closeWsRedis } from '../ws-handler.js';

function createMockSocket() {
  const handlers: Record<string, Function> = {};
  const sent: string[] = [];
  return {
    on: vi.fn((event: string, handler: Function) => { handlers[event] = handler; }),
    send: vi.fn((data: string) => { sent.push(data); }),
    close: vi.fn(),
    handlers,
    sent,
  };
}

describe('ws-handler', () => {
  let wsRoute: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    const app: any = {
      get: vi.fn((_path: string, _opts: any, handler: Function) => {
        wsRoute = handler;
      }),
    };
    await wsHandler(app);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registers the /api/ws route', () => {
    expect(wsRoute).toBeDefined();
  });

  it('sends ERROR on invalid JSON message', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    // Trigger message handler with invalid JSON
    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from('not json'));

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent.type).toBe('ERROR');
    expect(lastSent.message).toBe('Invalid JSON');
  });

  it('requires AUTH before other messages', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from(JSON.stringify({ type: 'SUBSCRIBE', entityId: 'e1' })));

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent.type).toBe('ERROR');
    expect(lastSent.message).toContain('Not authenticated');
  });

  it('closes socket on auth timeout', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    // Advance past 5-second auth timeout
    vi.advanceTimersByTime(5001);

    expect(socket.close).toHaveBeenCalledWith(4001, 'Authentication timeout');
  });

  it('closes socket when AUTH token is missing', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from(JSON.stringify({ type: 'AUTH' })));

    expect(socket.close).toHaveBeenCalledWith(4001, 'Missing token');
  });

  it('closes socket on invalid token', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    mockVerifyToken.mockRejectedValue(new Error('Invalid token'));

    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from(JSON.stringify({ type: 'AUTH', token: 'bad-token' })));

    expect(socket.close).toHaveBeenCalledWith(4001, 'Invalid token');
  });

  it('authenticates successfully with valid token and session', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    mockVerifyToken.mockResolvedValue({
      sub: 'user1', username: 'admin', role: 'ADMIN', sessionId: 's1',
    });
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1', isActive: true, expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from(JSON.stringify({ type: 'AUTH', token: 'valid-token' })));

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent.type).toBe('AUTH_OK');
    expect(lastSent.username).toBe('admin');
  });

  it('handles SUBSCRIBE after authentication', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    // Authenticate first
    mockVerifyToken.mockResolvedValue({
      sub: 'user1', username: 'admin', role: 'ADMIN', sessionId: 's1',
    });
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1', isActive: true, expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from(JSON.stringify({ type: 'AUTH', token: 'valid-token' })));

    // Subscribe
    await onMessage(Buffer.from(JSON.stringify({ type: 'SUBSCRIBE', entityId: 'e1' })));

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent.type).toBe('SUBSCRIBED');
    expect(lastSent.entityId).toBe('e1');
  });

  it('handles UNSUBSCRIBE', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    mockVerifyToken.mockResolvedValue({
      sub: 'user1', username: 'admin', role: 'ADMIN', sessionId: 's1',
    });
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1', isActive: true, expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from(JSON.stringify({ type: 'AUTH', token: 'valid-token' })));
    await onMessage(Buffer.from(JSON.stringify({ type: 'UNSUBSCRIBE', entityId: 'e1' })));

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent.type).toBe('UNSUBSCRIBED');
    expect(lastSent.entityId).toBe('e1');
  });

  it('handles PING with PONG', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    mockVerifyToken.mockResolvedValue({
      sub: 'user1', username: 'admin', role: 'ADMIN', sessionId: 's1',
    });
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1', isActive: true, expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from(JSON.stringify({ type: 'AUTH', token: 'valid-token' })));
    await onMessage(Buffer.from(JSON.stringify({ type: 'PING' })));

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent.type).toBe('PONG');
    expect(lastSent.timestamp).toBeDefined();
  });

  it('returns error for unknown message type', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    mockVerifyToken.mockResolvedValue({
      sub: 'user1', username: 'admin', role: 'ADMIN', sessionId: 's1',
    });
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1', isActive: true, expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.systemConfig.findUnique.mockResolvedValue(null);

    const onMessage = socket.handlers['message'];
    await onMessage(Buffer.from(JSON.stringify({ type: 'AUTH', token: 'valid-token' })));
    await onMessage(Buffer.from(JSON.stringify({ type: 'UNKNOWN_TYPE' })));

    const lastSent = JSON.parse(socket.sent[socket.sent.length - 1]);
    expect(lastSent.type).toBe('ERROR');
    expect(lastSent.message).toContain('Unknown message type');
  });

  describe('closeWsRedis', () => {
    // Phase 4 (2026-05-01): name kept for shutdown handler compatibility;
    // body now unsubscribes from the in-process bus.
    it('unsubscribes from internal-bus', async () => {
      await closeWsRedis();
      expect(mockUnsubscribe).toHaveBeenCalled();
    });
  });

  it('cleans up on socket close event', async () => {
    const socket = createMockSocket();
    wsRoute(socket, {});

    // Trigger close handler
    const onClose = socket.handlers['close'];
    expect(onClose).toBeDefined();
    onClose();
    // No error thrown — connection tracking cleaned up
  });
});
