import { type FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { prisma } from '../../lib/prisma.js';
import { getTsdbPool } from '@digilog/db';
import { getMqttClient } from '../../transport/mqtt-client.js';
import IORedis from 'ioredis';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Types ─────────────────────────────────────────────────────────────
interface SubCheck {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  expected?: string;
  found?: string;
  message?: string;
}

interface CheckResult {
  category: string;
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'SKIPPED';
  duration_ms: number;
  details?: string;
  subChecks: SubCheck[];
}

// ── Helper ────────────────────────────────────────────────────────────
async function runCheck(
  category: string,
  name: string,
  fn: () => Promise<SubCheck[]>,
): Promise<CheckResult> {
  const start = Date.now();
  try {
    const subChecks = await fn();
    const hasFail = subChecks.some((s) => s.status === 'FAIL');
    const hasWarn = subChecks.some((s) => s.status === 'WARN');
    return {
      category,
      name,
      status: hasFail ? 'FAIL' : hasWarn ? 'WARN' : 'PASS',
      duration_ms: Date.now() - start,
      subChecks,
    };
  } catch (err: any) {
    return {
      category,
      name,
      status: 'FAIL',
      duration_ms: Date.now() - start,
      details: err.message,
      subChecks: [{ name: 'connection', status: 'FAIL', message: err.message }],
    };
  }
}

// ── Check 1: PostgreSQL ───────────────────────────────────────────────
async function checkPostgresql(): Promise<SubCheck[]> {
  const checks: SubCheck[] = [];

  // Connection
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: 'connection', status: 'PASS', message: 'Connected' });
  } catch (e: any) {
    checks.push({ name: 'connection', status: 'FAIL', message: e.message });
    return checks;
  }

  // Migrations
  try {
    const pending = await prisma.$queryRaw<any[]>`
      SELECT "migration_name" FROM "_prisma_migrations"
      WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL
    `;
    checks.push(
      pending.length === 0
        ? { name: 'migrations', status: 'PASS', message: 'All applied' }
        : { name: 'migrations', status: 'FAIL', expected: '0 pending', found: `${pending.length} pending`, message: pending.map((m: any) => m.migration_name).join(', ') },
    );
  } catch {
    checks.push({ name: 'migrations', status: 'WARN', message: 'Could not query migrations table' });
  }

  // Roles
  const roleCount = await prisma.role.count();
  checks.push(
    roleCount >= 6
      ? { name: 'roles', status: 'PASS', expected: '>=6', found: String(roleCount) }
      : { name: 'roles', status: 'FAIL', expected: '>=6', found: String(roleCount), message: 'Run: npx prisma db seed' },
  );

  // Superadmin
  const admin = await prisma.user.findFirst({ where: { username: 'superadmin' } });
  checks.push(
    admin
      ? { name: 'superadmin_user', status: 'PASS', message: `Status: ${admin.status}` }
      : { name: 'superadmin_user', status: 'FAIL', message: 'Run: npx prisma db seed' },
  );

  // System configs
  const configCount = await prisma.systemConfig.count();
  checks.push(
    configCount >= 4
      ? { name: 'system_configs', status: 'PASS', expected: '>=4', found: String(configCount) }
      : { name: 'system_configs', status: 'FAIL', expected: '>=4', found: String(configCount), message: 'Run: npx prisma db seed' },
  );

  // Help articles
  const helpCount = await prisma.helpArticle.count();
  checks.push(
    helpCount >= 38
      ? { name: 'help_articles', status: 'PASS', expected: '>=38', found: String(helpCount) }
      : { name: 'help_articles', status: 'WARN', expected: '>=38', found: String(helpCount), message: 'Run: npx prisma db seed' },
  );

  // Ingestion configs
  const ingestionCount = await prisma.ingestionSystemConfig.count();
  checks.push(
    ingestionCount >= 30
      ? { name: 'ingestion_configs', status: 'PASS', expected: '>=30', found: String(ingestionCount) }
      : { name: 'ingestion_configs', status: 'WARN', expected: '>=30', found: String(ingestionCount), message: 'Run: npx prisma db seed' },
  );

  return checks;
}

