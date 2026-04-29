import { describe, it, expect, beforeEach, vi } from 'vitest';

const { mockVerifyToken, mockPrisma } = vi.hoisted(() => ({
  mockVerifyToken: vi.fn(),
  mockPrisma: {
    session: { findFirst: vi.fn(), update: vi.fn() },
    user: { findUnique: vi.fn(), update: vi.fn() },
    // auth.ts uses systemConfig.findFirst({where:{configKey:'session'}}) to
    // resolve the sliding-window duration. findUnique kept for any other
    // call site that may want exact-PK lookup.
    systemConfig: { findFirst: vi.fn(), findUnique: vi.fn() },
    // Resolve role scope (GLOBAL / ORGANIZATION). Default to ORGANIZATION
    // unless the test overrides for a specific case.
    role: { findFirst: vi.fn().mockResolvedValue({ scope: 'ORGANIZATION' }) },
    // Looked up only when the user has an organizationId. Tests that don't
    // set organizationId on the user skip this path entirely.
    organization: { findUnique: vi.fn().mockResolvedValue({ isActive: true }) },
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
      // auth.ts checks Date.now() - createdAt against MAX_ABSOLUTE_SESSION_MS,
      // so the session must include createdAt to avoid throwing inside the
      // try/catch (which would mask the test outcome with a 401).
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      role: 'ADMIN',
      username: 'admin',
      status: 'ENABLED',
      organizationId: null,
      forcePasswordChange: false,
      passwordExpiresAt: new Date(Date.now() + 86400000),
    });
    mockPrisma.session.update.mockResolvedValue({});
    // session-duration config; auth.ts queries systemConfig.findFirst with
    // configKey: 'session' to compute the sliding-window expiry.
    mockPrisma.systemConfig.findFirst.mockResolvedValue({
      configValue: { sessionDurationHours: 8 },
    });

    const req = makeReq();
    const reply = makeReply();

    await onRequestHook(req, reply);

    // auth.ts re-derives role/username/scope from the DB record and patches
    // req.user, so it's a superset of the JWT payload, not a strict equal.
    expect(req.user).toMatchObject({
      sub: payload.sub,
      sessionId: payload.sessionId,
      role: 'ADMIN',
      username: 'admin',
      scope: 'ORGANIZATION',
    });
    expect(mockPrisma.session.update).toHaveBeenCalled(); // lastActiveAt + sliding expiry
  });

  it('rejects expired sessions', async () => {
    const payload = { sub: 'u1', username: 'admin', role: 'ADMIN', sessionId: 's1' };
    mockVerifyToken.mockResolvedValue(payload);
    mockPrisma.session.findFirst.mockResolvedValue({
      id: 's1',
      isActive: true,
      createdAt: new Date(Date.now() - 60_000),
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
      createdAt: new Date(Date.now() - 60_000),
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
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: 'ENABLED',
      forcePasswordChange: true,
      passwordExpiresAt: new Date(Date.now() - 86400000), // expired
    });
    // The expired-password branch persists forcePasswordChange via user.update.
    mockPrisma.user.update.mockResolvedValue({});

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
      createdAt: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 3600000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      status: 'ENABLED',
      forcePasswordChange: true,
      passwordExpiresAt: new Date(Date.now() + 86400000),
    });
    mockPrisma.session.update.mockResolvedValue({});
    mockPrisma.systemConfig.findFirst.mockResolvedValue({
      configValue: { sessionDurationHours: 8 },
    });

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
