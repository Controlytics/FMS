/**
 * QA Phase 5, P5-02 (2026-10-21): the offline-replay grant may stand in for the
 * re-auth password ONLY on the six cycle-write routes the tablet's sync engine
 * actually replays. It used to be honoured on every `/api/filters/*` route, so
 * on `/:id/retire` (and `/:id/replace`, `/bulk-operate`) a grant silently
 * replaced the password with no offlinePerformedAt / clientOpId and no
 * replayExemptGates record.
 *
 * Real Fastify + real auth + real Prisma against digilog_test_db. A unique
 * SUPER_ADMIN avoids the shared `admin` login race. Re-auth runs before the
 * handler loads the filter, so a random id tells the two outcomes apart:
 * 401 REAUTH_REQUIRED = the grant was refused, 404 = it got past the gate.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp, loginAs, obtainOfflineGrant } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { hashPassword } from '../lib/password.js';
import { invalidateReauthCache } from '../lib/reauth-check.js';
import { isOfflineReplayRoute, OFFLINE_REPLAY_ROUTES } from '../plugins/auth.js';
import filterOperationsRoutes from '../modules/filter-operations/routes.js';

const USERNAME = `qa_p502_${Date.now()}`;
const PASSWORD = 'QaP502@Test2026';
let app: FastifyInstance;
let token: string;
let grant: string;
let reauthRowExisted = false;
let originalReauth: unknown;

describe('offline-replay grant is scoped to the replayed routes (P5-02)', () => {
  beforeAll(async () => {
    app = await buildApp([{ prefix: '/api/filters', plugin: filterOperationsRoutes }]);
    await prisma.user.create({
      data: {
        username: USERNAME, fullName: 'QA P5-02', passwordHash: await hashPassword(PASSWORD),
        role: 'SUPER_ADMIN', status: 'ENABLED', forcePasswordChange: false, isTemporaryPassword: false,
        createdBy: 'qa-p502-test',
      },
    });
    const row = await prisma.systemConfig.findUnique({ where: { configKey: 'action-reauth' } });
    reauthRowExisted = !!row;
    originalReauth = row?.configValue;
    const value = { ...((row?.configValue as Record<string, string[]>) ?? {}), RETIRE_FILTER: ['SUPER_ADMIN'], REPLACE_FILTER: ['SUPER_ADMIN'] };
    await prisma.systemConfig.upsert({
      where: { configKey: 'action-reauth' },
      update: { configValue: value },
      create: { configKey: 'action-reauth', configValue: value, configType: 'security', requiresReauth: true },
    });
    invalidateReauthCache();
    token = await loginAs(app, USERNAME, PASSWORD);
    grant = await obtainOfflineGrant(app, token, PASSWORD);
  });

  afterAll(async () => {
    if (reauthRowExisted) {
      await prisma.systemConfig.update({ where: { configKey: 'action-reauth' }, data: { configValue: originalReauth as any } });
    } else {
      await prisma.systemConfig.delete({ where: { configKey: 'action-reauth' } }).catch(() => undefined);
    }
    invalidateReauthCache();
    await prisma.session.deleteMany({ where: { user: { username: USERNAME } } });
    await prisma.passwordHistory.deleteMany({ where: { user: { username: USERNAME } } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    await app?.close();
  });

  const post = (url: string, payload: Record<string, unknown>) => app.inject({
    method: 'POST', url, payload,
    headers: { authorization: `Bearer ${token}`, 'x-offline-replay-token': grant },
  });

  it('retire with a grant and no password is refused (was: grant replaced the password)', async () => {
    const res = await post(`/api/filters/${randomUUID()}/retire`, { remarks: 'qa p5-02 probe' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('REAUTH_REQUIRED');
  });

  it('replace with a grant and no password is refused', async () => {
    const res = await post(`/api/filters/${randomUUID()}/replace`, { remarks: 'qa p5-02 probe', newFilterName: 'QA-P502-NEW' });
    expect(res.statusCode).not.toBe(404);
    expect([400, 401]).toContain(res.statusCode);
    if (res.statusCode === 401) expect(res.json().error).toBe('REAUTH_REQUIRED');
  });

  it('only the six replayed route patterns accept the grant', () => {
    for (const r of OFFLINE_REPLAY_ROUTES) expect(isOfflineReplayRoute(r), r).toBe(true);
    for (const r of ['/api/filters/:id/retire', '/api/filters/:id/replace', '/api/filters/bulk-operate',
      '/api/filters/:id/lifecycle-state', `/api/filters/${randomUUID()}/advance`, '/api/users/', undefined]) {
      expect(isOfflineReplayRoute(r as string | undefined), String(r)).toBe(false);
    }
  });

  it('the list matches what the tablet sync engine replays (drift guard)', () => {
    const src = readFileSync(resolve(__dirname, '../../../web/src/lib/sync-engine.ts'), 'utf8');
    const replayed = new Set<string>();
    for (const m of src.matchAll(/`\/api\/filters\/\$\{[^}]+\}\/([a-z-]+)`/g)) {
      if (m[1] !== 'current-state') replayed.add(`/api/filters/:id/${m[1]}`);
    }
    // the generic `${op.type}` branch posts to /api/filters/:id/<type>; op types:
    const store = readFileSync(resolve(__dirname, '../../../web/src/lib/offline-store.ts'), 'utf8');
    const typeUnion = store.match(/type: ('advance'[^;]+);/);
    expect(typeUnion, 'queued-op type union in offline-store.ts').toBeTruthy();
    const types = [...(typeUnion?.[1] ?? '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1])
      .filter((t) => !t.startsWith('start-and-') && t !== 'terminate');
    for (const t of types) replayed.add(`/api/filters/:id/${t}`);
    expect([...replayed].sort()).toEqual([...OFFLINE_REPLAY_ROUTES].sort());
  });
});
