/**
 * End-to-end MFA flow (S6 Option B): login step-up → enrol → challenge, over the
 * real HTTP surface. Runs with MFA enforcement toggled ON for this file only
 * (the suite default is off — see vitest.env.ts). Uses a dedicated SUPER_ADMIN
 * so it never touches the shared `admin` fixture.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type FastifyInstance } from 'fastify';
import { authenticator } from 'otplib';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';

const USERNAME = 'mfa-sa-e2e';
const PASSWORD = 'MfaTest@12345';

async function post(app: FastifyInstance, url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, payload });
  return { status: res.statusCode, body: res.json() as any };
}

describe('MFA flow (SUPER_ADMIN, enforced)', () => {
  let app: FastifyInstance;
  const prevEnforce = process.env.MFA_ENFORCE_SUPER_ADMIN;

  beforeAll(async () => {
    process.env.MFA_ENFORCE_SUPER_ADMIN = 'true';
    app = await buildApp();
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await prisma.user.create({
      data: {
        username: USERNAME, fullName: 'MFA SA E2E', role: 'SUPER_ADMIN',
        passwordHash: await hashPassword(PASSWORD),
        status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false,
      },
    });
  });

  afterAll(async () => {
    process.env.MFA_ENFORCE_SUPER_ADMIN = prevEnforce;
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await app.close();
  });

  it('walks enrolment then a TOTP challenge, and enforces backup-code single-use', async () => {
    // 1. Password login → enrolment required, no session token.
    const login1 = await post(app, '/api/auth/login', { username: USERNAME, password: PASSWORD });
    expect(login1.status).toBe(200);
    expect(login1.body.mfaEnrollmentRequired).toBe(true);
    expect(login1.body.mfaToken).toBeTruthy();
    expect(login1.body.token).toBeUndefined();

    // 2. Start enrolment → secret + QR URI.
    const start = await post(app, '/api/auth/mfa/enroll/start', { mfaToken: login1.body.mfaToken });
    expect(start.status).toBe(200);
    expect(start.body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(start.body.otpauthUri).toContain('otpauth://totp/');
    const secret: string = start.body.secret;

    // 3. Confirm a code → MFA enabled, session issued, backup codes returned once.
    const enroll = await post(app, '/api/auth/mfa/enroll/verify', {
      mfaToken: login1.body.mfaToken, code: authenticator.generate(secret), force: true,
    });
    expect(enroll.status).toBe(200);
    expect(enroll.body.token).toBeTruthy();
    expect(enroll.body.backupCodes).toHaveLength(10);
    const backupCode: string = enroll.body.backupCodes[0];

    // 4. Next login → challenge required (enrolled now).
    const login2 = await post(app, '/api/auth/login', { username: USERNAME, password: PASSWORD });
    expect(login2.body.mfaRequired).toBe(true);
    expect(login2.body.token).toBeUndefined();

    // 5. Wrong code rejected.
    const bad = await post(app, '/api/auth/mfa/verify', { mfaToken: login2.body.mfaToken, code: '000000', force: true });
    expect(bad.status).toBe(401);

    // 6. Correct TOTP → session.
    const verify = await post(app, '/api/auth/mfa/verify', {
      mfaToken: login2.body.mfaToken, code: authenticator.generate(secret), force: true,
    });
    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();

    // 7. A backup code works as a second factor…
    const login3 = await post(app, '/api/auth/login', { username: USERNAME, password: PASSWORD });
    const byBackup = await post(app, '/api/auth/mfa/verify', { mfaToken: login3.body.mfaToken, code: backupCode, force: true });
    expect(byBackup.status).toBe(200);
    expect(byBackup.body.token).toBeTruthy();

    // …but only once (single-use).
    const login4 = await post(app, '/api/auth/login', { username: USERNAME, password: PASSWORD });
    const reuse = await post(app, '/api/auth/mfa/verify', { mfaToken: login4.body.mfaToken, code: backupCode, force: true });
    expect(reuse.status).toBe(401);
  });

  it('rejects an enrol token used at the challenge endpoint (typed tokens)', async () => {
    const login = await post(app, '/api/auth/login', { username: USERNAME, password: PASSWORD });
    // login now returns a 'challenge' token; the enroll/start endpoint requires 'enroll'
    const wrong = await post(app, '/api/auth/mfa/enroll/start', { mfaToken: login.body.mfaToken });
    expect(wrong.status).toBe(401);
  });
});
