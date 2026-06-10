/**
 * Operation Tracer — records every API WRITE request (POST/PUT/PATCH/DELETE)
 * as a debug trace in `ts_pipeline_traces`, so filter-cleaning and every other
 * write process appears on the Debug Traces page with SUCCESS / FAILED status,
 * the acting user, the error (if any), and the duration.
 *
 * Gated by config `debug.operation_trace_enabled` (default ON). The flag read
 * is cheap — getConfigOrDefault caches for 10s.
 *
 * Reads/GETs are intentionally NOT traced (the tablet polls /current-state and
 * /health constantly — that's noise, not transactions).
 */
import crypto from 'crypto';
import { getTsdbPool } from '@digilog/db';
import { bus } from './internal-bus.js';
import { getConfigOrDefault } from '../modules/data-ingestion/ingestion-config.service.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_SEG = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// Explicit friendly names for operations whose route doesn't read well from the
// generic CRUD deriver below (cleaning ops, auth, backup, approvals, …).
const ROUTE_NAMES: Record<string, string> = {
  // Filter cleaning
  'POST /api/filters/:id/start-cycle': 'START_CLEANING_CYCLE',
  'POST /api/filters/:id/advance': 'ADVANCE_STAGE',
  'POST /api/filters/:id/submit-checklist': 'SUBMIT_CHECKLIST',
  'POST /api/filters/:id/bypass': 'BYPASS_STAGE',
  'POST /api/filters/:id/terminate': 'TERMINATE_CYCLE',
  'PATCH /api/assets/instances/:id/lifecycle-state': 'MANUAL_STATUS_UPDATE',
  'PATCH /api/assets/instances/:id/status': 'CHANGE_STATUS',
  'POST /api/assets/instances/:id/identifiers': 'ASSIGN_IDENTIFIER',
  // Auth / session
  'POST /api/auth/login': 'LOGIN',
  'POST /api/auth/logout': 'LOGOUT',
  'POST /api/auth/change-password': 'CHANGE_PASSWORD',
  'POST /api/auth/refresh-token': 'REFRESH_TOKEN',
  'POST /api/auth/offline-grant': 'GRANT_OFFLINE_REPLAY',
  // Backup
  'POST /api/backup/export': 'BACKUP_EXPORT',
  'POST /api/backup/restore': 'BACKUP_RESTORE',
};

const VERB: Record<string, string> = { POST: 'CREATE', PUT: 'UPDATE', PATCH: 'UPDATE', DELETE: 'DELETE' };

function humanize(seg: string): string { return seg.replace(/[-_]/g, ' ').trim().toUpperCase(); }
function singular(seg: string): string {
  if (seg.endsWith('ies')) return seg.slice(0, -3) + 'y';
  if (seg.endsWith('ss')) return seg;
  if (seg.endsWith('s')) return seg.slice(0, -1);
  return seg;
}

/** Collapse real ids in a URL path to `:id` / `:n` so traces group by operation. */
export function genericPath(url: string): string {
  return (url.split('?')[0] || '').replace(UUID_SEG, '/:id').replace(/\/\d+(?=\/|$)/g, '/:n');
}

/**
 * A readable name for ANY application operation:
 *  - explicit map first (cleaning / auth / backup / …),
 *  - `.../:id/<action>`  -> "<ACTION> <RESOURCE>"   (e.g. APPROVE ADMIN REQUEST)
 *  - ends in a resource word -> "CREATE/UPDATE/DELETE <RESOURCE>" (e.g. CREATE USER)
 *  - ends in `:id`        -> "UPDATE/DELETE <RESOURCE>"
 */