// ── Check 2: TimescaleDB ──────────────────────────────────────────────
async function checkTimescaledb(): Promise<SubCheck[]> {
  const checks: SubCheck[] = [];
  const pool = getTsdbPool();

  // Connection
  try {
    await pool.query('SELECT 1');
    checks.push({ name: 'connection', status: 'PASS', message: 'Connected' });
  } catch (e: any) {
    checks.push({ name: 'connection', status: 'FAIL', message: e.message });
    return checks;
  }

  // Extensions
  try {
    const { rows } = await pool.query(`SELECT extname FROM pg_extension WHERE extname IN ('timescaledb', 'pgcrypto', 'ltree')`);
    const found = rows.map((r: any) => r.extname);
    for (const ext of ['timescaledb', 'pgcrypto']) {
      checks.push(
        found.includes(ext)
          ? { name: `extension_${ext}`, status: 'PASS' }
          : { name: `extension_${ext}`, status: 'FAIL', message: `Missing. Run: CREATE EXTENSION IF NOT EXISTS ${ext};` },
      );
    }
  } catch (e: any) {
    checks.push({ name: 'extensions', status: 'FAIL', message: e.message });
  }

  // Hypertables
  const expectedTables = ['ts_telemetry', 'ts_attributes', 'ts_checklist_responses', 'ts_device_events', 'ts_binary_data', 'ts_pipeline_traces'];
  try {
    const { rows } = await pool.query(`SELECT hypertable_name FROM timescaledb_information.hypertables`);
    const found = rows.map((r: any) => r.hypertable_name);
    for (const t of expectedTables) {
      checks.push(
        found.includes(t)
          ? { name: `hypertable_${t}`, status: 'PASS' }
          : { name: `hypertable_${t}`, status: 'FAIL', message: 'Run: psql -d digilog_tsdb -f init-tsdb.sql' },
      );
    }
  } catch (e: any) {
    checks.push({ name: 'hypertables', status: 'FAIL', message: e.message });
  }

  // Continuous aggregates
  try {
    const { rows } = await pool.query(`SELECT view_name FROM timescaledb_information.continuous_aggregates`);
    const found = rows.map((r: any) => r.view_name);
    for (const agg of ['telemetry_hourly', 'telemetry_daily']) {
      checks.push(
        found.includes(agg)
          ? { name: `aggregate_${agg}`, status: 'PASS' }
          : { name: `aggregate_${agg}`, status: 'WARN', message: 'Run: psql -d digilog_tsdb -f init-tsdb.sql' },
      );
    }
  } catch (e: any) {
    checks.push({ name: 'aggregates', status: 'WARN', message: e.message });
  }

  return checks;
}

// ── Check 3: Redis ────────────────────────────────────────────────────
async function checkRedis(): Promise<SubCheck[]> {
  const checks: SubCheck[] = [];
  const redis = new IORedis({
    host: process.env.REDIS_HOST ?? 'localhost',
    port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    connectTimeout: 5000,
    lazyConnect: true,
  });

  try {
    await redis.connect();
    const pong = await redis.ping();
    checks.push(
      pong === 'PONG'
        ? { name: 'connection', status: 'PASS', message: 'PONG' }
        : { name: 'connection', status: 'FAIL', found: pong },
    );

    // Version
    const info = await redis.info('server');
    const versionMatch = info.match(/redis_version:(\S+)/);
    if (versionMatch) {
      const ver = versionMatch[1];
      const major = parseInt(ver.split('.')[0]);
      checks.push(
        major >= 6
          ? { name: 'version', status: 'PASS', found: ver }
          : { name: 'version', status: 'WARN', expected: '>=6.0', found: ver, message: 'Recommended: Redis 6.2+' },
      );
    }
  } catch (e: any) {
    checks.push({ name: 'connection', status: 'FAIL', message: e.message });
  } finally {
    try { redis.disconnect(); } catch {}
  }

  return checks;
}

// ── Check 4: MQTT ─────────────────────────────────────────────────────
async function checkMqtt(): Promise<SubCheck[]> {
  if (process.env.MQTT_ENABLED !== 'true') {
    return [{ name: 'enabled', status: 'WARN', message: 'MQTT_ENABLED is not true — MQTT features disabled' }];
  }
  const client = getMqttClient();
  if (!client) {
    return [{ name: 'connection', status: 'FAIL', message: 'MQTT client not initialized' }];
  }
  return [
    client.connected
      ? { name: 'connection', status: 'PASS', message: `Connected to ${process.env.MQTT_BROKER_HOST ?? 'localhost'}:${process.env.MQTT_BROKER_PORT ?? '1883'}` }
      : { name: 'connection', status: 'FAIL', message: 'Client exists but not connected. Check EMQX is running.' },
  ];
}

