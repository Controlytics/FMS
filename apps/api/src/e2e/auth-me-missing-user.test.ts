/**
 * GET /api/auth/me when the token is valid but the user row is gone
 * (2026-10-21, found by the null-to-{} response sweep).
 *
 * getProfile returns null for a missing user; under the plain `type: 'object'`
 * 200 schema that went out as `{}`, and the web's useAuth cached `{}` as the
 * signed-in user (no role) for its offline fallback. The auth plugin's 30 s user
 * cache is what lets a request reach the handler after a restore or a direct
 * delete removed the row, so the null is simulated at the service.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { authService } from '../modules/auth/auth.service.js';

const USERNAME = `qa_me_${Date.now()}`;
const PASSWORD = 'QaMeMissing@2026';
let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  await prisma.user.create({
    data: {
      username: USERNAME, fullName: 'QA me missing', passwordHash: await hashPassword(PASSWORD), role: 'SUPER_ADMIN',
      status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false, createdBy: 'qa-me-test',
    },
  });
  app = await buildApp();
  token = await loginAs(app, USERNAME, PASSWORD);
}, 60_000);

afterAll(async () => {
  const u = await prisma.user.findUnique({ where: { username: USERNAME } });
  if (u) {
    await prisma.session.deleteMany({ where: { userId: u.id } });
    await prisma.passwordHistory.deleteMany({ where: { userId: u.id } });
    await prisma.user.delete({ where: { id: u.id } });
  }
  await app?.close();
});

describe('GET /api/auth/me', () => {
  it('answers the profile for a live user', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect(res.json().username).toBe(USERNAME);
  });

  it('answers 401 ACCOUNT_INACTIVE, never `{}`, when the user row is gone', async () => {
    const spy = vi.spyOn(authService, 'getProfile').mockResolvedValueOnce(null);
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { authorization: `Bearer ${token}` } });
    spy.mockRestore();
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'ACCOUNT_INACTIVE' });
  });
});
