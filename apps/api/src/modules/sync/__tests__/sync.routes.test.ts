import { describe, it, expect, vi } from 'vitest';

/**
 * Phase 8.4b — Sync route registration shape.
 *
 * Asserts the route is registered at GET /since with explicit response
 * properties (so Fastify won't strip empty arrays) and no `requirePermission`
 * decorator (auth comes from the global onRequest hook in plugins/auth.ts).
 *
 * Pattern: stub Fastify-like recorder. Same approach used elsewhere where
 * spinning up the full server is overkill for a schema check.
 */

vi.mock('../../../lib/prisma.js', () => ({ prisma: {} }));

import syncRoutes from '../routes.js';

interface RouteCall {
  method: string;
  url: string;
  options: any;
}

function makeRecorder() {
  const calls: RouteCall[] = [];
  const app: any = {
    get: (url: string, options: any) => calls.push({ method: 'get', url, options }),
    post: (url: string, options: any) => calls.push({ method: 'post', url, options }),
  };
  return { app, calls };
}

describe('sync routes — registration', () => {
  it('1. registers a single GET /since with explicit response schema', async () => {
    const { app, calls } = makeRecorder();
    await syncRoutes(app);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.method).toBe('get');
    expect(c.url).toBe('/since');
    // Schema declares all 6 entity arrays + serverTimestamp + hasMore as
    // required. Required array can't be left out by Fastify on serialization.
    const required = c.options.schema.response[200].required;
    expect(required).toEqual(expect.arrayContaining([
      'filterCleaningProfiles',
      'filterProfiles',
      'equipmentGroups',
      'checklistProfiles',
      'assetTemplates',
      'filters',
      'serverTimestamp',
      'hasMore',
    ]));
  });

  it('2. has no preHandler — auth comes from the global onRequest hook', async () => {
    const { app, calls } = makeRecorder();
    await syncRoutes(app);
    const [c] = calls;
    // No requirePermission / requireAnyPermission preHandler. Global auth
    // hook in plugins/auth.ts already enforces the bearer-token check on
    // every non-public path.
    expect(c.options.preHandler).toBeUndefined();
  });

  it('3. querystring schema accepts all 6 cursor params', async () => {
    const { app, calls } = makeRecorder();
    await syncRoutes(app);
    const [c] = calls;
    const props = c.options.schema.querystring.properties;
    expect(props).toEqual(expect.objectContaining({
      profileVersion: expect.any(Object),
      filterProfileVersion: expect.any(Object),
      equipmentGroupVersion: expect.any(Object),
      checklistVersion: expect.any(Object),
      assetTemplateVersion: expect.any(Object),
      filterUpdatedSince: expect.any(Object),
    }));
    // version cursors are integers >= 0
    expect(props.profileVersion.type).toBe('integer');
    expect(props.profileVersion.minimum).toBe(0);
  });
});
