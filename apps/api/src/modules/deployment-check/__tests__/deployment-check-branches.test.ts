import { describe, it, expect, vi, beforeAll, beforeEach, afterEach, afterAll } from 'vitest';

/**
 * The FAIL / WARN arms of the deployment check — the states a real install is
 * in when something is broken (no superadmin, unseeded roles, a pending
 * migration, a missing web build, an unwritable uploads dir, a legacy re-auth
 * policy). Producing them for real would mean breaking the shared test
 * database, so the database client, the re-auth health probe and the uploads
 * root are replaced here; filesystem probes are spied per test. The healthy
 * path against the real database is e2e/deployment-check.test.ts.
 */

const h = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const uploads = `${base}/digilog-cov-deploy-unit-${Date.now()}`;
  const fn = () => vi.fn();
  const prisma = {
    $queryRaw: fn(),
    role: { count: fn(), findMany: fn() },
    user: { findFirst: fn(), count: fn() },
    systemConfig: { count: fn(), findMany: fn() },
    helpArticle: { count: fn() },
    assetTemplate: { count: fn() },
    filterCleaningProfile: { count: fn() },
    checklistProfile: { count: fn() },
    notification: { count: fn() },
  };
  const log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  return { uploads, prisma, reauthHealth: vi.fn(), log };
});
vi.mock('../../../lib/prisma.js', () => ({ prisma: h.prisma }));
vi.mock('../../../lib/logger.js', () => ({ getLogger: () => h.log }));
vi.mock('../../../lib/reauth-check.js', () => ({ getReauthHealth: () => h.reauthHealth() }));
vi.mock('../../../lib/uploads-dir.js', () => ({ UPLOADS_ROOT: h.uploads }));

import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import deploymentCheckRoutes, { checkEnvironment } from '../routes.js';

const ROLE_ROWS = [
  { name: 'SUPER_ADMIN', permissions: Array(60).fill('P') },
  { name: 'ADMIN', permissions: Array(55).fill('P') },
  { name: 'SUPERVISOR', permissions: Array(9).fill('P') },
  { name: 'OPERATOR', permissions: Array(9).fill('P') },
];
const SUPERADMIN = { username: 'superadmin', status: 'ENABLED', lockoutUntil: null, role: 'SUPER_ADMIN' };

function healthy() {
  const p = h.prisma;
  p.$queryRaw.mockReset().mockResolvedValue([]);
  p.role.count.mockReset().mockResolvedValue(8);
  p.role.findMany.mockReset().mockResolvedValue(ROLE_ROWS);
  p.user.findFirst.mockReset().mockResolvedValue(SUPERADMIN);
  p.user.count.mockReset().mockResolvedValue(3);
  p.systemConfig.count.mockReset().mockResolvedValue(10);
  p.systemConfig.findMany.mockReset().mockResolvedValue(['password-policy', 'login-security', 'session', 'datetime'].map((configKey) => ({ configKey })));
  p.helpArticle.count.mockReset().mockResolvedValue(40);
  for (const m of [p.assetTemplate, p.filterCleaningProfile, p.checklistProfile, p.notification]) m.count.mockReset().mockResolvedValue(1);
  h.reauthHealth.mockReset().mockResolvedValue({ actionsConfigured: 4, legacyShape: false, effectivelyDisabled: false });
}

let app: FastifyInstance;
let lastBody = '';
const run = async () => {
  const res = await app.inject({ method: 'GET', url: '/api/deployment-check' });
  expect(res.statusCode).toBe(200);
  lastBody = res.body;
  return res.json() as { summary: any; checks: Array<{ name: string; status: string; details?: string; subChecks: any[] }> };
};
/**
 * Only AppError messages may reach a client (root CLAUDE.md): raw driver / fs
 * text carries host paths, table names and connection strings. A failing check
 * answers a fixed, coded detail and the raw text goes to the server error log.
 */
const RAW = (what: string) => `${what} at C:\\internal\\secret-path\\pg.dll`;
const expectNotLeaked = (raw: string) => {
  expect(lastBody).not.toContain(raw);
  expect(lastBody).not.toContain('secret-path');
  // ...and the raw error is kept, server-side, in the error log.
  const logged = h.log.error.mock.calls.some((c: any[]) => (c[0]?.err as Error | undefined)?.message === raw);
  expect(logged).toBe(true);
};
const checkOf = (body: Awaited<ReturnType<typeof run>>, name: string) => body.checks.find((c) => c.name === name)!;
const subOf = (body: Awaited<ReturnType<typeof run>>, name: string, sub: string) => checkOf(body, name).subChecks.find((s) => s.name === sub);

