import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockVerifyToken, mockPrisma } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockPrisma: {
    session: { findFirst: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    systemConfig: { findUnique: vi.fn() },
  },
}));

vi.mock('../../lib/jwt.js', () => ({ verifyToken: mockVerifyToken }));
vi.mock('../../lib/prisma.js', () => ({ prisma: mockPrisma }));

import authPlugin from '../auth.js';

function makeReq(overrides: Record<string, any> = {}) {
  return {
    url: '/api/users',
    method: 'GET',
    headers: { authorization: 'Bearer valid-token' },
    user: null as any,
    ...overrides,
  } as any;
}

function makeReply() {
  const reply: any = {
    code: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  };
  return reply;
}

describe('authPlugin', () => {
  let onRequestHook: Function;

  beforeEach(async () => {
    vi.clearAllMocks();
    const app = {
      addHook: vi.fn((event: string, handler: Function) => {
        if (event === 'onRequest') onRequestHook = handler;
      }),
    } as any;
    await authPlugin(app, {});
  });

  it('skips auth for public paths (login)', async () => {
    const req = makeReq({ url: '/api/auth/login' });
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it('skips auth for health endpoint', async () => {
    const req = makeReq({ url: '/api/health' });
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it('skips auth for branding GET', async () => {
    const req = makeReq({ url: '/api/config/branding', method: 'GET' });
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(mockVerifyToken).not.toHaveBeenCalled();
  });

  it('rejects requests without authorization header', async () => {
    const req = makeReq({ headers: {} });
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('verifies token and attaches user to request', async () => {
    const payload = { sub: 'u1', username: 'admin', role: 'ADMIN', sessionId: 's1' };
    mockVerifyToken.mockResolvedValue(payload);
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1',
      isActive: true,
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: 'ENABLED',
      forcePasswordChange: false,
      passwordExpiresAt: new Date(Date.now() + 86400000),
    });
    mockPrisma.session.update.mockResolvedValue({});
    mockPrisma.systemConfig.findUnique.mockResolvedValue({ configValue: { sessionDurationHours: 8 } });

    const req = makeReq();
    const reply = makeReply();

    await onRequestHook(req, reply);

    expect(req.user).toEqual(payload);
    expect(mockPrisma.session.update).toHaveBeenCalled(); // lastActiveAt
  });

  it('rejects expired sessions', async () => {
    const payload = { sub: 'u1', username: 'admin', role: 'ADMIN', sessionId: 's1' };
    mockVerifyToken.mockResolvedValue(payload);
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1',
      isActive: true,
      expiresAt: new Date(Date.now() - 1000), // expired
    });
    mockPrisma.session.update.mockResolvedValue({});

    const req = makeReq();
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('rejects inactive sessions', async () => {
    const payload = { sub: 'u1', username: 'admin', role: 'ADMIN', sessionId: 's1' };
    mockVerifyToken.mockResolvedValue(payload);
    mockPrisma.session.findFirst.mockResolvedValue(null); // no active session

    const req = makeReq();
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('rejects disabled users', async () => {
    const payload = { sub: 'u1', username: 'admin', role: 'ADMIN', sessionId: 's1' };
    mockVerifyToken.mockResolvedValue(payload);
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1',
      isActive: true,
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: 'DISABLED',
    });

    const req = makeReq();
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });

  it('forces password change when password expired', async () => {
    const payload = { sub: 'u1', username: 'admin', role: 'ADMIN', sessionId: 's1' };
    mockVerifyToken.mockResolvedValue(payload);
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1',
      isActive: true,
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: 'ENABLED',
      forcePasswordChange: true,
      passwordExpiresAt: new Date(Date.now() - 86400000), // expired
    });

    const req = makeReq({ url: '/api/users' }); // not in whitelist
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(reply.code).toHaveBeenCalledWith(403);
  });

  it('allows password change endpoint when force password change is true', async () => {
    const payload = { sub: 'u1', username: 'admin', role: 'ADMIN', sessionId: 's1' };
    mockVerifyToken.mockResolvedValue(payload);
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1',
      isActive: true,
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: 'ENABLED',
      forcePasswordChange: true,
      passwordExpiresAt: new Date(Date.now() + 86400000),
    });
    mockPrisma.session.update.mockResolvedValue({});

    const req = makeReq({ url: '/api/auth/change-password' });
    const reply = makeReply();

    await onRequestHook(req, reply);
    // Should NOT return 403 for password change endpoint
    expect(reply.code).not.toHaveBeenCalledWith(403);
  });

  it('returns 401 on token verification failure', async () => {
    mockVerifyToken.mockRejectedValue(new Error('Token expired'));

    const req = makeReq();
    const reply = makeReply();

    await onRequestHook(req, reply);
    expect(reply.code).toHaveBeenCalledWith(401);
  });
});
