import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    systemConfig: { findUnique: vi.fn() },
    assetTemplate: { findFirst: vi.fn() },
  },
}));
vi.mock('../../../lib/prisma.js', () => ({ prisma: mockPrisma }));

const createMock = vi.fn();
vi.mock('../../assets/services/instance.service.js', () => ({
  instanceService: { create: (...args: any[]) => createMock(...args) },
}));

vi.mock('../../../lib/reauth-check.js', () => ({
  enforceReauth: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../../lib/build-context.js', () => ({
  buildContext: vi.fn(() => ({ userId: 'test-user', userSub: 'test-sub', userRole: 'SUPER_ADMIN', ipAddress: '127.0.0.1', userAgent: 'test', sessionId: 'test-session', isOfflineReplay: false })),
}));

const OPTS = { ahuType: ['Process', 'Non Process'], filterType: ['HEPA', 'PRE'], micronSize: ['5', '10'] };
const AUTH = { authorization: 'Bearer test-token' };
const AHU = '11111111-1111-1111-1111-111111111111';

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorate('requirePermission', (_p: string) => async () => {});
  app.decorate('requireAnyPermission', (..._p: string[]) => async () => {});
  const { AppError } = await import('../../../lib/errors.js');
  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
    }
    // Fastify schema validation errors have statusCode 400 and a validation array
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: 'VALIDATION_ERROR', message: err.message });
    }
    return reply.code(500).send({ error: 'INTERNAL', message: err.message });
  });
  const { default: hierarchyRoutes } = await import('../routes.js');
  await app.register(hierarchyRoutes, { prefix: '/api/hierarchy' });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.systemConfig.findUnique.mockResolvedValue({ configValue: { value: OPTS } });
  mockPrisma.assetTemplate.findFirst.mockResolvedValue({ id: 'tmpl-1', version: 3 });
  createMock.mockResolvedValue({ id: 'filter-1', name: 'F1' });
});

describe('POST /api/hierarchy/filters', () => {
  it('creates a filter, resolves template internally, maps field-options into attributes', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/hierarchy/filters', headers: AUTH,
      payload: { name: 'F1', ahuId: AHU, filterSet: 'A', ahuType: 'process', filterType: 'HEPA', micronSize: '5' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ success: true, data: { id: 'filter-1', name: 'F1' } });
    expect(createMock).toHaveBeenCalledTimes(1);
    const [data] = createMock.mock.calls[0];
    expect(data).toMatchObject({
      name: 'F1', templateId: 'tmpl-1', parentId: AHU, filterSet: 'A',
      attributes: { ahuType: 'Process', filterType: 'HEPA', micronSize: '5' },
    });
    await app.close();
  });

  it('rejects an out-of-list dropdown value with 400 + "must be one of", without creating', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/hierarchy/filters', headers: AUTH,
      payload: { name: 'Bad', ahuId: AHU, filterType: 'CARBON' },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('must be one of');
    expect(createMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('400s when no FILTER template is configured', async () => {
    mockPrisma.assetTemplate.findFirst.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST', url: '/api/hierarchy/filters', headers: AUTH,
      payload: { name: 'F2', ahuId: AHU },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json())).toContain('FILTER template');
    expect(createMock).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects a missing ahuId via body schema (400)', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/hierarchy/filters', headers: AUTH, payload: { name: 'F3' } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('passes filterProfileId through and folds lastCleaningDate into attributes', async () => {
    const app = await buildApp();
    const PROFILE = '22222222-2222-2222-2222-222222222222';
    const res = await app.inject({
      method: 'POST', url: '/api/hierarchy/filters', headers: AUTH,
      payload: { name: 'F4', ahuId: AHU, filterProfileId: PROFILE, lastCleaningDate: '2026-01-15' },
    });
    expect(res.statusCode).toBe(201);
    const [data] = createMock.mock.calls[0];
    expect(data.filterProfileId).toBe(PROFILE);
    expect(data.attributes).toEqual({ lastCleaningDate: '2026-01-15' });
    await app.close();
  });
});
