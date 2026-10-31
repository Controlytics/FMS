/**
 * GET /api/system-health/certificate — the Super Admin's HTTPS-certificate expiry
 * warning (2026-10-31; dashboard banner). A company certificate renewed every
 * two months that nobody swaps in time stops every browser and tablet the day it
 * expires. Real Fastify + the real rbac plugin; the served certificate is the
 * dev install's own (certs/server.crt, as app.ts loads it), and expiry is moved
 * by passing `now` to the pure function.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';

vi.mock('../../../lib/prisma.js', () => ({ prisma: { $queryRawUnsafe: () => Promise.resolve([]) } }));

import rbacPlugin from '../../../plugins/rbac.js';
import systemHealthRoutes from '../routes.js';
import { recordServedCertificate, servedCertificateInfo, CERTIFICATE_WARN_DAYS } from '../../../lib/served-certificate.js';

const CERT = join(__dirname, '..', '..', '..', '..', '..', '..', 'certs', 'server.crt');
let app: FastifyInstance;

const fakeAuth = fp(async (a: FastifyInstance) => {
  a.addHook('onRequest', async (req) => {
    const role = req.headers['x-test-role'];
    (req as any).user = typeof role === 'string' ? { sub: 'u', username: 'u', role, sessionId: 's' } : undefined;
  });
}, { name: 'auth' });
const get = (role?: string) => app.inject({ method: 'GET', url: '/api/system-health/certificate', headers: role ? { 'x-test-role': role } : {} });

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(fakeAuth);
  await app.register(rbacPlugin);
  await app.register(systemHealthRoutes, { prefix: '/api/system-health' });
  await app.ready();
}, 60_000);
afterAll(async () => { recordServedCertificate(null); await app?.close(); }, 60_000);

describe.skipIf(!existsSync(CERT))('served certificate', () => {
  it('SUPER_ADMIN gets every field (none stripped by the response schema)', async () => {
    recordServedCertificate(readFileSync(CERT));
    const res = await get('SUPER_ADMIN');
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const x = new X509Certificate(readFileSync(CERT));
    expect(body.warnDays).toBe(CERTIFICATE_WARN_DAYS);
    expect(body.certificate).toEqual({
      subject: expect.any(String),
      issuer: expect.any(String),
      validFrom: new Date(x.validFrom).toISOString(),
      validTo: new Date(x.validTo).toISOString(),
      daysLeft: expect.any(Number),
      fingerprint256: x.fingerprint256,
    });
    expect(body.warning).toBe(body.certificate.daysLeft <= CERTIFICATE_WARN_DAYS);
  });

  it.each(['ADMIN', 'OPERATOR', 'QA'])('%s is refused (the warning is the Super Admin\'s)', async (role) => {
    expect((await get(role)).statusCode).toBe(403);
  });

  it('daysLeft counts down to the warning and goes negative once expired', () => {
    recordServedCertificate(readFileSync(CERT));
    const to = new Date(new X509Certificate(readFileSync(CERT)).validTo).getTime();
    expect(servedCertificateInfo(to - 20 * 86_400_000)!.daysLeft).toBe(20);
    expect(servedCertificateInfo(to - 14 * 86_400_000)!.daysLeft).toBe(14);
    expect(servedCertificateInfo(to + 86_400_000)!.daysLeft).toBeLessThan(0);
  });

  it('plain HTTP (no certificate) answers certificate: null, warning: false', async () => {
    recordServedCertificate(null);
    const res = await get('SUPER_ADMIN');
    expect(res.json()).toEqual({ certificate: null, warnDays: CERTIFICATE_WARN_DAYS, warning: false });
  });
});
