/**
 * Fill every log channel with a representative set of entries.
 *
 *   cd apps/api && npx tsx src/scripts/generate-sample-logs.ts [outputDir]
 *
 * Why this exists:
 *   - An operator needs to know what each file looks like BEFORE an incident,
 *     not during one.
 *   - It exercises the real logger, the real formatter and the real channel
 *     routing, so it also catches a format regression that unit tests would not
 *     (e.g. a stack rendering badly, or a channel silently falling back).
 *
 * Where it writes:
 *   `apps/api/logs-sample/app/` by default — deliberately NOT the live log
 *   directory. These are FABRICATED events. Mixing invented failures into the
 *   file an operator reads during a real fault would be worse than having no
 *   samples at all, and on a validated system a log that mixes real and
 *   synthetic records is not a record. Every channel gets a banner line saying
 *   so as its first entry.
 *
 * Pass an explicit directory to write somewhere else. Passing your live LOG_DIR
 * is possible and is a bad idea; the banner is your warning.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// LOG_DIR must be set BEFORE lib/log-dir.ts is imported — it resolves the path
// once at module load. Hence the dynamic import below.
const outDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(__dirname, '../../logs-sample');

process.env.LOG_DIR = outDir;
process.env.LOG_LEVEL = 'debug';     // so the DEBUG examples are actually emitted
process.env.NODE_ENV = 'development';
delete process.env.VITEST;           // VITEST would suppress file output entirely

const { getLogger, getModuleLogger, initFileLogging, flushLogs } = await import('../lib/logger.js');

const init = await initFileLogging();
if (!init.enabled) {
  console.error(`Could not open log files at ${outDir}: ${init.error ?? 'unknown reason'}`);
  process.exit(1);
}

// ── Loggers, one per channel ────────────────────────────────────────────────
const app = getLogger('api', 'application');
const http = getLogger('http', 'http');
const db = getLogger('prisma', 'database');
const cron = getLogger('cron', 'services');
const notify = getLogger('notifications', 'services');
const ldap = getLogger('ldap', 'services');
const auth = getLogger('auth', 'security');
const access = getLogger('access', 'security');
const reauth = getLogger('reauth', 'security');
const filterOps = getModuleLogger('filter-operations');
const sync = getModuleLogger('sync');
const pm = getModuleLogger('pm-schedules');
const backup = getModuleLogger('backup');

/**
 * Build an Error with a realistic stack so the stack-rendering path is shown.
 *
 * Uses a real subclass per type, NOT `new Error()` with `.name` reassigned:
 * pino's `stdSerializers.err` reads `err.constructor.name` for the `type` field,
 * so a renamed plain Error still renders as "Error" and the sample would
 * misrepresent what a real `PrismaClientKnownRequestError` looks like.
 */
const errorClasses = new Map<string, new (m: string) => Error>();
function errorClass(type: string): new (m: string) => Error {
  let cls = errorClasses.get(type);
  if (!cls) {
    cls = { [type]: class extends Error {} }[type] as new (m: string) => Error;
    Object.defineProperty(cls, 'name', { value: type });
    errorClasses.set(type, cls);
  }
  return cls;
}

function fakeError(type: string, message: string, code?: string, frames: string[] = []): Error {
  const err = new (errorClass(type))(message);
  if (code) (err as Error & { code?: string }).code = code;
  err.stack = [`${type}: ${message}`, ...frames.map((f) => `    at ${f}`)].join('\n');
  return err;
}

const BANNER =
  'SAMPLE LOG SET — every entry below is FABRICATED by ' +
  'src/scripts/generate-sample-logs.ts to show what this channel looks like. ' +
  'These are not real events.';