const DIST = path.resolve(__dirname, '..', '..', '..', '..', '..', 'web', 'dist');

beforeAll(async () => {
  app = Fastify({ logger: false });
  app.decorate('requireRole', () => async () => {});
  for (const p of ['/api/auth', '/api/users', '/api/config', '/api/roles', '/api/audit', '/api/assets', '/api/system-health', '/api/filters', '/api/help', '/api/notifications', '/api/filter-cleaning-profiles', '/api/pm-schedules']) {
    app.get(`${p}/probe`, async () => ({}));
  }
  await app.register(deploymentCheckRoutes, { prefix: '/api/deployment-check' });
  await app.ready();
});
afterAll(async () => {
  await app.close();
  fs.rmSync(h.uploads, { recursive: true, force: true });
});
beforeEach(() => healthy());
afterEach(() => vi.restoreAllMocks());

describe('deployment check — all healthy', () => {
  it('every check PASSes and the summary says so', async () => {
    fs.mkdirSync(path.join(h.uploads, 'photos'), { recursive: true });
    fs.mkdirSync(path.join(h.uploads, 'binary'), { recursive: true });
    const env = { ...process.env };
    Object.assign(process.env, { JWT_SECRET: 'x'.repeat(40), PORT: '3000', ALLOWED_ORIGINS: 'https://plant.local' });
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => String(p).startsWith(DIST) || String(p).startsWith(h.uploads));
    vi.spyOn(fs, 'readdirSync').mockImplementation(((p: any) => (String(p).startsWith(DIST) ? ['a.js'] : [])) as any);
    try {
      const body = await run();
      expect(body.checks.map((c) => [c.name, c.status])).toEqual([
        ['PostgreSQL', 'PASS'], ['Prisma Models', 'PASS'], ['API Routes', 'PASS'], ['Authentication', 'PASS'], ['Frontend Build', 'PASS'],
        ['File System', 'PASS'], ['Environment Variables', 'PASS'], ['Role Permissions', 'PASS'], ['Config Entries', 'PASS'],
      ]);
      expect(body.summary).toEqual({ total: 9, passed: 9, failed: 0, warnings: 0, status: 'PASS' });
      expect(subOf(body, 'Config Entries', 'reauth-policy')).toEqual({ name: 'reauth-policy', status: 'PASS', found: '4 actions gated' });
    } finally {
      // In place, never `process.env = env` (see checkEnvironment's afterEach below).
      for (const k of Object.keys(process.env)) if (!(k in env)) delete process.env[k];
      Object.assign(process.env, env);
    }
  });
});