export function operationName(method: string, routePath: string): string {
  const explicit = ROUTE_NAMES[`${method} ${routePath}`];
  if (explicit) return explicit;

  const segs = routePath.replace(/^\/api\//, '').split('/').filter(Boolean);
  if (segs.length === 0) return `${method} ${routePath}`;
  const verb = VERB[method] ?? method;
  const last = segs[segs.length - 1];

  if (last.startsWith(':')) {
    // .../resource/:id  -> verb on the resource
    const res = [...segs].reverse().find((s) => !s.startsWith(':')) ?? segs[0];
    return `${verb} ${humanize(singular(res))}`.trim();
  }

  const prev = segs[segs.length - 2];
  if (prev && prev.startsWith(':')) {
    // .../:id/<action>  -> action on the resource two segments back
    const res = [...segs.slice(0, -2)].reverse().find((s) => !s.startsWith(':'));
    return `${humanize(last)}${res ? ' ' + humanize(singular(res)) : ''}`.trim();
  }

  // .../resource (collection)  -> create/update/delete that resource
  return `${verb} ${humanize(singular(last))}`.trim();
}

/** Only trace business write requests; skip GETs, non-/api, refresh, and the trace API itself. */
export function shouldTrace(method: string, routePath: string): boolean {
  if (!WRITE_METHODS.has(method)) return false;
  if (!routePath.startsWith('/api/')) return false;
  if (routePath.startsWith('/api/debug')) return false;
  if (routePath.startsWith('/api/auth/refresh')) return false;
  return true;
}

export function extractEntityId(params: unknown): string | null {
  const p = (params ?? {}) as Record<string, unknown>;
  for (const k of ['id', 'filterId', 'entityId', 'instanceId']) {
    const v = p[k];
    if (typeof v === 'string' && UUID_RE.test(v)) return v;
  }
  return null;
}

export async function isOperationTraceEnabled(): Promise<boolean> {
  return getConfigOrDefault<boolean>('debug.operation_trace_enabled', true);
}

export async function recordOperationTrace(opts: {
  method: string;
  routePath: string;
  url: string;
  statusCode: number;
  durationMs: number;
  userId?: string | null;
  entityId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}): Promise<void> {
  try {
    if (!(await isOperationTraceEnabled())) return;
    const success = opts.statusCode < 400;
    const finalStatus = success ? 'SUCCESS' : 'FAILED';
    const name = operationName(opts.method, opts.routePath);
    const ms = Math.max(0, Math.round(opts.durationMs));
    const stages = [{
      stage: 1,
      name,
      status: success ? 'SUCCESS' : 'FAILED',
      durationMs: ms,
      errorCode: opts.errorCode ?? undefined,
      details: { method: opts.method, path: opts.routePath, statusCode: opts.statusCode, user: opts.userId ?? null },
    }];
    const pool = getTsdbPool();
    await pool.query(
      `INSERT INTO ts_pipeline_traces (
        time, message_id, entity_id, entity_name, transport, message_type,
        payload_size, stages, final_status, failed_stage, error_code,
        error_message, warnings, total_duration_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        new Date(), crypto.randomUUID(), opts.entityId ?? null, null, 'API', name, 0,
        JSON.stringify(stages), finalStatus, success ? null : name,
        opts.errorCode ?? null, opts.errorMessage ?? null, null, ms,
      ],
    );
    if (opts.entityId) {
      bus.emit(`ws:trace:${opts.entityId}`, {
        messageId: crypto.randomUUID(), entityId: opts.entityId, messageType: name,
        finalStatus, totalDurationMs: ms, stages, warnings: [],
      });
    }
  } catch (e) {
    // Trace write failure is never fatal to the request (we're in onResponse).
    console.error('[OperationTracer] write failed:', e);
  }
}

/**
 * Record one debug trace per AUDITED ACTION (called fire-and-forget from
 * auditLog). Every business action — HTTP-driven OR background (cron sweeps,
 * queue jobs) — becomes its own SUCCESS row; batch requests that audit N items
 * naturally produce N rows. Failures are recorded by the per-request hook
 * (which records only non-2xx), so there's no duplication for successes.
 */
export async function recordActionTrace(opts: {
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  userId?: string | null;
  userRole?: string | null;
}): Promise<void> {
  try {
    if (!(await isOperationTraceEnabled())) return;
    const entityId = typeof opts.targetId === 'string' && UUID_RE.test(opts.targetId) ? opts.targetId : null;
    const stages = [{
      stage: 1,
      name: opts.action,
      status: 'SUCCESS',
      durationMs: 0,
      details: { targetType: opts.targetType ?? null, targetId: opts.targetId ?? null, user: opts.userId ?? null, role: opts.userRole ?? null },
    }];
    const pool = getTsdbPool();
    await pool.query(
      `INSERT INTO ts_pipeline_traces (
        time, message_id, entity_id, entity_name, transport, message_type,
        payload_size, stages, final_status, failed_stage, error_code,
        error_message, warnings, total_duration_ms
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        new Date(), crypto.randomUUID(), entityId, null, 'API', opts.action, 0,
        JSON.stringify(stages), 'SUCCESS', null, null, null, null, 0,
      ],
    );
    if (entityId) {
      bus.emit(`ws:trace:${entityId}`, {
        messageId: crypto.randomUUID(), entityId, messageType: opts.action,
        finalStatus: 'SUCCESS', totalDurationMs: 0, stages, warnings: [],
      });
    }
  } catch (e) {
    console.error('[ActionTracer] write failed:', e);
  }
}
