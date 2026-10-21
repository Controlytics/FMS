/**
 * e2e — GET /api/deployment-check against the real test database.
 *
 * Every database / config / role check runs for real against digilog_test_db,
 * so each sub-check is asserted against what the DB actually holds right now
 * (other suites add roles and users concurrently, so thresholds are checked,
 * not exact counts). The API-routes check sees only the prefixes this harness
 * mounts, which exercises both its PASS and FAIL arms honestly.
 *
 * The filesystem check is pointed at a FRESH temp directory (UPLOAD_DIR, set
 * before any import) so its "Created" arms run against a real disk without
 * writing into the repo; the env var is restored and the dir removed after.
 *
 * Failure arms that would need a broken install (no superadmin, no roles, a
 * pending migration, an unwritable disk) are in
 * modules/deployment-check/__tests__/deployment-check-branches.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const upload = vi.hoisted(() => {
  const prev = process.env.UPLOAD_DIR;
  const base = process.env.TEMP || process.env.TMPDIR || '/tmp';
  const dir = `${base}/digilog-cov-deploy-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  process.env.UPLOAD_DIR = dir;
  return { prev, dir };
});

import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './test-helper.js';
import { prisma } from '../lib/prisma.js';
import { getReauthHealth } from '../lib/reauth-check.js';
import deploymentCheckRoutes from '../modules/deployment-check/routes.js';
import { runSuffix, createRole, createUser, login, deleteUsers, deleteRoles } from './support/owned-fixtures.js';

const SUF = runSuffix();
const SA = `cv_dc_sa_${SUF}`.toLowerCase();
const LOW = `cv_dc_low_${SUF}`.toLowerCase();
const LOW_ROLE = `CVDC_${SUF}`;
const PW = 'CovDeploy@2026x';

let app: FastifyInstance;
let saToken = '', lowToken = '';
const userIds: string[] = [];

type Sub = { name: string; status: string; expected?: string; found?: string; message?: string };
type Check = { category: string; name: string; status: string; duration_ms: number; subChecks: Sub[]; details?: string };

beforeAll(async () => {
  app = await buildApp([{ prefix: '/api/deployment-check', plugin: deploymentCheckRoutes }]);
  await createRole(LOW_ROLE, ['CONFIG_READ']);
  userIds.push(await createUser(SA, 'SUPER_ADMIN', PW), await createUser(LOW, LOW_ROLE, PW));
  saToken = await login(app, SA, PW);
  lowToken = await login(app, LOW, PW);
}, 120_000);

afterAll(async () => {
  try {
    await deleteUsers(userIds);
    await deleteRoles([LOW_ROLE]);
  } finally {
    if (upload.prev === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = upload.prev;
    fs.rmSync(upload.dir, { recursive: true, force: true });
    await app?.close();
  }
}, 120_000);

describe('GET /api/deployment-check', () => {
  let body: { summary: any; checks: Check[]; timestamp: string; serverInfo: any };
  const check = (name: string) => {
    const c = body.checks.find((x) => x.name === name);
    if (!c) throw new Error(`no check named ${name}`);
    return c;
  };
  const sub = (checkName: string, subName: string) => {
    const s = check(checkName).subChecks.find((x) => x.name === subName);
    if (!s) throw new Error(`no sub-check ${checkName}/${subName}`);
    return s;
  };

  beforeAll(async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deployment-check', headers: { authorization: `Bearer ${saToken}` } });
    expect(res.statusCode).toBe(200);
    body = res.json();
  });

  it('runs the nine checks and summarises them consistently', () => {
    expect(body.checks.map((c) => `${c.category}/${c.name}`)).toEqual([
      'database/PostgreSQL', 'database/Prisma Models', 'api/API Routes', 'auth/Authentication', 'frontend/Frontend Build',
      'filesystem/File System', 'environment/Environment Variables', 'auth/Role Permissions', 'auth/Config Entries',
    ]);
    for (const c of body.checks) {
      const worst = c.subChecks.some((s) => s.status === 'FAIL') ? 'FAIL' : c.subChecks.some((s) => s.status === 'WARN') ? 'WARN' : 'PASS';
      expect({ name: c.name, status: c.status }).toEqual({ name: c.name, status: worst });
      expect(c.duration_ms).toBeGreaterThanOrEqual(0);
    }
    const count = (s: string) => body.checks.filter((c) => c.status === s).length;
    expect(body.summary).toEqual({
      total: 9, passed: count('PASS'), failed: count('FAIL'), warnings: count('WARN'),
      status: count('FAIL') > 0 ? 'FAIL' : count('WARN') > 0 ? 'WARN' : 'PASS',
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(body.serverInfo).toMatchObject({ nodeVersion: process.version, platform: process.platform });
    expect(typeof body.serverInfo.hostname).toBe('string');
  });

  it('PostgreSQL: connected, migrations applied, seed thresholds met on the test DB', async () => {
    expect(sub('PostgreSQL', 'connection')).toMatchObject({ status: 'PASS', message: 'Connected' });
    const pending = await prisma.$queryRaw<any[]>`SELECT 1 FROM "_prisma_migrations" WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL`;
    expect(sub('PostgreSQL', 'migrations').status).toBe(pending.length === 0 ? 'PASS' : 'FAIL');
    const roles = sub('PostgreSQL', 'roles');
    // Derived from what the check saw: a freshly seeded DB may sit right at the threshold.
    expect(roles.status).toBe(Number(roles.found) >= 6 ? 'PASS' : 'FAIL');
    expect(Number(roles.found)).toBeGreaterThanOrEqual(1);
    const superadmin = await prisma.user.findFirst({ where: { username: 'superadmin' } });
    expect(sub('PostgreSQL', 'superadmin_user')).toMatchObject(superadmin ? { status: 'PASS', message: `Status: ${superadmin.status}` } : { status: 'FAIL' });
    const cfg = sub('PostgreSQL', 'system_configs');
    expect(cfg.status).toBe(Number(cfg.found) >= 4 ? 'PASS' : 'FAIL');
    const help = sub('PostgreSQL', 'help_articles');
    expect(help.found).toBe(String(await prisma.helpArticle.count()));
    expect(help.status).toBe(Number(help.found) >= 38 ? 'PASS' : 'WARN');
  });

  it('Prisma Models: every key model is queryable', () => {
    const c = check('Prisma Models');
    expect(c.status).toBe('PASS');
    expect(c.subChecks.map((s) => s.name)).toEqual([
      'client_generated', 'model_User', 'model_Role', 'model_AssetTemplate', 'model_SystemConfig',
      'model_FilterCleaningProfile', 'model_ChecklistProfile', 'model_Notification',
    ]);
  });

  it('API Routes: mounted prefixes PASS, unmounted ones FAIL with a hint', () => {
    for (const p of ['/api/auth', '/api/users', '/api/config', '/api/roles', '/api/audit', '/api/assets', '/api/system-health', '/api/notifications']) {
      expect(sub('API Routes', p).status).toBe('PASS');
    }
    // This harness does not mount filter-operations, help, cleaning profiles or PM schedules.
    for (const p of ['/api/filters', '/api/help', '/api/filter-cleaning-profiles', '/api/pm-schedules']) {
      expect(sub('API Routes', p)).toMatchObject({ status: 'FAIL', message: 'Route prefix not found. Check import in app.ts' });
    }
    expect(check('API Routes').status).toBe('FAIL');
  });

  it('Authentication: reflects the superadmin account as stored', async () => {
    const admin = await prisma.user.findFirst({ where: { username: 'superadmin' } });
    const c = check('Authentication');
    if (!admin) {
      expect(c.subChecks).toEqual([{ name: 'superadmin', status: 'FAIL', message: 'User not found. Run: npx prisma db seed' }]);
      return;
    }
    expect(sub('Authentication', 'status').status).toBe(admin.status === 'ENABLED' ? 'PASS' : 'FAIL');
    const locked = !!admin.lockoutUntil && admin.lockoutUntil > new Date();
    expect(sub('Authentication', 'not_locked').status).toBe(locked ? 'FAIL' : 'PASS');
    expect(sub('Authentication', 'role').status).toBe(admin.role === 'SUPER_ADMIN' ? 'PASS' : 'FAIL');
  });

  it('Frontend Build: matches what is on disk', () => {
    const dist = path.resolve(__dirname, '..', '..', '..', 'web', 'dist');
    if (!fs.existsSync(dist)) {
      expect(sub('Frontend Build', 'dist_directory').status).toBe('FAIL');
      return;
    }
    expect(sub('Frontend Build', 'dist_directory').status).toBe('PASS');
    expect(sub('Frontend Build', 'index_html').status).toBe(fs.existsSync(path.join(dist, 'index.html')) ? 'PASS' : 'FAIL');
    const assets = path.join(dist, 'assets');
    const nAssets = fs.existsSync(assets) ? fs.readdirSync(assets).length : -1;
    expect(sub('Frontend Build', 'assets')).toMatchObject(nAssets > 0 ? { status: 'PASS', found: `${nAssets} files` } : { status: 'FAIL' });
  });

  it('File System: creates the upload tree it needs, then reports it writable', () => {
    expect(sub('File System', 'uploads_directory')).toMatchObject({ status: 'PASS', message: 'Created' });
    expect(sub('File System', 'uploads_writable').status).toBe('PASS');
    expect(sub('File System', 'uploads/photos')).toMatchObject({ status: 'PASS', message: 'Created' });
    expect(sub('File System', 'uploads/binary')).toMatchObject({ status: 'PASS', message: 'Created' });
    expect(fs.existsSync(path.join(upload.dir, 'photos'))).toBe(true);
    expect(fs.existsSync(path.join(upload.dir, 'binary'))).toBe(true);
  });

  it('File System: an existing tree is reported without being recreated', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deployment-check', headers: { authorization: `Bearer ${saToken}` } });
    const fsCheck = (res.json().checks as Check[]).find((c) => c.name === 'File System')!;
    expect(fsCheck.subChecks).toEqual([
      { name: 'uploads_directory', status: 'PASS' }, { name: 'uploads_writable', status: 'PASS' },
      { name: 'uploads/photos', status: 'PASS' }, { name: 'uploads/binary', status: 'PASS' },
    ]);
  });

  it('Environment Variables: DATABASE_URL is masked, never echoed', () => {
    expect(sub('Environment Variables', 'DATABASE_URL')).toEqual({ name: 'DATABASE_URL', status: 'PASS', found: '***set***' });
    expect(JSON.stringify(check('Environment Variables'))).not.toContain(process.env.DATABASE_URL!);
    expect(sub('Environment Variables', 'NODE_ENV').found).toBe(process.env.NODE_ENV ?? 'undefined');
  });

  it('Role Permissions: each baseline role is checked against its minimum', async () => {
    const minimums: Record<string, number> = { SUPER_ADMIN: 50, ADMIN: 50, SUPERVISOR: 8, OPERATOR: 8 };
    for (const [name, min] of Object.entries(minimums)) {
      const role = await prisma.role.findFirst({ where: { name }, select: { permissions: true } });
      const s = sub('Role Permissions', name);
      if (!role) { expect(s.status).toBe('FAIL'); continue; }
      const n = (role.permissions as string[]).length;
      expect(s).toMatchObject({ status: n >= min ? 'PASS' : 'WARN', expected: `>=${min}`, found: String(n) });
    }
  });

  it('Config Entries: required keys present, re-auth policy health reported', async () => {
    const present = (await prisma.systemConfig.findMany({
      where: { configKey: { in: ['password-policy', 'login-security', 'session', 'datetime'] } }, select: { configKey: true },
    })).map((c) => c.configKey);
    for (const key of ['password-policy', 'login-security', 'session', 'datetime']) {
      expect(sub('Config Entries', key).status).toBe(present.includes(key) ? 'PASS' : 'FAIL');
    }
    const health = await getReauthHealth();
    const r = sub('Config Entries', 'reauth-policy');
    if (health.legacyShape) expect(r.status).toBe('FAIL');
    else if (health.effectivelyDisabled) expect(r.status).toBe('WARN');
    else { expect(r.status).toBe('PASS'); expect(r.found).toMatch(/^\d+ actions gated$/); }
  });

  it('is SUPER_ADMIN-only', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/deployment-check', headers: { authorization: `Bearer ${lowToken}` } });
    expect(res.statusCode).toBe(403);
    const anon = await app.inject({ method: 'GET', url: '/api/deployment-check' });
    expect(anon.statusCode).toBe(401);
  });
});