describe('PostgreSQL check', () => {
  it('a failed connection stops the check at the first sub-check', async () => {
    h.prisma.$queryRaw.mockRejectedValueOnce(new Error(RAW('ECONNREFUSED')));
    const c = checkOf(await run(), 'PostgreSQL');
    expect(c.status).toBe('FAIL');
    expect(c.subChecks).toEqual([{ name: 'connection', status: 'FAIL', message: 'DB_UNREACHABLE: the database could not be reached. Details are in the server error log.' }]);
    expectNotLeaked(RAW('ECONNREFUSED'));
  });

  it('reports pending migrations by name, and an unreadable migrations table as WARN', async () => {
    h.prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]).mockResolvedValueOnce([{ migration_name: 'm1' }, { migration_name: 'm2' }]);
    expect(subOf(await run(), 'PostgreSQL', 'migrations')).toEqual({ name: 'migrations', status: 'FAIL', expected: '0 pending', found: '2 pending', message: 'm1, m2' });
    h.prisma.$queryRaw.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('relation does not exist'));
    expect(subOf(await run(), 'PostgreSQL', 'migrations')).toEqual({ name: 'migrations', status: 'WARN', message: 'Could not query migrations table' });
  });

  it('an unseeded database fails roles / superadmin / configs and warns on help articles', async () => {
    h.prisma.role.count.mockResolvedValue(2);
    h.prisma.user.findFirst.mockResolvedValue(null);
    h.prisma.systemConfig.count.mockResolvedValue(1);
    h.prisma.helpArticle.count.mockResolvedValue(3);
    const body = await run();
    expect(subOf(body, 'PostgreSQL', 'roles')).toMatchObject({ status: 'FAIL', found: '2', message: 'Run: npx prisma db seed' });
    expect(subOf(body, 'PostgreSQL', 'superadmin_user')).toMatchObject({ status: 'FAIL' });
    expect(subOf(body, 'PostgreSQL', 'system_configs')).toMatchObject({ status: 'FAIL', found: '1' });
    expect(subOf(body, 'PostgreSQL', 'help_articles')).toMatchObject({ status: 'WARN', found: '3' });
    expect(checkOf(body, 'Authentication').subChecks).toEqual([{ name: 'superadmin', status: 'FAIL', message: 'User not found. Run: npx prisma db seed' }]);
    expect(body.summary.status).toBe('FAIL');
  });

  it('a query that throws mid-check fails the whole check with the error as details', async () => {
    h.prisma.role.count.mockRejectedValue(new Error(RAW('permission denied for table roles')));
    const c = checkOf(await run(), 'PostgreSQL');
    const detail = 'CHECK_FAILED: the check could not complete. Details are in the server error log.';
    expect(c).toMatchObject({ status: 'FAIL', details: detail });
    expect(c.subChecks).toEqual([{ name: 'connection', status: 'FAIL', message: detail }]);
    expectNotLeaked(RAW('permission denied for table roles'));
  });
});

describe('Prisma Models check', () => {
  it('names the model whose table cannot be read', async () => {
    h.prisma.checklistProfile.count.mockRejectedValue(new Error(RAW('relation "checklist_profiles" does not exist')));
    const c = checkOf(await run(), 'Prisma Models');
    expect(c.status).toBe('FAIL');
    expect(c.subChecks.find((s: any) => s.name === 'model_ChecklistProfile')).toEqual({
      name: 'model_ChecklistProfile', status: 'FAIL', message: 'MODEL_QUERY_FAILED: the table could not be read. Details are in the server error log.',
    });
    expectNotLeaked(RAW('relation "checklist_profiles" does not exist'));
    expect(c.subChecks.find((s: any) => s.name === 'model_User')).toEqual({ name: 'model_User', status: 'PASS', found: '3' });
  });
});

describe('Authentication check', () => {
  it('fails a disabled, locked or demoted superadmin', async () => {
    h.prisma.user.findFirst.mockResolvedValue({ ...SUPERADMIN, status: 'DISABLED', lockoutUntil: new Date(Date.now() + 3_600_000), role: 'ADMIN' });
    const c = checkOf(await run(), 'Authentication');
    expect(c.status).toBe('FAIL');
    expect(c.subChecks[0]).toEqual({ name: 'status', status: 'FAIL', expected: 'ENABLED', found: 'DISABLED' });
    expect(c.subChecks[1]).toMatchObject({ name: 'not_locked', status: 'FAIL', message: expect.stringMatching(/^Locked until /) });
    expect(c.subChecks[2]).toEqual({ name: 'role', status: 'FAIL', expected: 'SUPER_ADMIN', found: 'ADMIN' });
  });

  it('a lockout in the past is not a lock; a null role reads "none"', async () => {
    h.prisma.user.findFirst.mockResolvedValue({ ...SUPERADMIN, lockoutUntil: new Date(Date.now() - 1000), role: null });
    const c = checkOf(await run(), 'Authentication');
    expect(c.subChecks[1]).toEqual({ name: 'not_locked', status: 'PASS' });
    expect(c.subChecks[2]).toMatchObject({ status: 'FAIL', found: 'none' });
  });
});

