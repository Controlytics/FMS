import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    deviceCredential: { findUnique: vi.fn(), update: vi.fn() },
    connectivityStatus: { upsert: vi.fn() },
    unsMapping: { findUnique: vi.fn() },
    assetInstance: { findUnique: vi.fn() },
  },
}));

vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import mqttAuthRoutes from '../mqtt-auth-routes.js';

// Helper to capture route handlers registered via app.post
function createMockApp() {
  const routes: Record<string, Function> = {};
  const app = {
    post: vi.fn((path: string, _schema: any, handler: Function) => {
      routes[path] = handler;
    }),
  };
  return { app, routes };
}

function makeReply() {
  const reply: any = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockImplementation((data: any) => data),
  };
  return reply;
}

describe('mqtt-auth-routes', () => {
  let routes: Record<string, Function>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mock = createMockApp();
    await mqttAuthRoutes(mock.app as any);
    routes = mock.routes;
  });

  describe('POST /auth', () => {
    it('denies when username is missing', async () => {
      const reply = makeReply();
      await routes['/auth']({ body: {} }, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('allows server client with correct password', async () => {
      const originalEnv = process.env.EMQX_ADMIN_PASSWORD;
      process.env.EMQX_ADMIN_PASSWORD = 'secret';
      const reply = makeReply();
      const result = await routes['/auth'](
        { body: { username: '__server__digilog', password: 'secret' } },
        reply,
      );
      expect(result).toEqual({ result: 'allow' });
      process.env.EMQX_ADMIN_PASSWORD = originalEnv;
    });

    it('denies server client with wrong password', async () => {
      const originalEnv = process.env.EMQX_ADMIN_PASSWORD;
      process.env.EMQX_ADMIN_PASSWORD = 'secret';
      const reply = makeReply();
      await routes['/auth'](
        { body: { username: '__server__digilog', password: 'wrong' } },
        reply,
      );
      expect(reply.code).toHaveBeenCalledWith(401);
      process.env.EMQX_ADMIN_PASSWORD = originalEnv;
    });

    it('denies when credential not found', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue(null);
      const reply = makeReply();
      await routes['/auth']({ body: { username: 'device-token-123' } }, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('denies when credential is inactive', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({
        id: 'c1', accessToken: 'device-token', status: 'INACTIVE', isActive: false, allowedIps: [],
      });
      const reply = makeReply();
      await routes['/auth']({ body: { username: 'device-token' } }, reply);
      expect(reply.code).toHaveBeenCalledWith(401);
    });

    it('allows valid active credential and updates connectivity', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({
        id: 'c1', accessToken: 'device-token', status: 'ACTIVE', isActive: true,
        allowedIps: [], entityId: 'e1', firstConnectedAt: null,
      });
      mockPrisma.deviceCredential.update.mockResolvedValue({});
      mockPrisma.connectivityStatus.upsert.mockResolvedValue({});
      const reply = makeReply();
      const result = await routes['/auth'](
        { body: { username: 'device-token', peerhost: '10.0.0.1' } },
        reply,
      );
      expect(result).toEqual({ result: 'allow' });
      expect(mockPrisma.deviceCredential.update).toHaveBeenCalled();
      expect(mockPrisma.connectivityStatus.upsert).toHaveBeenCalled();
    });

    it('denies when IP is not in allowed list', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({
        id: 'c1', accessToken: 'device-token', status: 'ACTIVE', isActive: true,
        allowedIps: ['192.168.1.1'], entityId: 'e1',
      });
      const reply = makeReply();
      await routes['/auth'](
        { body: { username: 'device-token', peerhost: '10.0.0.1' } },
        reply,
      );
      expect(reply.code).toHaveBeenCalledWith(401);
    });
  });

  describe('POST /acl', () => {
    it('denies when required fields are missing', async () => {
      const reply = makeReply();
      await routes['/acl']({ body: {} }, reply);
      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('allows server client to publish to anything', async () => {
      const reply = makeReply();
      const result = await routes['/acl'](
        { body: { username: '__server__digilog', topic: 'digilog/v1/some/topic', action: 'publish' } },
        reply,
      );
      expect(result).toEqual({ result: 'allow' });
    });

    it('allows server client to subscribe to UNS root', async () => {
      const reply = makeReply();
      const result = await routes['/acl'](
        { body: { username: '__server__digilog', topic: 'digilog/v1/#', action: 'subscribe' } },
        reply,
      );
      expect(result).toEqual({ result: 'allow' });
    });

    it('denies server subscribe to non-UNS topic', async () => {
      const reply = makeReply();
      await routes['/acl'](
        { body: { username: '__server__digilog', topic: 'other/topic', action: 'subscribe' } },
        reply,
      );
      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('denies device with invalid credential', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue(null);
      const reply = makeReply();
      await routes['/acl'](
        { body: { username: 'device-token', topic: 'some/topic', action: 'publish' } },
        reply,
      );
      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('allows device to publish to its telemetry topic', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({
        id: 'c1', status: 'ACTIVE', entityId: 'e1',
      });
      mockPrisma.unsMapping.findUnique.mockResolvedValue({ unsPath: 'digilog/v1/plant/pump1' });
      const reply = makeReply();
      const result = await routes['/acl'](
        { body: { username: 'device-token', topic: 'digilog/v1/plant/pump1/telemetry', action: 'publish' } },
        reply,
      );
      expect(result).toEqual({ result: 'allow' });
    });

    it('denies device publishing to unauthorized topic', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({
        id: 'c1', status: 'ACTIVE', entityId: 'e1',
      });
      mockPrisma.unsMapping.findUnique.mockResolvedValue({ unsPath: 'digilog/v1/plant/pump1' });
      const reply = makeReply();
      await routes['/acl'](
        { body: { username: 'device-token', topic: 'digilog/v1/plant/pump2/telemetry', action: 'publish' } },
        reply,
      );
      expect(reply.code).toHaveBeenCalledWith(403);
    });

    it('allows device to subscribe to rpc/request', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({
        id: 'c1', status: 'ACTIVE', entityId: 'e1',
      });
      mockPrisma.unsMapping.findUnique.mockResolvedValue({ unsPath: 'digilog/v1/plant/pump1' });
      const reply = makeReply();
      const result = await routes['/acl'](
        { body: { username: 'device-token', topic: 'digilog/v1/plant/pump1/rpc/request', action: 'subscribe' } },
        reply,
      );
      expect(result).toEqual({ result: 'allow' });
    });

    it('falls back to entity unsPath when no UNS mapping', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({
        id: 'c1', status: 'ACTIVE', entityId: 'e1',
      });
      mockPrisma.unsMapping.findUnique.mockResolvedValue(null);
      mockPrisma.assetInstance.findUnique.mockResolvedValue({ unsPath: 'digilog/v1/plant/pump1' });
      const reply = makeReply();
      const result = await routes['/acl'](
        { body: { username: 'device-token', topic: 'digilog/v1/plant/pump1/telemetry', action: 'publish' } },
        reply,
      );
      expect(result).toEqual({ result: 'allow' });
    });

    it('denies when no UNS path configured', async () => {
      mockPrisma.deviceCredential.findUnique.mockResolvedValue({
        id: 'c1', status: 'ACTIVE', entityId: 'e1',
      });
      mockPrisma.unsMapping.findUnique.mockResolvedValue(null);
      mockPrisma.assetInstance.findUnique.mockResolvedValue(null);
      const reply = makeReply();
      await routes['/acl'](
        { body: { username: 'device-token', topic: 'digilog/v1/plant/pump1/telemetry', action: 'publish' } },
        reply,
      );
      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });

  describe('POST /superuser', () => {
    it('always denies', async () => {
      const reply = makeReply();
      await routes['/superuser']({}, reply);
      expect(reply.code).toHaveBeenCalledWith(403);
    });
  });
});
