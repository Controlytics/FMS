/**
 * Auth plugin against REAL sessions and users (coverage, 2026-10-21).
 *
 * Mounts the production auth plugin on a bare Fastify instance with stub routes
 * at the paths the plugin special-cases, and drives it with users + session rows
 * this file creates in digilog_test_db and real signed JWTs. Each session branch
 * is reached by shaping the file's OWN session row before its first request
 * (getCachedSession caches a row for 30 s), never by changing a shared config row.
 *
 * Asserted: the status + error code a client sees, and the session / user rows
 * the plugin writes (terminationReason, sliding expiry, the debounce).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma.js';
import { signToken } from '../../lib/jwt.js';
import { signOfflineReplayToken, OFFLINE_REPLAY_TOKEN_HEADER, LEGACY_OFFLINE_REPLAY_HEADER } from '../../lib/offline-replay-token.js';
import authPlugin from '../auth.js';
import { cleanupAll, createRole, createUser, deleteRoles, deleteUsers, runSuffix } from '../../e2e/support/owned-fixtures.js';

const SFX = runSuffix();
const ROLE = `CVPAS${SFX}`.slice(0, 20);
const PW = 'Cvp@Sessions1';
const HOUR = 3_600_000;

let app: FastifyInstance;
const userIds: string[] = [];
let activeUser: { id: string; username: string };
let disabledUser: { id: string; username: string };
let forcedUser: { id: string; username: string };

async function makeUser(tag: string, data: Record<string, unknown> = {}) {
  const username = `cvp_as_${tag}_${SFX}`.toLowerCase();
  const id = await createUser(username, ROLE, PW);
  userIds.push(id);
  if (Object.keys(data).length) await prisma.user.update({ where: { id }, data });
  return { id, username };
}

/** A session row for `user`, shaped by `data`, plus a JWT that names it. */
async function session(user: { id: string; username: string }, data: Record<string, unknown> = {}) {
  const s = await prisma.session.create({
    data: { userId: user.id, tokenHash: `cvp-${randomUUID()}`, expiresAt: new Date(Date.now() + HOUR), ...data },
  });
  const token = await signToken({ sub: user.id, username: user.username, role: ROLE, sessionId: s.id });
  return { id: s.id, token };
}

const get = (url: string, token?: string, headers: Record<string, string | string[]> = {}) =>
  app.inject({ method: 'GET', url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } as any });

const echo = async (req: any) => ({ username: req.user?.username ?? null, replay: req.offlineReplayVerified ?? null });

beforeAll(async () => {
  await createRole(ROLE, []);
  activeUser = await makeUser('active');
  disabledUser = await makeUser('disabled', { status: 'DISABLED' });
  forcedUser = await makeUser('forced', { forcePasswordChange: true });

  app = Fastify({ logger: false });
  await app.register(authPlugin);
  app.get('/api/stub', echo);
  app.get('/api/auth/me', echo);
  app.post('/api/admin-requests', async () => ({ submitted: true }));
  app.get('/api/admin-requests', echo);
  app.get('/api/roles/active', async () => ({ public: true }));
  app.post('/api/roles/active', echo);
  app.get('/spa', async () => ({ spa: true }));
  app.post('/spa', async () => ({ spa: true }));
  app.get('/uploads/private.bin', async () => ({ file: true }));
  app.get('/docs', async () => ({ docs: true }));
  app.get('/docsextra', async () => ({ docsextra: true }));
  app.post('/api/filters/:id/advance', echo);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['close app', async () => { await app?.close(); }],
    ['users + sessions', () => deleteUsers(userIds)],
    ['role', () => deleteRoles([ROLE])],
  ]);
}, 60_000);

// Restore the two env switches after every test that sets them.
const ENV_KEYS = ['SERVE_WEB', 'API_DOCS'] as const;
const envBefore = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (envBefore[k] === undefined) delete process.env[k]; else process.env[k] = envBefore[k];
  }
});