// ── Check 5: Prisma Models ────────────────────────────────────────────
async function checkPrismaModels(): Promise<SubCheck[]> {
  const checks: SubCheck[] = [];

  // Client generated
  checks.push({ name: 'client_generated', status: 'PASS', message: 'Prisma client loaded' });

  // Key model access
  const models = [
    { name: 'User', fn: () => prisma.user.count() },
    { name: 'Role', fn: () => prisma.role.count() },
    { name: 'AssetTemplate', fn: () => prisma.assetTemplate.count() },
    { name: 'RuleChain', fn: () => prisma.ruleChain.count() },
    { name: 'SystemConfig', fn: () => prisma.systemConfig.count() },
    { name: 'FilterCleaningProfile', fn: () => prisma.filterCleaningProfile.count() },
    { name: 'ChecklistProfile', fn: () => prisma.checklistProfile.count() },
    { name: 'Notification', fn: () => prisma.notification.count() },
  ];

  for (const m of models) {
    try {
      const count = await m.fn();
      checks.push({ name: `model_${m.name}`, status: 'PASS', found: String(count) });
    } catch (e: any) {
      checks.push({ name: `model_${m.name}`, status: 'FAIL', message: e.message });
    }
  }

  return checks;
}

// ── Check 6: API Routes ──────────────────────────────────────────────
function checkApiRoutes(app: any): SubCheck[] {
  const checks: SubCheck[] = [];
  const routeTree = app.printRoutes({ commonPrefix: false });

  const criticalPrefixes = [
    '/api/auth', '/api/users', '/api/config', '/api/roles',
    '/api/audit', '/api/assets', '/api/system-health', '/api/data',
    '/api/rule-chains', '/api/filters', '/api/help', '/api/notifications',
    '/api/filter-cleaning-profiles', '/api/pm-schedules',
  ];

  for (const prefix of criticalPrefixes) {
    checks.push(
      routeTree.includes(prefix)
        ? { name: prefix, status: 'PASS' }
        : { name: prefix, status: 'FAIL', message: `Route prefix not found. Check import in app.ts` },
    );
  }

  return checks;
}

// ── Check 7: Auth ─────────────────────────────────────────────────────
async function checkAuth(): Promise<SubCheck[]> {
  const checks: SubCheck[] = [];
  const admin = await prisma.user.findFirst({
    where: { username: 'superadmin' },
  });

  if (!admin) {
    return [{ name: 'superadmin', status: 'FAIL', message: 'User not found. Run: npx prisma db seed' }];
  }

  checks.push(
    admin.status === 'ENABLED'
      ? { name: 'status', status: 'PASS', found: 'ENABLED' }
      : { name: 'status', status: 'FAIL', expected: 'ENABLED', found: admin.status },
  );

  const isLocked = admin.lockoutUntil && new Date(admin.lockoutUntil) > new Date();
  checks.push(
    !isLocked
      ? { name: 'not_locked', status: 'PASS' }
      : { name: 'not_locked', status: 'FAIL', message: `Locked until ${admin.lockoutUntil}` },
  );

  checks.push(
    admin.role === 'SUPER_ADMIN'
      ? { name: 'role', status: 'PASS', found: 'SUPER_ADMIN' }
      : { name: 'role', status: 'FAIL', expected: 'SUPER_ADMIN', found: admin.role ?? 'none' },
  );

  return checks;
}

// ── Check 8: Frontend ─────────────────────────────────────────────────
function checkFrontend(): SubCheck[] {
  const checks: SubCheck[] = [];
  const distDir = path.resolve(__dirname, '..', '..', '..', '..', 'web', 'dist');

  if (!fs.existsSync(distDir)) {
    return [{ name: 'dist_directory', status: 'FAIL', message: `Not found: ${distDir}. Run: cd apps/web && npx vite build` }];
  }
  checks.push({ name: 'dist_directory', status: 'PASS' });

  const indexHtml = path.join(distDir, 'index.html');
  checks.push(
    fs.existsSync(indexHtml)
      ? { name: 'index_html', status: 'PASS' }
      : { name: 'index_html', status: 'FAIL', message: 'index.html missing in dist/' },
  );

  const assetsDir = path.join(distDir, 'assets');
  if (fs.existsSync(assetsDir)) {
    const files = fs.readdirSync(assetsDir);
    checks.push(
      files.length > 0
        ? { name: 'assets', status: 'PASS', found: `${files.length} files` }
        : { name: 'assets', status: 'FAIL', message: 'assets/ directory is empty' },
    );
  } else {
    checks.push({ name: 'assets', status: 'FAIL', message: 'assets/ directory missing' });
  }

  return checks;
}

