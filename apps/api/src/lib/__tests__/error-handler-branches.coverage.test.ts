/**
 * The global error handler's remaining branches (lib/error-handler.ts) and the
 * two classifiers it leans on (lib/errors.ts). error-handler.test.ts covers the
 * common Prisma codes; this file covers the transport-level errors Fastify
 * itself raises (body too large, bad JSON, wrong media type, rate limit), the
 * offline-time and client-data classes, and what reaches the log for a genuine
 * internal error. Real Fastify instance; the only stand-in is the logger, whose
 * calls ARE the observable effect of the log branches.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildErrorHandler } from '../error-handler.js';
import { AppError, isClientDataPrismaError, fastifyClientError } from '../errors.js';
import { OfflineTimeError } from '../offline-time-window.js';

const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(), child: vi.fn(), level: 'info', silent: vi.fn() };
const internal = vi.fn();

const unknownPrisma = (message: string) => Object.assign(new Error(message), { name: 'PrismaClientUnknownRequestError' });
const throwing = (err: unknown) => async () => { throw err; };

function build(opts: { expose?: boolean; bodyLimit?: number } = {}): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: opts.bodyLimit ?? 1024 * 1024 });
  app.setErrorHandler(buildErrorHandler({ log: log as any, onInternalError: internal, exposeInternalMessage: opts.expose }));
  app.addHook('onRequest', async (req) => {
    if (req.headers['x-test-user']) (req as any).user = { username: 'cvl_user', sub: 'u-1', role: 'OPERATOR' };
  });
  app.post('/json', async (req) => ({ got: req.body }));
  app.get('/app-error-details', throwing(new AppError(422, 'BAD_THING', 'Bad thing', { field: 'x' })));
  app.get('/offline-time', throwing(new OfflineTimeError('OFFLINE_TIME_FUTURE', 'too far ahead', { toleranceMs: 1 })));
  app.get('/offline-time-plain', throwing(new OfflineTimeError('OFFLINE_TIME_INVALID', 'not a date')));
  app.get('/rate-limited', throwing(Object.assign(new Error('Rate limit exceeded, retry in 1 minute'), { statusCode: 429 })));
  app.get('/too-large-no-length', throwing(Object.assign(new Error('too large'), { code: 'FST_ERR_CTP_BODY_TOO_LARGE' })));
  app.get('/validation-no-details', throwing(Object.assign(new Error('querystring/x must be integer'), { code: 'FST_ERR_VALIDATION' })));
  app.get('/zod-unpathed', throwing({ name: 'ZodError', issues: [{ path: [], message: 'Invalid input' }, { path: ['a', 0], message: 'Required' }], message: 'zod' }));
  app.get('/zod-empty', throwing({ name: 'ZodError', issues: [], message: 'zod' }));
  app.get('/p2028', throwing(Object.assign(new Error('Transaction already closed'), { code: 'P2028', name: 'PrismaClientKnownRequestError' })));
  app.get('/prisma-named-no-code', throwing(Object.assign(new Error('weird'), { name: 'PrismaClientKnownRequestError' })));
  app.get('/nul-byte', throwing(unknownPrisma('Error occurred during query execution: ConnectorError(... PostgresError { code: "22021", message: "invalid byte sequence" })')));
  app.get('/int-overflow', throwing(unknownPrisma('Invalid `prisma.x.create()` invocation: ConversionError(out of range integral type conversion attempted)')));
  app.get('/db-down', throwing(unknownPrisma('Error occurred during query execution: ConnectorError(... PostgresError { code: "57P01", message: "terminating connection" })')));
  app.get('/fst-406', throwing(Object.assign(new Error('the request is not multipart'), { statusCode: 406, code: 'FST_INVALID_MULTIPART_CONTENT_TYPE' })));
  app.get('/fst-no-message', throwing(Object.assign(new Error(''), { statusCode: 400, code: 'FST_SOMETHING' })));
  app.get('/plugin-502', throwing(Object.assign(new Error('upstream exploded'), { statusCode: 502 })));
  app.get('/blank-internal', throwing(new Error('')));
  app.get('/media-no-message', throwing(Object.assign(new Error(''), { code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' })));
  return app;
}

let app: FastifyInstance;
let exposing: FastifyInstance;
let tiny: FastifyInstance;
beforeAll(async () => {
  app = build(); exposing = build({ expose: true }); tiny = build({ bodyLimit: 64 });
  await Promise.all([app.ready(), exposing.ready(), tiny.ready()]);
}, 60_000);
afterAll(async () => { await Promise.all([app.close(), exposing.close(), tiny.close()]); });

async function call(a: FastifyInstance, url: string, init: { method?: string; headers?: Record<string, string>; payload?: string } = {}) {
  internal.mockClear(); log.error.mockClear(); log.warn.mockClear();
  const res = await a.inject({ method: (init.method ?? 'GET') as any, url, headers: init.headers, payload: init.payload });
  return { status: res.statusCode, body: res.json() };
}

describe('client errors never reach onInternalError', () => {
  it('AppError carries its details', async () => {
    expect(await call(app, '/app-error-details')).toEqual({ status: 422, body: { error: 'BAD_THING', message: 'Bad thing', details: { field: 'x' } } });
  });

  it('OfflineTimeError is a 400 with its own code, with and without details', async () => {
    expect(await call(app, '/offline-time')).toEqual({ status: 400, body: { error: 'OFFLINE_TIME_FUTURE', message: 'too far ahead', details: { toleranceMs: 1 } } });
    expect(await call(app, '/offline-time-plain')).toEqual({ status: 400, body: { error: 'OFFLINE_TIME_INVALID', message: 'not a date' } });
  });

  it('a rate-limit error is 429 TOO_MANY_REQUESTS', async () => {
    expect(await call(app, '/rate-limited')).toEqual({ status: 429, body: { error: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded, retry in 1 minute' } });
  });

  it('an over-limit body is 413 BODY_TOO_LARGE naming its size, and is logged as a warning', async () => {
    const payload = JSON.stringify({ blob: 'x'.repeat(2 * 1024 * 1024) });
    const r = await call(tiny, '/json', { method: 'POST', headers: { 'content-type': 'application/json' }, payload });
    expect(r.status).toBe(413);
    expect(r.body).toEqual({ error: 'BODY_TOO_LARGE', message: 'Request body too large (2.0 MB). Maximum allowed is 10 MB. Try reducing image size or quality.' });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ url: '/json', sizeMB: '2.0' }), 'Request body too large');
    expect(internal).not.toHaveBeenCalled();
  });

  it('says "unknown" when the request carried no content-length', async () => {
    const r = await call(app, '/too-large-no-length');
    expect(r).toEqual({ status: 413, body: { error: 'BODY_TOO_LARGE', message: expect.stringContaining('(unknown MB)') } });
  });

  it('malformed or empty JSON is 400 PARSE_ERROR', async () => {
    expect(await call(app, '/json', { method: 'POST', headers: { 'content-type': 'application/json' }, payload: '{"a":' }))
      .toEqual({ status: 400, body: { error: 'PARSE_ERROR', message: 'Request body is not valid JSON' } });
    expect((await call(app, '/json', { method: 'POST', headers: { 'content-type': 'application/json' }, payload: '' })).body.error).toBe('PARSE_ERROR');
  });

  it('an unsupported content type is 415', async () => {
    const r = await call(app, '/json', { method: 'POST', headers: { 'content-type': 'text/csv' }, payload: 'a,b' });
    expect(r.status).toBe(415);
    expect(r.body.error).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('a 415 with no message still explains itself', async () => {
    expect(await call(app, '/media-no-message')).toEqual({ status: 415, body: { error: 'UNSUPPORTED_MEDIA_TYPE', message: 'Unsupported Media Type' } });
  });

  it('a validation error without a .validation list has no details', async () => {
    expect(await call(app, '/validation-no-details')).toEqual({ status: 400, body: { error: 'VALIDATION_ERROR', message: 'querystring/x must be integer' } });
  });

  it('a Zod error lists each issue, pathless ones bare, and an empty list says so', async () => {
    const r = await call(app, '/zod-unpathed');
    expect(r.status).toBe(400);
    expect(r.body.message).toBe('Invalid input; a.0: Required');
    expect((await call(app, '/zod-empty')).body).toEqual({ error: 'VALIDATION_ERROR', message: 'Request validation failed', details: [] });
  });

  it('a transaction timeout is 503 SERVICE_BUSY (capacity, not data)', async () => {
    const r = await call(app, '/p2028');
    expect(r).toEqual({ status: 503, body: { error: 'SERVICE_BUSY', message: 'The server is busy. Please try again in a moment.' } });
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ prismaCode: 'P2028' }), expect.any(String));
  });

  it('a Prisma known-request error with no code is still a generic 400', async () => {
    expect(await call(app, '/prisma-named-no-code')).toMatchObject({ status: 400, body: { error: 'DATA_CONSTRAINT' } });
  });

  it.each(['/nul-byte', '/int-overflow'])('%s (bad client value reaching Postgres) is 400 VALIDATION_ERROR', async (url) => {
    const r = await call(app, url);
    expect(r).toEqual({ status: 400, body: { error: 'VALIDATION_ERROR', message: 'One or more values are not valid.' } });
    expect(JSON.stringify(r.body)).not.toContain('Postgres');
    expect(internal).not.toHaveBeenCalled();
  });

  it('an unmapped Fastify 4xx keeps its status as INVALID_REQUEST', async () => {
    expect(await call(app, '/fst-406')).toEqual({ status: 406, body: { error: 'INVALID_REQUEST', message: 'the request is not multipart' } });
    expect(await call(app, '/fst-no-message')).toEqual({ status: 400, body: { error: 'INVALID_REQUEST', message: 'The request is not valid.' } });
    expect(internal).not.toHaveBeenCalled();
  });
});

describe('genuine internal errors', () => {
  it('a non-client Prisma failure (connection lost) is a 500 and pages', async () => {
    const r = await call(app, '/db-down');
    expect(r).toEqual({ status: 500, body: { error: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(internal).toHaveBeenCalledTimes(1);
  });

  it('keeps a plugin-supplied 5xx status and logs who hit it', async () => {
    const r = await call(app, '/plugin-502', { headers: { 'x-test-user': '1' } });
    expect(r).toEqual({ status: 502, body: { error: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', url: '/plugin-502', user: 'cvl_user', userId: 'u-1', role: 'OPERATOR' }),
      'Unhandled error on GET /plugin-502',
    );
  });

  it('logs an anonymous request without user fields', async () => {
    await call(app, '/plugin-502');
    const ctx = log.error.mock.calls[0][0];
    expect(ctx).toMatchObject({ user: undefined, userId: undefined, role: undefined });
  });

  it('with exposeInternalMessage, an empty message still reads "Internal server error"', async () => {
    expect((await call(exposing, '/blank-internal')).body.message).toBe('Internal server error');
    expect((await call(exposing, '/plugin-502')).body.message).toBe('upstream exploded');
  });
});

describe('errors.ts classifiers', () => {
  it('isClientDataPrismaError only accepts unknown-request errors of class 22 or a ConversionError', () => {
    expect(isClientDataPrismaError(unknownPrisma('PostgresError { code: "22P02" }'))).toBe(true);
    expect(isClientDataPrismaError(unknownPrisma('ConversionError(x)'))).toBe(true);
    expect(isClientDataPrismaError(unknownPrisma('PostgresError { code: "23505" }'))).toBe(false);
    expect(isClientDataPrismaError({ name: 'PrismaClientUnknownRequestError' })).toBe(false);
    expect(isClientDataPrismaError(Object.assign(new Error('PostgresError { code: "22021" }'), { name: 'Error' }))).toBe(false);
    expect(isClientDataPrismaError(null)).toBe(false);
    expect(isClientDataPrismaError(undefined)).toBe(false);
  });

  it('fastifyClientError only maps FST_* codes with a 4xx status, and truncates long messages', () => {
    expect(fastifyClientError({ statusCode: 413, code: 'FST_X', message: 'm'.repeat(400) })?.body.message).toHaveLength(300);
    expect(fastifyClientError({ statusCode: 400, code: 'FST_X' })).toEqual({ status: 400, body: { error: 'INVALID_REQUEST', message: 'The request is not valid.' } });
    expect(fastifyClientError({ statusCode: 500, code: 'FST_X', message: 'm' })).toBeNull();
    expect(fastifyClientError({ statusCode: 399, code: 'FST_X', message: 'm' })).toBeNull();
    expect(fastifyClientError({ statusCode: '400', code: 'FST_X', message: 'm' })).toBeNull();
    expect(fastifyClientError({ statusCode: 400, code: 'ERR_X', message: 'm' })).toBeNull();
    expect(fastifyClientError({ statusCode: 400, code: 7, message: 'm' })).toBeNull();
    expect(fastifyClientError(null)).toBeNull();
  });
});