describe('token + session gates', () => {
  it('401 Missing token without a Bearer header, and for a non-Bearer scheme', async () => {
    expect((await get('/api/stub')).json()).toEqual({ error: 'UNAUTHORIZED', message: 'Missing token' });
    const basic = await get('/api/stub', undefined, { authorization: 'Basic abc' });
    expect(basic.statusCode).toBe(401);
    expect(basic.json().error).toBe('UNAUTHORIZED');
  });

  it('401 TOKEN_EXPIRED for a token that does not verify', async () => {
    const res = await get('/api/stub', 'not.a.jwt');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'TOKEN_EXPIRED', message: 'Invalid or expired token' });
  });

  it('401 SESSION_INVALID when the named session row is no longer active', async () => {
    const s = await session(activeUser, { isActive: false, terminationReason: 'manual' });
    const res = await get('/api/stub', s.token);
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('SESSION_INVALID');
  });

  it('expires a session past its expiresAt, and persists the termination', async () => {
    const s = await session(activeUser, { expiresAt: new Date(Date.now() - 60_000) });
    const res = await get('/api/stub', s.token);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'SESSION_EXPIRED', message: 'Session expired' });
    const row = await prisma.session.findUnique({ where: { id: s.id } });
    expect(row).toMatchObject({ isActive: false, terminationReason: 'expired' });
    // The eviction is real: the same token is now an invalid session, not a live one.
    expect((await get('/api/stub', s.token)).json().error).toBe('SESSION_INVALID');
  });

  it('ends a session older than 24 h even while its sliding expiry is still in the future', async () => {
    const s = await session(activeUser, { createdAt: new Date(Date.now() - 25 * HOUR), expiresAt: new Date(Date.now() + HOUR) });
    const res = await get('/api/stub', s.token);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'SESSION_EXPIRED', message: 'Session exceeded maximum duration. Please log in again.' });
    const row = await prisma.session.findUnique({ where: { id: s.id } });
    expect(row).toMatchObject({ isActive: false, terminationReason: 'absolute_timeout' });
  });

  it('401 ACCOUNT_INACTIVE for a disabled user with a live session', async () => {
    const s = await session(disabledUser);
    const res = await get('/api/stub', s.token);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'ACCOUNT_INACTIVE', message: 'Account is not active' });
  });

  it('patches req.user from the users row, not from the token', async () => {
    const s = await prisma.session.create({
      data: { userId: activeUser.id, tokenHash: `cvp-${randomUUID()}`, expiresAt: new Date(Date.now() + HOUR) },
    });
    // The token claims a different username and role; the DB row wins.
    const token = await signToken({ sub: activeUser.id, username: 'someone-else', role: 'SUPER_ADMIN', sessionId: s.id });
    const res = await get('/api/stub', token);
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe(activeUser.username);
  });
});

