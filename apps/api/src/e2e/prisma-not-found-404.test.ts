/**
 * M29 residual (QA 2026-10-19): Prisma P2025 ("record to update/delete not
 * found") must answer 404 NOT_FOUND, not 400 DATA_CONSTRAINT — a stale id from
 * an open tab is a missing record, not bad data.
 *
 * Since A-05 (2026-10-21) the harness and app.ts install the SAME handler
 * (lib/error-handler.ts), so these runtime checks exercise production's mapping
 * directly; the source-regex checks against app.ts they used to carry are gone.
 * `internalErrors` is what app.ts would page as SYSTEM_ERROR: it must stay empty.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs, internalErrors } from './test-helper.js';
import { prisma } from '../lib/prisma.js';

let app: FastifyInstance;

describe('Prisma P2025 → 404 NOT_FOUND (M29)', () => {
  beforeAll(async () => {
    app = await buildApp([{
      prefix: '/__qa',
      plugin: async (a) => {
        a.get('/missing-update', async () => {
          await prisma.helpArticle.update({ where: { id: randomUUID() }, data: { title: 'x' } });
          return { unreachable: true };
        });
        a.get('/nul-byte', async () => {
          // Postgres text cannot hold 0x00 -> PrismaClientUnknownRequestError (22021)
          await prisma.helpArticle.findFirst({ where: { title: 'qa\u0000p5' } });
          return { unreachable: true };
        });
        a.get('/int-overflow', async () => {
          // outside INT4 -> driver ConversionError, also an Unknown request error
          await prisma.pmSchedule.findFirst({ where: { year: -2147483649 } });
          return { unreachable: true };
        });
        a.get('/invalid-arg', async () => {
          // an Invalid Date is a PrismaClientValidationError (no error code)
          await prisma.helpArticle.findMany({ where: { createdAt: { gte: new Date('garbage') } } });
          return { unreachable: true };
        });
      },
    }]);
  });
  afterAll(async () => { await app?.close(); });

  it('a real update of a missing row answers 404 with no Prisma text', async () => {
    const token = await loginAs(app);
    const res = await app.inject({ method: 'GET', url: '/__qa/missing-update', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
    expect(res.body).not.toMatch(/prisma|P2025|node_modules/i);
  });

  it('a PrismaClientValidationError (no code) answers 400, not 500 + SYSTEM_ERROR', async () => {
    internalErrors.length = 0;
    const token = await loginAs(app);
    const res = await app.inject({ method: 'GET', url: '/__qa/invalid-arg', headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(res.body).not.toMatch(/prisma|node_modules|Invalid `/i);
    expect(internalErrors).toEqual([]);
  });

  it('P5-03: a NUL byte or an out-of-INT4 number answers 400, not 500 + SYSTEM_ERROR', async () => {
    internalErrors.length = 0;
    const token = await loginAs(app);
    for (const url of ['/__qa/nul-byte', '/__qa/int-overflow']) {
      const res = await app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } });
      expect(res.statusCode, url).toBe(400);
      expect(res.json().error, url).toBe('VALIDATION_ERROR');
      expect(res.body, url).not.toMatch(/prisma|node_modules|Postgres|ConversionError/i);
    }
    expect(internalErrors).toEqual([]);
  });

  it('P4-09: JSON posted to a multipart route is a client error (406 INVALID_REQUEST), not INTERNAL_ERROR', async () => {
    internalErrors.length = 0;
    const token = await loginAs(app);
    const res = await app.inject({
      method: 'POST', url: '/api/backup/validate',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'x-reauth-password': 'Admin@123' },
      payload: { not: 'a file' },
    });
    expect(res.statusCode).toBe(406);
    expect(res.json().error).toBe('INVALID_REQUEST');
    expect(internalErrors).toEqual([]);
  });

  it('production installs the very handler these requests ran through', () => {
    const src = readFileSync(resolve(__dirname, '../app.ts'), 'utf8');
    expect(src).toMatch(/setErrorHandler\(buildErrorHandler\(/);
  });
});