// ── Check 9: Filesystem ──────────────────────────────────────────────
function checkFilesystem(): SubCheck[] {
  const checks: SubCheck[] = [];
  const uploadsDir = path.resolve(__dirname, '..', '..', '..', 'uploads');

  if (!fs.existsSync(uploadsDir)) {
    // Try to create it
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      checks.push({ name: 'uploads_directory', status: 'PASS', message: 'Created' });
    } catch (e: any) {
      checks.push({ name: 'uploads_directory', status: 'FAIL', message: `Cannot create: ${e.message}` });
      return checks;
    }
  } else {
    checks.push({ name: 'uploads_directory', status: 'PASS' });
  }

  // Writable
  try {
    fs.accessSync(uploadsDir, fs.constants.W_OK);
    checks.push({ name: 'uploads_writable', status: 'PASS' });
  } catch {
    checks.push({ name: 'uploads_writable', status: 'FAIL', message: 'Directory not writable' });
  }

  // Sub-directories
  for (const sub of ['photos', 'binary']) {
    const subDir = path.join(uploadsDir, sub);
    if (!fs.existsSync(subDir)) {
      try {
        fs.mkdirSync(subDir, { recursive: true });
        checks.push({ name: `uploads/${sub}`, status: 'PASS', message: 'Created' });
      } catch {
        checks.push({ name: `uploads/${sub}`, status: 'WARN', message: 'Could not create' });
      }
    } else {
      checks.push({ name: `uploads/${sub}`, status: 'PASS' });
    }
  }

  return checks;
}

// ── Check 10: Environment ─────────────────────────────────────────────
function checkEnvironment(): SubCheck[] {
  const checks: SubCheck[] = [];
  const isProd = process.env.NODE_ENV === 'production';

  // JWT_SECRET
  const jwt = process.env.JWT_SECRET ?? '';
  if (!jwt || jwt.length < 32) {
    checks.push({ name: 'JWT_SECRET', status: 'FAIL', message: 'Not set or too short (<32 chars)' });
  } else if (jwt.includes('LOCAL_DEV') || jwt.includes('CHANGE_IN_PRODUCTION')) {
    checks.push(
      isProd
        ? { name: 'JWT_SECRET', status: 'FAIL', message: 'Using default dev secret in production!' }
        : { name: 'JWT_SECRET', status: 'WARN', message: 'Using default dev secret (ok for dev)' },
    );
  } else {
    checks.push({ name: 'JWT_SECRET', status: 'PASS' });
  }

  // Required env vars
  const required: Array<{ key: string; warn?: boolean }> = [
    { key: 'DATABASE_URL' },
    { key: 'TSDB_HOST' },
    { key: 'REDIS_HOST' },
    { key: 'API_PORT', warn: true },
  ];

  for (const { key, warn } of required) {
    const val = process.env[key];
    checks.push(
      val
        ? { name: key, status: 'PASS', found: key === 'DATABASE_URL' ? '***set***' : val }
        : { name: key, status: warn ? 'WARN' : 'FAIL', message: 'Not set' },
    );
  }

  // CORS check
  const origins = process.env.ALLOWED_ORIGINS ?? process.env.CORS_ORIGIN ?? '';
  if (isProd && (origins.includes('localhost') || origins.includes('5175') || origins.includes('5173'))) {
    checks.push({ name: 'CORS_ORIGIN', status: 'WARN', message: 'Contains localhost — update for production', found: origins });
  } else if (origins) {
    checks.push({ name: 'CORS_ORIGIN', status: 'PASS', found: origins });
  } else {
    checks.push({ name: 'CORS_ORIGIN', status: 'WARN', message: 'Not set — will default to *' });
  }

  // NODE_ENV
  checks.push({ name: 'NODE_ENV', status: 'PASS', found: process.env.NODE_ENV ?? 'undefined' });

  return checks;
}