describe('sliding session expiry', () => {
  it('extends expiresAt by the configured session duration on the first request, then debounces', async () => {
    const cfg = await prisma.systemConfig.findFirst({ where: { configKey: 'session' } });
    const hours = (cfg?.configValue as any)?.sessionDurationHours ?? 8;
    const old = new Date(Date.now() - 10 * 60_000);
    const s = await session(activeUser, { lastActiveAt: old, expiresAt: new Date(Date.now() + 5 * 60_000) });

    const before = Date.now();
    expect((await get('/api/stub', s.token)).statusCode).toBe(200);
    const first = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(first.lastActiveAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    const expected = before + hours * HOUR;
    expect(Math.abs(first.expiresAt.getTime() - expected)).toBeLessThan(2 * 60_000);

    // A second request inside the 60 s debounce window writes nothing.
    expect((await get('/api/stub', s.token)).statusCode).toBe(200);
    const second = await prisma.session.findUniqueOrThrow({ where: { id: s.id } });
    expect(second.lastActiveAt.getTime()).toBe(first.lastActiveAt.getTime());
    expect(second.expiresAt.getTime()).toBe(first.expiresAt.getTime());
  });
});

describe('forced password change', () => {
  it('403 FORCE_PASSWORD_CHANGE on any other route', async () => {
    const s = await session(forcedUser);
    const res = await get('/api/stub', s.token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'FORCE_PASSWORD_CHANGE', message: 'You must change your password before continuing.' });
  });

  it('still admits the allowlisted GET /api/auth/me (query string ignored)', async () => {
    const s = await session(forcedUser);
    const res = await get('/api/auth/me?fresh=1', s.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe(forcedUser.username);
  });

  it('matches the allowlist on method as well as path', async () => {
    const s = await session(forcedUser);
    const res = await app.inject({ method: 'POST', url: '/api/roles/active', headers: { authorization: `Bearer ${s.token}` } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('FORCE_PASSWORD_CHANGE');
  });
});

describe('public paths', () => {
  it('GET-only public paths answer without a token; other methods still need one', async () => {
    expect((await get('/api/roles/active')).json()).toEqual({ public: true });
    const post = await app.inject({ method: 'POST', url: '/api/roles/active' });
    expect(post.statusCode).toBe(401);
  });

  it('POST /api/admin-requests is public; GET on the same path is not', async () => {
    const post = await app.inject({ method: 'POST', url: '/api/admin-requests' });
    expect(post.statusCode).toBe(200);
    expect(post.json()).toEqual({ submitted: true });
    expect((await get('/api/admin-requests')).statusCode).toBe(401);
  });

  it('/docs is public only while API_DOCS=on', async () => {
    delete process.env.API_DOCS;
    expect((await get('/docs')).statusCode).toBe(401);
    process.env.API_DOCS = 'on';
    expect((await get('/docs')).json()).toEqual({ docs: true });
  });
});

describe('SERVE_WEB (the API also serves the SPA)', () => {
  it('lets GET and HEAD of a non-API path through without a token', async () => {
    process.env.SERVE_WEB = 'true';
    expect((await get('/spa')).json()).toEqual({ spa: true });
    const head = await app.inject({ method: 'HEAD', url: '/spa' });
    expect(head.statusCode).toBe(200);
  });

  it('still requires a token for POST, /api, /uploads', async () => {
    process.env.SERVE_WEB = 'true';
    expect((await app.inject({ method: 'POST', url: '/spa' })).statusCode).toBe(401);
    expect((await get('/api/stub')).statusCode).toBe(401);
    expect((await get('/uploads/private.bin')).statusCode).toBe(401);
  });

  it('with docs off, /docs is just another SPA path', async () => {
    process.env.SERVE_WEB = 'true';
    delete process.env.API_DOCS;
    expect((await get('/docs')).json()).toEqual({ docs: true });
  });

  it('with docs on, a /docs-prefixed path that is not a docs path is not handed to the SPA', async () => {
    process.env.SERVE_WEB = 'true';
    process.env.API_DOCS = 'on';
    // '/docsextra' is not '/docs' or '/docs/...' (segment boundary), so it is not
    // public as docs; and with docs on it is excluded from the SPA carve-out.
    expect((await get('/docsextra')).statusCode).toBe(401);
  });

  it('without SERVE_WEB a non-API path needs a token', async () => {
    delete process.env.SERVE_WEB;
    expect((await get('/spa')).statusCode).toBe(401);
  });
});

describe('offline-replay grant header', () => {
  const advance = (token: string, headers: Record<string, string | string[]>) =>
    app.inject({ method: 'POST', url: `/api/filters/${randomUUID()}/advance`, headers: { authorization: `Bearer ${token}`, ...headers } as any });

  it('is verified on a replay route when bound to this user + session', async () => {
    const s = await session(activeUser);
    const { token: grant } = await signOfflineReplayToken(activeUser.id, s.id);
    const res = await advance(s.token, { [OFFLINE_REPLAY_TOKEN_HEADER]: grant });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ username: activeUser.username, replay: true });
  });

  it('401s on a replay route with a grant bound to another session', async () => {
    const s = await session(activeUser);
    const other = await session(activeUser);
    const { token: grant } = await signOfflineReplayToken(activeUser.id, other.id);
    const res = await advance(s.token, { [OFFLINE_REPLAY_TOKEN_HEADER]: grant });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('OFFLINE_REPLAY_TOKEN_SESSION_MISMATCH');
  });

  it('401s on a replay route with a grant that does not verify', async () => {
    const s = await session(activeUser);
    const res = await advance(s.token, { [OFFLINE_REPLAY_TOKEN_HEADER]: 'garbage' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('OFFLINE_REPLAY_TOKEN_INVALID');
  });

  it('is ignored (never verified) on a route the tablet does not replay', async () => {
    const s = await session(activeUser);
    const { token: grant } = await signOfflineReplayToken(activeUser.id, s.id);
    const res = await get('/api/stub', s.token, { [OFFLINE_REPLAY_TOKEN_HEADER]: grant });
    expect(res.statusCode).toBe(200);
    expect(res.json().replay).toBe(false);
  });

  it('on an unknown URL falls back to the raw URL, which never matches, so it is ignored', async () => {
    const s = await session(activeUser);
    const res = await app.inject({
      method: 'POST', url: `/api/filters/${randomUUID()}/advance-nowhere`,
      headers: { authorization: `Bearer ${s.token}`, [OFFLINE_REPLAY_TOKEN_HEADER]: 'garbage' },
    });
    // The bad grant did not produce a 401: the header was ignored and routing 404'd.
    expect(res.statusCode).toBe(404);
  });

  it('refuses the legacy bare `x-offline-replay: true` header', async () => {
    const s = await session(activeUser);
    const res = await get('/api/stub', s.token, { [LEGACY_OFFLINE_REPLAY_HEADER]: 'true' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('OFFLINE_REPLAY_HEADER_DEPRECATED');
  });

  it('a legacy header with any other value is simply not a replay request', async () => {
    const s = await session(activeUser);
    const res = await get('/api/stub', s.token, { [LEGACY_OFFLINE_REPLAY_HEADER]: 'false' });
    expect(res.statusCode).toBe(200);
    expect(res.json().replay).toBeNull();
  });
});