// ── application ─────────────────────────────────────────────────────────────
// Log type 2: did it start, how was it configured, why did it stop.
app.info(BANNER);
app.info(
  {
    port: 3000, protocol: 'https', nodeEnv: 'production', nodeVersion: 'v22.14.0',
    pid: 4812, trustProxy: false,
    tlsCert: 'C:\\ProgramData\\DigiLog\\certs\\server.crt',
    allowedOrigins: 'https://localhost:3000,https://192.168.1.53:3000',
    uploadsDir: 'C:\\ProgramData\\DigiLog\\uploads', serveWeb: true, apiDocs: false,
  },
  'Startup configuration',
);
app.info('DigiLog API running on https://localhost:3000');
app.info({ modules: 37 }, '37 config modules registered');
app.debug({ route: 'GET /api/filters/:id/current-state', handler: 'getCurrentState' }, 'Route registered');
app.warn(
  { configKey: 'password-policy' },
  "Validation failed for config 'password-policy' — falling back to schema defaults",
);
app.warn(
  { logDir: 'C:\\ProgramData\\DigiLog\\logs\\app', reason: 'EPERM: operation not permitted' },
  'File logging is DISABLED — console output only',
);
app.error(
  {
    err: fakeError('TypeError', "Cannot read properties of undefined (reading 'stageKey')", undefined, [
      'advanceStage (filter-operations.service.ts:412:24)',
      'process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
    ]),
    reqId: 'req-8841', method: 'POST', url: '/api/filters/9f2c/advance',
    user: '101012', userId: 'a4d1-...-9f31', role: 'OPERATOR', ip: '192.168.1.77',
  },
  'Unhandled error on POST /api/filters/9f2c/advance',
);
app.fatal(
  {
    err: fakeError('Error', 'listen EADDRINUSE: address already in use 0.0.0.0:3000', 'EADDRINUSE', [
      'Server.setupListenHandle [as _listen2] (node:net:1948:16)',
      'listenInCluster (node:net:2005:12)',
    ]),
    port: 3000,
  },
  'FAILED TO START — could not listen on port 3000',
);
app.fatal(
  {
    err: fakeError('Error', 'ENOENT: no such file or directory, open \'C:\\ProgramData\\DigiLog\\certs\\server.key\'', 'ENOENT', [
      'Object.readFileSync (node:fs:441:20)',
      'file:///C:/Program%20Files/DigiLog/runtime/api/dist/app.js:98:14',
    ]),
  },
  'UNCAUGHT EXCEPTION — process is exiting',
);
app.info('Received SIGTERM, shutting down gracefully...');
app.info('Shutdown complete (SIGTERM)');

// ── http ────────────────────────────────────────────────────────────────────
// Log type 3: one line per request. Every status class appears.
http.info(BANNER);
const req = (
  id: string, method: string, url: string, status: number, ms: number,
  user?: { user: string; userId: string; role: string },
) => ({ reqId: id, method, url, status, durationMs: ms, ...(user ?? {}), ip: '192.168.1.77' });
const operator = { user: '101012', userId: 'a4d1-8c22-9f31', role: 'OPERATOR' };
const admin = { user: 'superadmin', userId: 'f8e5-e6e9-db1b', role: 'SUPER_ADMIN' };

http.info(req('req-1', 'POST', '/api/auth/login', 200, 167), 'POST /api/auth/login → 200');
http.info(req('req-2', 'GET', '/api/filters?blockId=B-04&page=1&limit=50', 200, 82, operator), 'GET /api/filters?blockId=B-04&page=1&limit=50 → 200');
http.info(req('req-3', 'POST', '/api/filters/9f2c/start-cycle', 201, 244, operator), 'POST /api/filters/9f2c/start-cycle → 201');
http.info(req('req-4', 'POST', '/api/filters/bulk-operate', 200, 3187, operator), 'POST /api/filters/bulk-operate → 200');
http.warn(req('req-5', 'GET', '/api/users?limit=500', 400, 4, admin), 'GET /api/users?limit=500 → 400');
http.warn(req('req-6', 'GET', '/api/audit', 401, 2), 'GET /api/audit → 401');
http.warn(req('req-7', 'DELETE', '/api/audit/3f81', 403, 6, operator), 'DELETE /api/audit/3f81 → 403');
http.warn(req('req-8', 'GET', '/api/filters/does-not-exist', 404, 3, operator), 'GET /api/filters/does-not-exist → 404');
http.warn(req('req-9', 'POST', '/api/filters/9f2c/start-cycle', 409, 51, operator), 'POST /api/filters/9f2c/start-cycle → 409');
http.warn(req('req-10', 'POST', '/api/uploads/photo', 413, 12, operator), 'POST /api/uploads/photo → 413');
http.warn(req('req-11', 'POST', '/api/auth/login', 429, 1), 'POST /api/auth/login → 429');
http.error(req('req-12', 'POST', '/api/filters/9f2c/advance', 500, 118, operator), 'POST /api/filters/9f2c/advance → 500');
http.info(req('req-13', 'GET', '/api/pm-schedules/pending-tasks-map', 200, 1420, operator), 'GET /api/pm-schedules/pending-tasks-map → 200');

