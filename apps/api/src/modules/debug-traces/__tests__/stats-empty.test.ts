import { describe, it, expect, vi } from 'vitest';

/**
 * With no audited operation in the window the success rates read 0, not 100.
 * Unreachable on the shared test database (every suite writes audit rows), so
 * the two counts are stubbed; everything else is the real route.
 */

const { count } = vi.hoisted(() => ({ count: vi.fn() }));
vi.mock('../../../lib/prisma.js', () => ({ prisma: { auditTrail: { count } } }));

import Fastify from 'fastify';
import debugTraceRoutes from '../routes.js';

describe('GET /stats with no traffic', () => {
  it('reports 0% (nothing happened), never a fabricated 100%', async () => {
    count.mockResolvedValue(0);
    const app = Fastify({ logger: false });
    app.decorate('requirePermission', () => async () => {});
    app.addHook('onRequest', async (req: any) => { req.user = { role: 'SUPER_ADMIN' }; });
    await app.register(debugTraceRoutes, { prefix: '/api/debug/traces' });
    const res = await app.inject({ method: 'GET', url: '/api/debug/traces/stats' });
    expect(res.json()).toEqual({
      successRate1h: 0, successRate24h: 0, avgDurationMs: 0, topErrors: [], byTransport: { API: { total: 0, failed: 0 } },
    });
    // SUPER_ADMIN reads unscoped: the where is the bare time window.
    expect(Object.keys(count.mock.calls[0][0].where)).toEqual(['timestamp']);
    await app.close();
  });
});