describe('Frontend Build check', () => {
  const withDist = (present: (p: string) => boolean, assets: string[] = ['a.js']) => {
    const real = fs.existsSync.bind(fs);
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => (String(p).startsWith(DIST) ? present(String(p)) : real(p)));
    vi.spyOn(fs, 'readdirSync').mockImplementation(((p: any) => (String(p).startsWith(DIST) ? assets : [])) as any);
  };

  it('a missing build directory is one FAIL with the build command', async () => {
    withDist(() => false);
    expect(checkOf(await run(), 'Frontend Build').subChecks).toEqual([
      { name: 'dist_directory', status: 'FAIL', message: `Not found: ${DIST}. Run: cd apps/web && npx vite build` },
    ]);
  });

  it('fails a build missing index.html, missing assets/, or with an empty assets/', async () => {
    withDist((p) => p === DIST);
    let c = checkOf(await run(), 'Frontend Build');
    expect(c.subChecks).toEqual([
      { name: 'dist_directory', status: 'PASS' },
      { name: 'index_html', status: 'FAIL', message: 'index.html missing in dist/' },
      { name: 'assets', status: 'FAIL', message: 'assets/ directory missing' },
    ]);
    vi.restoreAllMocks();
    withDist(() => true, []);
    c = checkOf(await run(), 'Frontend Build');
    expect(c.subChecks[2]).toEqual({ name: 'assets', status: 'FAIL', message: 'assets/ directory is empty' });
  });
});

describe('File System check', () => {
  it('cannot create the uploads root: FAIL and stop', async () => {
    fs.rmSync(h.uploads, { recursive: true, force: true });
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error(RAW('EACCES: permission denied')); });
    expect(checkOf(await run(), 'File System').subChecks).toEqual([
      { name: 'uploads_directory', status: 'FAIL', message: 'UPLOADS_CREATE_FAILED: the uploads directory could not be created. Details are in the server error log.' },
    ]);
    expectNotLeaked(RAW('EACCES: permission denied'));
  });

  it('an unwritable root fails; a sub-directory that cannot be created warns', async () => {
    fs.mkdirSync(h.uploads, { recursive: true });
    fs.rmSync(path.join(h.uploads, 'photos'), { recursive: true, force: true });
    fs.rmSync(path.join(h.uploads, 'binary'), { recursive: true, force: true });
    vi.spyOn(fs, 'accessSync').mockImplementation(() => { throw new Error('EPERM'); });
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw new Error('EPERM'); });
    const c = checkOf(await run(), 'File System');
    expect(c.status).toBe('FAIL');
    expect(c.subChecks).toEqual([
      { name: 'uploads_directory', status: 'PASS' },
      { name: 'uploads_writable', status: 'FAIL', message: 'Directory not writable' },
      { name: 'uploads/photos', status: 'WARN', message: 'Could not create' },
      { name: 'uploads/binary', status: 'WARN', message: 'Could not create' },
    ]);
  });
});

describe('Role Permissions + Config Entries checks', () => {
  it('a missing baseline role FAILs; an under-privileged one WARNs', async () => {
    h.prisma.role.findMany.mockResolvedValue([
      { name: 'SUPER_ADMIN', permissions: Array(60).fill('P') },
      { name: 'ADMIN', permissions: ['ONLY_ONE'] },
      { name: 'SUPERVISOR', permissions: null },
    ]);
    const c = checkOf(await run(), 'Role Permissions');
    expect(c.subChecks).toEqual([
      { name: 'SUPER_ADMIN', status: 'PASS', expected: '>=50', found: '60' },
      { name: 'ADMIN', status: 'WARN', expected: '>=50', found: '1', message: 'Fewer privileges than expected' },
      { name: 'SUPERVISOR', status: 'WARN', expected: '>=8', found: '0', message: 'Fewer privileges than expected' },
      { name: 'OPERATOR', status: 'FAIL', message: 'Role not found. Run: npx prisma db seed' },
    ]);
  });

  it('a missing required config key FAILs', async () => {
    h.prisma.systemConfig.findMany.mockResolvedValue([{ configKey: 'session' }]);
    const c = checkOf(await run(), 'Config Entries');
    expect(c.subChecks.filter((s: any) => s.status === 'FAIL').map((s: any) => s.name)).toEqual(['password-policy', 'login-security', 'datetime']);
  });

  // The legacy nested-shape arm is deliberately not covered here: its semantics
  // are changing in lib/reauth-check.ts (legacy is converted, gates stay on) and
  // the team lead owns those tests.
  it('re-auth policy: empty policy WARNs, unreadable WARNs', async () => {
    h.reauthHealth.mockResolvedValue({ actionsConfigured: 0, legacyShape: false, effectivelyDisabled: true });
    expect(subOf(await run(), 'Config Entries', 'reauth-policy')).toMatchObject({ status: 'WARN', found: '0 actions configured' });
    h.reauthHealth.mockRejectedValue(new Error(RAW('db gone')));
    expect(subOf(await run(), 'Config Entries', 'reauth-policy')).toEqual({
      name: 'reauth-policy', status: 'WARN', message: 'REAUTH_CONFIG_UNREADABLE: the re-auth policy could not be read. Details are in the server error log.',
    });
    expectNotLeaked(RAW('db gone'));
  });
});