// ── database ────────────────────────────────────────────────────────────────
// Log type 4: is the DB reachable, and what is slow.
db.info(BANNER);
db.info(
  { database: 'digilog_db', user: 'digilog', server: 'PostgreSQL 18.3', connectMs: 8, slowQueryThresholdMs: 500 },
  'Database connected (digilog_db)',
);
db.debug({ durationMs: 4, query: 'SELECT "public"."asset_instances"."id" FROM "public"."asset_instances" WHERE "id" = $1' }, 'Query');
db.warn(
  {
    durationMs: 2140,
    query: 'SELECT ... FROM "public"."audit_trail" WHERE "created_at" >= $1 ORDER BY "chain_position" DESC LIMIT $2',
    params: '["2026-08-01T00:00:00.000Z",50]',
  },
  'Slow query (2140ms)',
);
db.warn({ target: 'quaint::connector::metrics' }, 'Connection pool timeout — 10 connections in use, 0 idle');
db.error(
  { err: fakeError('PrismaClientKnownRequestError', 'Unique constraint failed on the fields: (`scheduleId`,`plannedDate`)', 'P2002'), prismaCode: 'P2002', url: '/api/pm-schedules/upload' },
  'Unmapped Prisma error',
);
db.error(
  {
    err: fakeError('PrismaClientInitializationError', "Can't reach database server at `localhost:5433`", 'P1001', [
      'PrismaClient._executeRequest (@prisma/client/runtime/library.js:121:19)',
    ]),
    connectMs: 5031,
  },
  'DATABASE CONNECTION FAILED — check that the DigiLogDB service is running and DATABASE_URL is correct',
);
db.info('Database disconnected cleanly');

// ── services ────────────────────────────────────────────────────────────────
// Log type 6: did the background work run.
cron.info(BANNER);
cron.info(
  { jobs: ['session_sweep (*/5m)', 'password_expiry_check (00:00)', 'pm_overdue_check (03:00)', 'log_retention (00:05)'] },
  'in-process node-cron scheduler started',
);
cron.info({ job: 'session_sweep' }, 'session_sweep started');
cron.info({ job: 'session_sweep', durationMs: 41, result: { terminated: 3 } }, 'session_sweep completed');
cron.info({ job: 'pm_overdue_check', durationMs: 2260, result: { opened: 2, closed: 5 } }, 'pm_overdue_check completed');
cron.info({ job: 'log_retention', durationMs: 12, result: { deletedFiles: 8, removedDates: ['2026-08-23'], keptDays: 7 } }, 'log_retention completed');
cron.warn({ job: 'pm_overdue_check' }, 'pm_overdue_check still running — skipping this tick');
cron.error(
  { job: 'password_expiry_check', durationMs: 903, err: fakeError('PrismaClientKnownRequestError', 'Timed out fetching a new connection from the connection pool', 'P2024') },
  'password_expiry_check FAILED',
);
notify.info({ eventType: 'PM_OVERDUE', channel: 'EMAIL', to: 'qa.head@example.com', rule: 'PM overdue → QA' }, 'Notification dispatched');
notify.error(
  { err: fakeError('Error', 'connect ECONNREFUSED 10.0.0.25:587', 'ECONNREFUSED'), to: 'qa.head@example.com', rule: 'PM overdue → QA', eventType: 'PM_OVERDUE' },
  'Email delivery failed',
);
notify.error({ err: fakeError('Error', 'HTTP 401 from SMS gateway'), to: '+91XXXXXXXXXX', rule: 'Deviation → Production', eventType: 'DEVIATION_OPENED' }, 'SMS delivery failed');
ldap.warn({ err: fakeError('Error', 'client is not connected') }, 'LDAP unbind after auth error failed');
ldap.error({ err: fakeError('InvalidCredentialsError', '80090308: LdapErr — DSID-0C09044E, comment: AcceptSecurityContext error') }, 'LDAP authentication error');
backup.info({ tables: 61, rows: 184203, sizeMb: 42.7, durationMs: 18400, file: 'digilog-2026-08-31-0130.bak' }, 'Nightly backup completed');