// ── Check 11: Role Permissions ────────────────────────────────────────
async function checkRolePermissions(): Promise<SubCheck[]> {
  const checks: SubCheck[] = [];
  const roles = await prisma.role.findMany({ select: { name: true, privileges: true } });

  const minimums: Record<string, number> = {
    SUPER_ADMIN: 50,
    ADMIN: 50,
    SUPERVISOR: 8,
    MAINTENANCE: 8,
    OPERATOR: 8,
    VIEWER: 3,
  };

  for (const [roleName, minCount] of Object.entries(minimums)) {
    const role = roles.find((r) => r.name === roleName);
    if (!role) {
      checks.push({ name: roleName, status: 'FAIL', message: 'Role not found. Run: npx prisma db seed' });
      continue;
    }
    const privCount = (role.privileges as string[])?.length ?? 0;
    checks.push(
      privCount >= minCount
        ? { name: roleName, status: 'PASS', expected: `>=${minCount}`, found: String(privCount) }
        : { name: roleName, status: 'WARN', expected: `>=${minCount}`, found: String(privCount), message: 'Fewer privileges than expected' },
    );
  }

  return checks;
}

// ── Check 12: Config Entries ──────────────────────────────────────────
async function checkConfigEntries(): Promise<SubCheck[]> {
  const checks: SubCheck[] = [];
  const requiredKeys = ['password-policy', 'login-security', 'session', 'datetime'];

  const configs = await prisma.systemConfig.findMany({
    where: { configKey: { in: requiredKeys } },
    select: { configKey: true },
  });
  const foundKeys = configs.map((c) => c.configKey);

  for (const key of requiredKeys) {
    checks.push(
      foundKeys.includes(key)
        ? { name: key, status: 'PASS' }
        : { name: key, status: 'FAIL', message: `Missing. Run: npx prisma db seed` },
    );
  }

  return checks;
}

// ── Route plugin ──────────────────────────────────────────────────────
const deploymentCheckRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/',
    {
      preHandler: [app.requireRole('SUPER_ADMIN')],
      schema: {
        tags: ['Deployment'],
        summary: 'Run deployment verification checks',
        description: 'Runs 12 independent checks to verify all services, data, and configuration are correctly set up. Requires SUPER_ADMIN role.',
      },
    },
    async (_request, _reply) => {
      const results = await Promise.allSettled([
        runCheck('database', 'PostgreSQL', checkPostgresql),
        runCheck('database', 'TimescaleDB', checkTimescaledb),
        runCheck('service', 'Redis', checkRedis),
        runCheck('service', 'MQTT/EMQX', checkMqtt),
        runCheck('database', 'Prisma Models', checkPrismaModels),
        Promise.resolve(runCheck('api', 'API Routes', async () => checkApiRoutes(app))),
        runCheck('auth', 'Authentication', checkAuth),
        Promise.resolve(runCheck('frontend', 'Frontend Build', async () => checkFrontend())),
        Promise.resolve(runCheck('filesystem', 'File System', async () => checkFilesystem())),
        Promise.resolve(runCheck('environment', 'Environment Variables', async () => checkEnvironment())),
        runCheck('auth', 'Role Permissions', checkRolePermissions),
        runCheck('auth', 'Config Entries', checkConfigEntries),
      ]);

      const checks: CheckResult[] = results.map((r) =>
        r.status === 'fulfilled'
          ? r.value
          : { category: 'unknown', name: 'unknown', status: 'FAIL' as const, duration_ms: 0, details: (r.reason as Error).message, subChecks: [] },
      );

      const passed = checks.filter((c) => c.status === 'PASS').length;
      const failed = checks.filter((c) => c.status === 'FAIL').length;
      const warnings = checks.filter((c) => c.status === 'WARN').length;

      return {
        summary: {
          total: checks.length,
          passed,
          failed,
          warnings,
          status: failed > 0 ? 'FAIL' : warnings > 0 ? 'WARN' : 'PASS',
        },
        checks,
        timestamp: new Date().toISOString(),
        serverInfo: {
          hostname: os.hostname(),
          nodeVersion: process.version,
          uptime: Math.floor(process.uptime()),
          platform: os.platform(),
        },
      };
    },
  );
};

export default deploymentCheckRoutes;