describe('checkEnvironment', () => {
  const saved = { ...process.env };
  // Restore IN PLACE. `process.env = { ...saved }` swapped Node's env object for a
  // plain one, so every later `process.env.TZ = …` in the same single-fork run
  // stopped reaching Node: pin-time-zone.ts then failed "still Asia/Calcutta" in
  // date-range-guard / pm-import-guards (seen 2026-10-24).
  afterEach(() => {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  });
  const sub = (name: string) => checkEnvironment().find((c) => c.name === name);

  it('JWT_SECRET: missing / short FAIL, dev secret WARNs in dev and FAILs in production', () => {
    delete process.env.JWT_SECRET;
    expect(sub('JWT_SECRET')).toMatchObject({ status: 'FAIL' });
    process.env.JWT_SECRET = 'short';
    expect(sub('JWT_SECRET')).toMatchObject({ status: 'FAIL', message: 'Not set or too short (<32 chars)' });
    process.env.JWT_SECRET = 'LOCAL_DEV_SECRET_THAT_IS_LONG_ENOUGH_123456';
    process.env.NODE_ENV = 'development';
    expect(sub('JWT_SECRET')).toMatchObject({ status: 'WARN' });
    process.env.NODE_ENV = 'production';
    expect(sub('JWT_SECRET')).toMatchObject({ status: 'FAIL', message: 'Using default dev secret in production!' });
    process.env.JWT_SECRET = 'A'.repeat(20) + 'CHANGE_IN_PRODUCTION';
    expect(sub('JWT_SECRET')).toMatchObject({ status: 'FAIL' });
    process.env.JWT_SECRET = 'a-proper-random-secret-of-sufficient-length';
    expect(sub('JWT_SECRET')).toEqual({ name: 'JWT_SECRET', status: 'PASS' });
  });

  it('DATABASE_URL missing FAILs', () => {
    delete process.env.DATABASE_URL;
    expect(sub('DATABASE_URL')).toEqual({ name: 'DATABASE_URL', status: 'FAIL', message: 'Not set' });
  });

  it('CORS: localhost origins WARN only in production; unset WARNs; legacy CORS_ORIGIN is honoured', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOWED_ORIGINS = 'http://localhost:5175';
    expect(sub('CORS_ORIGIN')).toMatchObject({ status: 'WARN', message: 'Contains localhost — update for production' });
    process.env.ALLOWED_ORIGINS = 'http://10.0.0.5:5173';
    expect(sub('CORS_ORIGIN')).toMatchObject({ status: 'WARN' }); // a Vite dev port in production
    process.env.ALLOWED_ORIGINS = 'http://10.0.0.5:5175';
    expect(sub('CORS_ORIGIN')).toMatchObject({ status: 'WARN' });
    process.env.ALLOWED_ORIGINS = 'http://localhost:5175';
    process.env.NODE_ENV = 'development';
    expect(sub('CORS_ORIGIN')).toMatchObject({ status: 'PASS', found: 'http://localhost:5175' });
    delete process.env.ALLOWED_ORIGINS;
    process.env.CORS_ORIGIN = 'https://plant.local';
    expect(sub('CORS_ORIGIN')).toMatchObject({ status: 'PASS', found: 'https://plant.local' });
    delete process.env.CORS_ORIGIN;
    expect(sub('CORS_ORIGIN')).toEqual({ name: 'CORS_ORIGIN', status: 'WARN', message: 'Not set — will default to *' });
    delete process.env.NODE_ENV;
    expect(sub('NODE_ENV')).toEqual({ name: 'NODE_ENV', status: 'PASS', found: 'undefined' });
  });
});
