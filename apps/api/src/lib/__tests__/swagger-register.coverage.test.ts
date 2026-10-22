/**
 * registerSwagger (lib/swagger.ts): the OpenAPI spec is always generated, but
 * the /docs UI exists ONLY when API_DOCS=on (fail-closed, F-01 / API-07).
 * swagger.test.ts locks the env predicate; this file locks what a client of a
 * real Fastify instance observes in each mode.
 */
import { describe, it, expect, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerSwagger } from '../swagger.js';

const originalDocs = process.env.API_DOCS;
let app: FastifyInstance | null = null;

async function build(): Promise<FastifyInstance> {
  const a = Fastify({ logger: false });
  await registerSwagger(a);
  a.get('/api/probe', { schema: { tags: ['Health'], summary: 'probe route' } }, async () => ({ ok: true }));
  await a.ready();
  return a;
}

afterEach(async () => {
  if (originalDocs === undefined) delete process.env.API_DOCS; else process.env.API_DOCS = originalDocs;
  await app?.close();
  app = null;
});

describe('registerSwagger', () => {
  it('with API_DOCS unset: builds the spec but registers no /docs route at all', async () => {
    delete process.env.API_DOCS;
    app = await build();
    for (const url of ['/docs', '/docs/json', '/docs/static/index.html']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(404);
    }
    const spec = app.swagger() as any;
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('DigiLog API');
    expect(spec.servers).toEqual([{ url: '/', description: expect.stringContaining('same origin') }]);
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' });
    expect(spec.security).toEqual([{ bearerAuth: [] }]);
    // Every route tag is declared, once each (2026-10-05 de-duplication).
    const names = spec.tags.map((t: { name: string }) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toEqual(expect.arrayContaining(['Auth', 'Config', 'Audit', 'Filter Operations', 'Super Admin - Data Management']));
    expect(names).not.toContain('Authentication');
    expect(names).not.toContain('Configuration');
    expect(spec.paths['/api/probe'].get.summary).toBe('probe route');
  });

  it('with API_DOCS=on: serves the UI and the JSON spec under /docs', async () => {
    process.env.API_DOCS = 'on';
    app = await build();
    const json = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(json.statusCode).toBe(200);
    const spec = json.json();
    expect(spec.info.title).toBe('DigiLog API');
    expect(spec.paths['/api/probe']).toBeDefined();
    const ui = await app.inject({ method: 'GET', url: '/docs' });
    expect(ui.statusCode).toBe(200);
    expect(ui.headers['content-type']).toContain('text/html');
    expect(ui.body.toLowerCase()).toContain('swagger');
  });

  it.each(['off', 'true', ''])('treats API_DOCS=%j as off', async (v) => {
    process.env.API_DOCS = v;
    app = await build();
    expect((await app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(404);
  });
});