// ── security ────────────────────────────────────────────────────────────────
// Log type 7: who got in, who did not.
auth.info(BANNER);
auth.info({ username: 'superadmin', role: 'SUPER_ADMIN', ip: '127.0.0.1', userAgent: 'Mozilla/5.0' }, 'Login SUCCESS: superadmin');
auth.info({ username: '101012', role: 'OPERATOR', ip: '192.168.1.77', userAgent: 'DigiLog-FilterOps/1.1.2' }, 'Login SUCCESS: 101012');
auth.warn({ username: '101012', ip: '192.168.1.77', reason: 'INVALID_CREDENTIALS', userAgent: 'DigiLog-FilterOps/1.1.2' }, 'Login FAILED: 101012 (INVALID_CREDENTIALS)');
auth.warn({ username: 'unknown-user', ip: '192.168.1.201', reason: 'INVALID_CREDENTIALS' }, 'Login FAILED: unknown-user (INVALID_CREDENTIALS)');
auth.warn({ username: '101012', failedAttempts: 5, ip: '192.168.1.77' }, 'Account LOCKED after 5 failed attempts: 101012');
auth.info({ username: '101012', ip: '192.168.1.77', reason: 'SESSION_CONFLICT' }, 'Login blocked by an existing session: 101012');
auth.info({ username: '101012', role: 'OPERATOR', ip: '192.168.1.77', reason: 'idle_timeout' }, 'Logout (idle_timeout): 101012');
// Redaction demo — the values below are NOT written to the file.
auth.info(
  { username: '101012', password: 'hunter2', token: 'eyJhbGciOi...', body: { newPassword: 'Welcome@123' } },
  'Redaction check — password/token/newPassword must read [redacted]',
);
access.warn(req('req-7', 'DELETE', '/api/audit/3f81', 403, 6, operator), 'Permission denied: 101012 → DELETE /api/audit/3f81');
access.warn({ reqId: 'req-22', method: 'GET', url: '/api/users', status: 401, durationMs: 2, ip: '192.168.1.201' }, 'Rejected token: anonymous → GET /api/users');
access.warn({ reqId: 'req-23', method: 'POST', url: '/api/auth/login', status: 429, durationMs: 1, ip: '192.168.1.201' }, 'Rate limited: anonymous → POST /api/auth/login');
reauth.error(
  'action-reauth config is in the legacy nested shape — ALL re-authentication gates are currently DISABLED. Re-save the policy via the Action Re-auth config page to restore enforcement.',
);
getLogger('jwt', 'security').warn(
  { envVar: 'JWT_SECRET' },
  'JWT_SECRET not set or too short — using a RANDOM secret for this session. Every existing token is invalid and all sessions drop on restart. Set JWT_SECRET in the env file.',
);

// ── modules/filter-operations ───────────────────────────────────────────────
// Log type 8: what happened to this filter.
filterOps.info(BANNER);
filterOps.info({ filter: 'AHU-0A-F12', filterId: '9f2c', cycleId: 8821, reason: 'PM', profile: 'Standard HEPA Clean v4', performedBy: '101012' }, 'Cleaning cycle STARTED');
filterOps.info({ filter: 'AHU-0A-F12', cycleId: 8821, from: 'WASH_IN', to: 'WASH_OUT', durationMin: 34, performedBy: '101012' }, 'Stage advanced WASH_IN → WASH_OUT');
filterOps.info({ filter: 'AHU-0A-F12', cycleId: 8821, stage: 'WASH_IN', roWaterPressure: 2.4, compressedAirPressure: 5.1, uom: 'bar' }, 'Instrument readings recorded');
filterOps.info({ filter: 'AHU-0A-F12', cycleId: 8821, totalStages: 12, durationHours: 27.5 }, 'Cleaning cycle COMPLETED');
filterOps.warn({ filter: 'AHU-21-F03', cycleId: 8830, stage: 'DRY_OUT', deviationNo: 'DEV-2026-0142', reason: 'Dryer unavailable — approved by QA' }, 'Stage BYPASSED — deviation raised');
filterOps.warn({ pin: 3, groupId: 'eg-77', cycleId: 8830, liveVersion: 5 }, 'equipmentGroupVersionPin=3 but no snapshot row exists and live.version does not match — returning the live row with snapshotMissing');
filterOps.error(
  { err: fakeError('AppError', 'Previous scheduled task is pending', 'PM_PREVIOUS_TASK_PENDING'), filter: 'AHU-0A-F12', ahu: 'AHU-0A', pendingVisits: 2 },
  'Cleaning REFUSED — earlier PM visits still outstanding',
);
filterOps.error(
  { err: fakeError('PrismaClientKnownRequestError', 'Unique constraint failed on the fields: (`id`)', 'P2002', ['advanceStage (filter-operations.service.ts:412:24)']), filter: 'AHU-0A-F12', cycleId: 8821 },
  'Failed to advance cycle',
);

