/**
 * Auth plugin gates whose trigger is SHARED state (coverage, 2026-10-21).
 *
 * The Super Admin API kill-switch and the live password policy are global rows:
 * flipping either in digilog_test_db would lock out every concurrent suite's
 * SUPER_ADMIN or expire their users. So the decision helpers are mocked at their
 * module boundary (lib/super-admin-lock, lib/password-expiry) and everything else
 * is real: users and session rows this file creates, real signed JWTs, the real
 * plugin answering over HTTP, and the users row the plugin writes.
 *
 * Also covered here: a NON-grant error thrown by the replay-token verifier is not
 * swallowed into a 401 (mocked at lib/offline-replay-token, real otherwise).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';

const { saEnabled, expired, verifyGrant } = vi.hoisted(() => ({
  saEnabled: vi.fn(async () => true),
  expired: vi.fn<(...a: any[]) => boolean | undefined>(() => undefined),
  verifyGrant: vi.fn<(...a: any[]) => Promise<unknown> | undefined>(() => undefined),
}));

vi.mock('../../lib/super-admin-lock.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/super-admin-lock.js')>()),
  isSuperAdminApiEnabled: saEnabled,
}));
// Defaults to the REAL implementation; a test overrides one call.
vi.mock('../../lib/password-expiry.js', async (orig) => {
  const real = await orig<typeof import('../../lib/password-expiry.js')>();
  return { ...real, isPasswordExpired: (...a: Parameters<typeof real.isPasswordExpired>) => expired(...a) ?? real.isPasswordExpired(...a) };
});
vi.mock('../../lib/offline-replay-token.js', async (orig) => {
  const real = await orig<typeof import('../../lib/offline-replay-token.js')>();
  return { ...real, verifyOfflineReplayToken: (...a: Parameters<typeof real.verifyOfflineReplayToken>) => verifyGrant(...a) ?? real.verifyOfflineReplayToken(...a) };
});

import { prisma } from '../../lib/prisma.js';
import { signToken } from '../../lib/jwt.js';
import { OFFLINE_REPLAY_TOKEN_HEADER } from '../../lib/offline-replay-token.js';
import authPlugin from '../auth.js';
import { cleanupAll, createRole, createUser, deleteRoles, deleteUsers, runSuffix } from '../../e2e/support/owned-fixtures.js';

const SFX = runSuffix();
const ROLE = `CVPAG${SFX}`.slice(0, 20);
const PW = 'Cvp@Gates1';

let app: FastifyInstance;
const userIds: string[] = [];

async function userWithSession(tag: string, role: string) {
  const username = `cvp_ag_${tag}_${SFX}`.toLowerCase();
  const id = await createUser(username, role, PW);
  userIds.push(id);
  const s = await prisma.session.create({
    data: { userId: id, tokenHash: `cvp-${randomUUID()}`, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const token = await signToken({ sub: id, username, role, sessionId: s.id });
  return { id, username, token, sessionId: s.id };
}

const call = (method: string, url: string, token: string, headers: Record<string, string> = {}) =>
  app.inject({ method: method as any, url, headers: { authorization: `Bearer ${token}`, ...headers } });

beforeAll(async () => {
  await createRole(ROLE, []);
  app = Fastify({ logger: false });
  await app.register(authPlugin);
  const ok = async (req: any) => ({ username: req.user.username, role: req.user.role });
  app.get('/api/stub', ok);
  app.get('/api/auth/me', ok);
  app.put('/api/super-admin/api-lock', ok);
  app.post('/api/filters/:id/advance', ok);
  await app.ready();
}, 60_000);

afterAll(async () => {
  await cleanupAll([
    ['close app', async () => { await app?.close(); }],
    ['users + sessions', () => deleteUsers(userIds)],
    ['role', () => deleteRoles([ROLE])],
  ]);
}, 60_000);

beforeEach(() => {
  saEnabled.mockReset().mockResolvedValue(true);
  expired.mockReset().mockReturnValue(undefined);
  verifyGrant.mockReset().mockReturnValue(undefined);
});

describe('Super Admin API kill-switch', () => {
  it('freezes a SUPER_ADMIN to the allowlist while the switch is OFF', async () => {
    const sa = await userWithSession('sa', 'SUPER_ADMIN');
    saEnabled.mockResolvedValue(false);
    const res = await call('GET', '/api/stub', sa.token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: 'SUPER_ADMIN_API_LOCKED',
      message: 'Super Admin API access is currently disabled. Re-enable it to continue.',
    });
    // The allowlisted reads/flip stay reachable so the SA can turn it back on.
    expect((await call('GET', '/api/auth/me', sa.token)).statusCode).toBe(200);
    expect((await call('PUT', '/api/super-admin/api-lock', sa.token)).statusCode).toBe(200);
  });

  it('does not touch a SUPER_ADMIN while the switch is ON', async () => {
    const sa = await userWithSession('sa2', 'SUPER_ADMIN');
    const res = await call('GET', '/api/stub', sa.token);
    expect(res.statusCode).toBe(200);
    expect(res.json().role).toBe('SUPER_ADMIN');
  });

  it('never consults the switch for a non-SUPER_ADMIN', async () => {
    const u = await userWithSession('plain', ROLE);
    saEnabled.mockResolvedValue(false);
    expect((await call('GET', '/api/stub', u.token)).statusCode).toBe(200);
    expect(saEnabled).not.toHaveBeenCalled();
  });
});

describe('password expired under the live policy', () => {
  it('flags the user for a forced change, persists it, and answers PASSWORD_EXPIRED', async () => {
    const u = await userWithSession('exp', ROLE);
    expired.mockReturnValue(true);
    const res = await call('GET', '/api/stub', u.token);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change your password.' });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(row.forcePasswordChange).toBe(true);
    // Still allowed to reach the password-change surface.
    expect((await call('GET', '/api/auth/me', u.token)).statusCode).toBe(200);
  });

  it('an expired password of a SUPER_ADMIN is never evaluated (documented exemption)', async () => {
    const sa = await userWithSession('saexp', 'SUPER_ADMIN');
    expired.mockReturnValue(true);
    expect((await call('GET', '/api/stub', sa.token)).statusCode).toBe(200);
    expect(expired).not.toHaveBeenCalled();
  });
});

describe('offline-replay verifier faults', () => {
  it('a non-grant error from the verifier propagates (500), it is not reported as a bad grant', async () => {
    const u = await userWithSession('rp', ROLE);
    verifyGrant.mockImplementation(() => Promise.reject(new Error('verifier crashed')));
    const res = await call('POST', `/api/filters/${randomUUID()}/advance`, u.token, { [OFFLINE_REPLAY_TOKEN_HEADER]: 'anything' });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).not.toMatch(/^OFFLINE_REPLAY/);
  });
});
