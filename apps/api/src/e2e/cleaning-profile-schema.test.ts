/**
 * M15 (QA 2026-10-19): the cleaning-profile create/update schema must refuse an
 * unknown pipeline nodeType and (on update) a blank name with 400 at
 * validation. Before: nodeType was any string, so an unknown value reached
 * Prisma as a PrismaClientValidationError (no error code) → 500 + SYSTEM_ERROR
 * notification; and PUT accepted name "".
 *
 * Validation runs before the handler, so no profile row is needed. The control
 * case (a VALID nodeType on an unknown id → 404 from the handler) proves the 400s
 * come from the schema rule, not from something else refusing the request.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs, authPut, authPost, ADMIN_PASSWORD } from './test-helper.js';
import cleaningProfileRoutes from '../modules/cleaning-profiles/routes.js';

let app: FastifyInstance;
let token = '';
const stage = (nodeType: string) => ({ stateKey: null, nodeType, configuration: {}, positionX: 0, positionY: 0 });
// the schema needs at least 2 stages; only the SECOND node's type varies between cases
const stages = (nodeType: string) => [stage('START'), stage(nodeType)];

describe('cleaning-profile schema (M15)', () => {
  beforeAll(async () => {
    app = await buildApp([{ plugin: cleaningProfileRoutes, prefix: '/api/filter-cleaning-profiles' }]);
    token = await loginAs(app);
  }, 60_000);
  afterAll(async () => { await app?.close(); });

  it('control: a valid nodeType passes validation (unknown id → 404 from the handler)', async () => {
    const res = await authPut(app, `/api/filter-cleaning-profiles/${randomUUID()}`, token, { stages: stages('END') }, ADMIN_PASSWORD);
    expect(res.statusCode).toBe(404);
  });

  it('PUT refuses an unknown nodeType with 400', async () => {
    const res = await authPut(app, `/api/filter-cleaning-profiles/${randomUUID()}`, token, { stages: stages('NOT_A_NODE') }, ADMIN_PASSWORD);
    expect(res.statusCode).toBe(400);
  });

  it('PUT refuses a blank name with 400', async () => {
    const res = await authPut(app, `/api/filter-cleaning-profiles/${randomUUID()}`, token, { name: '' }, ADMIN_PASSWORD);
    expect(res.statusCode).toBe(400);
  });

  it('POST refuses an unknown nodeType with 400', async () => {
    const res = await authPost(app, '/api/filter-cleaning-profiles', token, { name: `M15 ${Date.now()}`, stages: stages('NOT_A_NODE'), connections: [] }, ADMIN_PASSWORD);
    expect(res.statusCode).toBe(400);
  });
});