// ── modules/sync ────────────────────────────────────────────────────────────
sync.info(BANNER);
sync.info({ device: 'TABLET-03', user: '101012', queued: 47, applied: 47, durationMs: 5120 }, 'Offline batch replayed');
sync.warn({ device: 'TABLET-03', idempotencyKey: 'a7f1-...-22c9', op: 'advance' }, 'Duplicate operation ignored (idempotency key already applied)');
sync.warn({ device: 'TABLET-05', offlinePerformedAt: '2026-09-04T11:02:00.000Z', skewHours: 96 }, 'Offline timestamp outside the accepted window — operation rejected');
sync.error(
  { err: fakeError('AppError', 'Offline replay grant is invalid or expired', 'OFFLINE_GRANT_INVALID'), device: 'TABLET-07', user: '101014', queued: 12 },
  'Offline replay REJECTED — nothing was applied',
);

// ── modules/pm-schedules ────────────────────────────────────────────────────
pm.info(BANNER);
pm.info({ ahu: 'AHU-0A', year: 2026, uploaded: 14, created: 11, skippedExisting: 3 }, 'PM schedule upload applied');
pm.info({ swept: 15, opened: 2, closed: 5 }, 'PM overdue sweep completed');
pm.warn({ ahu: 'AHU-0A', entryId: 'pe-4471', plannedDate: '2026-03-10', reason: 'Filter unavailable — replacement on order' }, 'PM visit written off as NOT PERFORMED');
pm.warn({ ahu: 'AHU-0A', a: '2026-03-10 ±15', b: '2026-04-05 ±20', overlap: '16–25 Mar' }, 'Pre-existing overlapping PM windows — grandfathered, flagged in the UI');
pm.error(
  { err: fakeError('AppError', 'Two visits could be satisfied by one cleaning', 'PM_VISIT_OVERLAP'), ahu: 'AHU-0A', rejectedRows: 3, firstRejected: '2026-04-05' },
  'PM upload REJECTED — overlapping tolerance windows',
);

// ── modules/backup ──────────────────────────────────────────────────────────
backup.info(BANNER);
backup.info({ format: 'dump', tables: 61 }, 'Backup started');
backup.info({ file: 'digilog-2026-08-31-0130.bak', sizeMb: 42.7, durationMs: 18400, checksum: 'sha256:9f2c…' }, 'Backup completed');
backup.warn({ table: 'ts_telemetry' }, 'Skipping unknown table in backup: ts_telemetry');
backup.warn({ err: fakeError('SyntaxError', 'Unexpected end of JSON input') }, '_metadata.json could not be parsed; using defaults');
backup.error(
  { err: fakeError('Error', 'audit chain broken at chain_position 3308 — restore refused without --force'), file: 'digilog-2026-07-04.bak', chainPosition: 3308 },
  'Restore ABORTED — audit hash chain would not verify',
);

// ── done ────────────────────────────────────────────────────────────────────
flushLogs();
// SonicBoom writes asynchronously; give the last batch a tick to reach disk
// before the process exits, then flush once more.
await new Promise((r) => setTimeout(r, 400));
flushLogs();

console.log(`\nSample logs written to: ${outDir}\\app`);
console.log('Channels: error, application, http, database, services, security,');
console.log('          modules/{filter-operations, sync, pm-schedules, backup}\n');
console.log('NOTE: every entry is fabricated. This is a format reference, not a record.');
