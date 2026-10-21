/**
 * A-05 (2026-10-21): the ONE global error handler, used by app.ts AND the e2e
 * harness. Exercised on a real Fastify instance: each kind of error a route can
 * throw maps to its code, and only a genuine internal error reaches
 * `onInternalError` (where app.ts pages the admins with SYSTEM_ERROR).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildErrorHandler } from '../error-handler.js';
import { AppError } from '../errors.js';

const prismaError = (code: string, name = 'PrismaClientKnownRequestError') =>
  Object.assign(new Error(`C:\\src\\secret\\path.ts:12 invalid ${code}`), { code, name });

function build(onInternalError: (err: Error) => void, exposeInternalMessage = false): FastifyInstance {
  const app = Fastify({ logger: false });
  app.setErrorHandler(buildErrorHandler({ log: app.log, onInternalError, exposeInternalMessage }));
  app.get('/app-error', async () => { throw new AppError(409, 'ALREADY_DONE', 'It is already done'); });
  app.get('/zod', async () => { z.object({ a: z.string() }).parse({}); });
  app.post('/schema', { schema: { body: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } } } }, async () => ({}));
  app.get('/p2002', async () => { throw prismaError('P2002'); });
  app.get('/p2025', async () => { throw prismaError('P2025'); });
  app.get('/p2000', async () => { throw prismaError('P2000'); });
  app.get('/p2024', async () => { throw prismaError('P2024'); });
  app.get('/p9999', async () => { throw prismaError('P9999'); });
  app.get('/prisma-validation', async () => { throw Object.assign(new Error('Argument x: invalid value'), { name: 'PrismaClientValidationError' }); });
  app.get('/boom', async () => { throw new Error('C:\\src\\secret\\db.ts:42 connection reset'); });
  return app;
}

describe('buildErrorHandler', () => {
  const internal = vi.fn();
  let app: FastifyInstance;
  beforeAll(async () => { app = build(internal); await app.ready(); });
  afterAll(async () => { await app.close(); });

  const get = async (url: string) => {
    internal.mockClear();
    const res = await app.inject({ method: 'GET', url });
    return { status: res.statusCode, body: res.json() };
  };

  it.each([
    ['/app-error', 409, 'ALREADY_DONE'],
    ['/zod', 400, 'VALIDATION_ERROR'],
    ['/p2002', 409, 'CONFLICT'],
    ['/p2025', 404, 'NOT_FOUND'],
    ['/p2000', 400, 'VALUE_TOO_LONG'],
    ['/p2024', 503, 'SERVICE_BUSY'],
    ['/p9999', 400, 'DATA_CONSTRAINT'],
    ['/prisma-validation', 400, 'VALIDATION_ERROR'],
  ])('%s -> %i %s, never an internal error, never Prisma text', async (url, status, code) => {
    const r = await get(url);
    expect(r).toMatchObject({ status, body: { error: code } });
    expect(JSON.stringify(r.body)).not.toContain('secret');
    expect(internal).not.toHaveBeenCalled();
  });

  it('a schema-invalid body is 400 VALIDATION_ERROR (what production answers; the old harness said INVALID_REQUEST)', async () => {
    internal.mockClear();
    const res = await app.inject({ method: 'POST', url: '/schema', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(internal).not.toHaveBeenCalled();
  });

  it('a genuine internal error is a generic 500 and reaches onInternalError exactly once', async () => {
    const r = await get('/boom');
    expect(r).toEqual({ status: 500, body: { error: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(internal).toHaveBeenCalledTimes(1);
    expect((internal.mock.calls[0][0] as Error).message).toContain('connection reset');
  });

  it('exposeInternalMessage (development only) echoes the message', async () => {
    const dev = build(() => {}, true);
    const res = await dev.inject({ method: 'GET', url: '/boom' });
    expect(res.json().message).toContain('connection reset');
    await dev.close();
  });
});

describe('wiring: production and the e2e harness install the same handler', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const file of ['../../app.ts', '../../e2e/test-helper.ts']) {
    it(`${file} uses buildErrorHandler and defines no handler of its own`, () => {
      const src = readFileSync(resolve(here, file), 'utf8');
      expect(src).toMatch(/setErrorHandler\(buildErrorHandler\(/);
      expect(src).not.toMatch(/setErrorHandler\(\(\s*err/);
    });
  }
});
