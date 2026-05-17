/**
 * Ingestion Service — Pipeline Stages 3, 6, 9, 10, 11.
 *
 * Pipeline flow:
 *   Stage 3: Device Validation (IP allowlist, rate limiting)
 *   Stage 6: Message Normalization & Validation (schema, types, ranges, timestamps)
 *   Stage 9: Data Persistence (TSDB + PG)
 *   Stage 10: Audit Trail (compliance-critical only)
 *   Stage 11: Event Emission (internal-bus pub/sub, MQTT retained, notifications)
 *
 * NOTE: Stages 6.5 (Template Alarm Rules), 7 (Rule Chain Resolution), and 8
 * (Rule Chain Output) were removed on 2026-05-17 when the rule-chain + alarm
 * subsystems were torn out. Telemetry now flows directly from validation to
 * persistence; no alarms are created from ingested data.
 */

import { prisma } from '../../lib/prisma.js';
import { flushAll } from '@digilog/db';
import { QUEUES, getProducer } from '@digilog/queue';
import { bus } from '../../lib/internal-bus.js';
import type { IngestionMessage } from './message-normalizer.js';
import { getConfigOrDefault } from './ingestion-config.service.js';
import { markOnline } from './connectivity-tracker.js';
import {
  saveTelemetry,
  saveAttributes,
  saveChecklist,
  saveBinary,
} from './ingestion.repository.js';
import {
  type PipelineTrace,
  isTraceEnabled,
  createTrace,
  recordStage,
  finalizeTrace,
  markTraceDLQ,
} from './pipeline-tracer.js';
import { addToDLQ } from './dlq-manager.js';
import { addDeviceEventRow } from '@digilog/db';

// ─── Stage 11 fan-out goes through internal-bus (Phase 4 — was Redis) ──

// ─── Notification enqueue helper ────────────────────────
// Notification has no in-process consumer in the current codebase — jobs are
// produced here but nothing dequeues them yet. A real notification handler
// will be wired in a follow-up phase; until then the jobs accumulate in
// graphile_worker.jobs and can be inspected by ops.

export interface EnqueueNotificationOptions {
  /** Lower number = sooner (graphile-worker priority). */
  priority?: number;
  /** Idempotency key — maps to graphile-worker `jobKey`. */
  jobId?: string;
}

/**
 * Enqueue a notification job. The fixed task identifier `'notification'`
 * means the discriminator lives inside the payload (`payload.type`) rather
 * than in the task name — kept this way so the existing call sites
 * (`alarm_notification`, `rule_chain_notification`, etc.) don't need to
 * change. `maxAttempts` is read from QUEUES.NOTIFICATION.defaultJobOptions
 * .attempts so the constant is the single source of truth.
 */
export async function enqueueNotificationJob(
  _jobName: string,
  payload: Record<string, unknown>,
  options: EnqueueNotificationOptions = {},
): Promise<void> {
  const producer = await getProducer();
  await producer.addJob(
    'notification',
    payload,
    {
      priority: options.priority,
      jobKey: options.jobId,
      maxAttempts: QUEUES.NOTIFICATION.defaultJobOptions.attempts,
    },
  );
}

// ─── Ingestion enqueue helper ───────────────────────────
// Single chokepoint for enqueueing into the ingestion queue. Callers
// (mqtt-handler, HTTP routes, dlq-manager) all funnel through here.

export interface EnqueueIngestionOptions {
  /** Lower number = sooner (graphile-worker priority). */
  priority?: number;
  /** Idempotency key — maps to graphile-worker `jobKey`. */
  jobId?: string;
}

/**
 * Enqueue an ingestion message via graphile-worker. The payload wraps the
 * message in `{ msg }` so the task handler can destructure a single,
 * well-defined shape (vs. a bare message object whose fields could collide
 * with future task-level metadata). `maxAttempts` is read from
 * QUEUES.INGESTION.defaultJobOptions.attempts so the constant is the single
 * source of truth.
 */
export async function enqueueIngestionJob(
  msg: IngestionMessage,
  options: EnqueueIngestionOptions = {},
): Promise<void> {
  const producer = await getProducer();
  await producer.addJob(
    'ingestion',
    { msg },
    {
      priority: options.priority,
      jobKey: options.jobId,
      maxAttempts: QUEUES.INGESTION.defaultJobOptions.attempts,
    },
  );
}

// ─── Rate limiting state (in-memory) ───────────────────
// TODO: Move rate limiting to Redis for cross-instance consistency in cluster mode

const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

// Periodic cleanup of expired rate-limit windows (every 60s)
const RATE_LIMIT_WINDOW_MS = 60_000;
const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitMap) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      rateLimitMap.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS);
// Allow Node.js to exit even if timer is running
if (rateLimitCleanupTimer.unref) rateLimitCleanupTimer.unref();

// ─── Main Pipeline Processor ────────────────────────────

export interface PipelineResult {
  success: boolean;
  messageId: string;
  warnings: string[];
  trace?: PipelineTrace;
}

/**
 * Process a single ingestion message through the pipeline.
 * Called by the graphile-worker `ingestionTask` for each job.
 */
export async function processIngestionMessage(msg: IngestionMessage): Promise<PipelineResult> {
  const warnings: string[] = [];
  let trace: PipelineTrace | null = null;

  // Check if tracing is enabled
  const traceEnabled = await isTraceEnabled(msg.entityId, msg.templateId);
  if (traceEnabled) {
    const payloadSize = JSON.stringify(msg.data).length;
    trace = createTrace({
      messageId: msg.messageId,
      entityId: msg.entityId || null,
      entityName: msg.entityName || null,
      transport: msg.protocol,
      messageType: msg.messageType,
      payloadSize,
    });
  }

  try {
    // ── Stage 3: Device Validation ──
    const stage3Start = Date.now();
    try {
      await executeStage3(msg, warnings);
      if (trace) {
        recordStage(trace, {
          stage: 3,
          name: 'Device Validation',
          status: 'SUCCESS',
          durationMs: Date.now() - stage3Start,
          warnings: warnings.length > 0 ? [...warnings] : undefined,
        });
      }
    } catch (err) {
      if (trace) {
        recordStage(trace, {
          stage: 3,
          name: 'Device Validation',
          status: 'FAILED',
          durationMs: Date.now() - stage3Start,
          errorCode: (err as { code?: string })?.code ?? 'ERR_DEVICE_VALIDATION',
        });
      }
      throw err;
    }

    // ── Stage 6: Message Normalization & Validation ──
    const stage6Start = Date.now();
    const stage6Warnings: string[] = [];
    try {
      await executeStage6(msg, stage6Warnings);
      warnings.push(...stage6Warnings);
      if (trace) {
        recordStage(trace, {
          stage: 6,
          name: 'Message Validation',
          status: 'SUCCESS',
          durationMs: Date.now() - stage6Start,
          warnings: stage6Warnings.length > 0 ? stage6Warnings : undefined,
        });
      }
    } catch (err) {
      if (trace) {
        recordStage(trace, {
          stage: 6,
          name: 'Message Validation',
          status: 'FAILED',
          durationMs: Date.now() - stage6Start,
          errorCode: (err as { code?: string })?.code ?? 'ERR_VALIDATION',
        });
      }
      throw err;
    }

    // ── Stages 6.5, 7, 8 removed 2026-05-17 (rule-chain + alarm tear-out).
    //    Telemetry now flows from validation directly into persistence. ──

    // ── Stage 9: Data Persistence ──
    const stage9Start = Date.now();
    try {
      await executeStage9(msg);

      // CRITICAL: Flush telemetry batcher BEFORE job ack
      await flushAll();

      if (trace) {
        recordStage(trace, {
          stage: 9,
          name: 'Data Persistence',
          status: 'SUCCESS',
          durationMs: Date.now() - stage9Start,
        });
      }
    } catch (err) {
      if (trace) {
        recordStage(trace, {
          stage: 9,
          name: 'Data Persistence',
          status: 'FAILED',
          durationMs: Date.now() - stage9Start,
          errorCode: 'ERR_PERSISTENCE',
        });
      }
      throw err;
    }

    // ── Stage 10: Audit Trail ──
    const stage10Start = Date.now();
    try {
      await executeStage10(msg);
      if (trace) {
        recordStage(trace, {
          stage: 10,
          name: 'Audit Trail',
          status: 'SUCCESS',
          durationMs: Date.now() - stage10Start,
        });
      }
    } catch (err) {
      // Audit failure is CRITICAL — fail the entire job
      if (trace) {
        recordStage(trace, {
          stage: 10,
          name: 'Audit Trail',
          status: 'FAILED',
          durationMs: Date.now() - stage10Start,
          errorCode: 'ERR_AUDIT_CRITICAL',
        });
      }
      throw err;
    }

    // ── Stage 11: Event Emission ──
    const stage11Start = Date.now();
    const stage11Warnings: string[] = [];
    try {
      await executeStage11(msg, stage11Warnings);
      warnings.push(...stage11Warnings);
    } catch (err) {
      // Emit failures are WARNINGS, NOT failures — but they MUST carry the
      // cause so operators can diagnose ws-bus errors. Silent catch made
      // stuck event-emission invisible (same anti-pattern that was fixed
      // in the two enqueue catches in commit 79149f0).
      const errMessage = err instanceof Error ? err.message : String(err);
      stage11Warnings.push(`WARN_EMIT_FAILED:${errMessage}`);
      warnings.push(`WARN_EMIT_FAILED:${errMessage}`);
      console.warn('[Ingestion] Stage 11 event emission failed:', errMessage);
    }
    if (trace) {
      recordStage(trace, {
        stage: 11,
        name: 'Event Emission',
        status: 'SUCCESS',
        durationMs: Date.now() - stage11Start,
        warnings: stage11Warnings.length > 0 ? stage11Warnings : undefined,
      });
    }

    // Update connectivity
    if (msg.entityId && msg.protocol) {
      try {
        await markOnline(msg.entityId, msg.protocol, msg.sourceIp, msg.unsPath);
      } catch {
        // Non-critical
      }
    }

    // Finalize trace
    if (trace) {
      await finalizeTrace(trace);
    }

    return {
      success: true,
      messageId: msg.messageId,
      warnings,
      trace: trace ?? undefined,
    };
  } catch (err) {
    // Pipeline failed — route to DLQ
    const errorMessage = err instanceof Error ? err.message : String(err);

    if (trace) {
      markTraceDLQ(trace);
      await finalizeTrace(trace);
    }

    // Add to DLQ.
    //
    // addToDLQ writes a `dead_letter_queue` row via Prisma. If the DLQ write
    // itself fails — most likely cause: the same Postgres dependency that
    // just failed Stage 9 is still down — we must NOT silently swallow the
    // failure and return `{ success: false }`. That would drop the message
    // from BOTH the live pipeline AND the DLQ. Re-throw the original
    // pipeline error so graphile-worker retries the entire job; on the next
    // attempt either Stage 9 succeeds (best case) or the DLQ write succeeds
    // (acceptable fallback).
    const failedStage = trace?.failedStage ?? 'unknown';
    try {
      await addToDLQ(msg, errorMessage, failedStage);
    } catch (dlqErr) {
      console.error(
        '[Ingestion] DLQ write failed; re-throwing original pipeline error for graphile-worker retry:',
        dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
      );
      throw err;
    }

    // NOTE: Returning { success: false } instead of re-throwing so the queue
    // worker marks the job as completed (DLQ handles retries). Re-throwing
    // would cause graphile-worker to retry until maxAttempts for permanently
    // invalid messages. The exception path above only triggers when DLQ
    // itself fails — see the try/catch directly above.
    return {
      success: false,
      messageId: msg.messageId,
      warnings,
      trace: trace ?? undefined,
    };
  }
}

// ─── Stage 3: Device Validation ─────────────────────────

async function executeStage3(msg: IngestionMessage, warnings: string[]): Promise<void> {
  // Skip validation for internal/checklist messages (user JWT)
  if (!msg.credentialId || msg.messageType === 'POST_CHECKLIST') {
    return;
  }

  // Fetch credential once for both IP validation and rate limiting
  const credential = await prisma.deviceCredential.findUnique({
    where: { id: msg.credentialId },
    select: { allowedIps: true, maxDataRatePerMin: true },
  });

  // IP allowlist check
  const ipValidationEnabled = await getConfigOrDefault<boolean>('device.ip_validation_enabled', false);
  if (ipValidationEnabled && msg.sourceIp) {
    if (credential?.allowedIps && credential.allowedIps.length > 0) {
      if (!credential.allowedIps.includes(msg.sourceIp)) {
        // Log IP mismatch event
        addDeviceEventRow({
          time: new Date(),
          entityId: msg.entityId,
          eventType: 'IP_MISMATCH',
          details: { expected: credential.allowedIps, actual: msg.sourceIp },
          sourceIp: msg.sourceIp,
          unsPath: msg.unsPath,
        });

        const error = new Error(`IP ${msg.sourceIp} not in allowlist`);
        (error as Error & { code: string }).code = 'ERR_IP_MISMATCH';
        throw error;
      }
    }
  }

  // Rate limiting
  const rateLimitEnabled = await getConfigOrDefault<boolean>('device.rate_limit_enabled', true);
  if (rateLimitEnabled) {
    const maxRate = credential?.maxDataRatePerMin ?? 600;
    const now = Date.now();
    const key = `rate:${msg.credentialId}`;
    const bucket = rateLimitMap.get(key);

    if (bucket && (now - bucket.windowStart) < RATE_LIMIT_WINDOW_MS) {
      bucket.count++;
      if (bucket.count > maxRate) {
        addDeviceEventRow({
          time: new Date(),
          entityId: msg.entityId,
          eventType: 'RATE_LIMITED',
          details: { rate: bucket.count, maxRate },
          sourceIp: msg.sourceIp,
          unsPath: msg.unsPath,
        });

        const error = new Error(`Rate limit exceeded: ${bucket.count}/${maxRate} per minute`);
        (error as Error & { code: string }).code = 'ERR_RATE_LIMITED';
        throw error;
      }
    } else {
      rateLimitMap.set(key, { count: 1, windowStart: now });
    }
  }
}

// ─── Stage 6: Message Normalization & Validation ────────

async function executeStage6(msg: IngestionMessage, warnings: string[]): Promise<void> {
  // Skip validation for events and binary (no schema to validate against)
  if (msg.messageType === 'DEVICE_EVENT' || msg.messageType === 'POST_BINARY') {
    return;
  }

  if (!msg.templateId) return;

  // Get template schema for validation
  const template = await prisma.assetTemplate.findUnique({
    where: { id: msg.templateId },
    select: { telemetrySchema: true, attributeSchema: true },
  });

  if (!template) return;

  const schema = msg.messageType === 'POST_TELEMETRY'
    ? (template.telemetrySchema as Array<{ key: string; dataType: string; min?: number; max?: number; resolution?: number }>)
    : msg.messageType === 'POST_ATTRIBUTES'
      ? (template.attributeSchema as Array<{ key: string; dataType: string; min?: number; max?: number; resolution?: number }>)
      : null;

  if (!schema || !Array.isArray(schema)) return;

  const schemaMap = new Map(schema.map((s) => [s.key, s]));

  for (const [key, value] of Object.entries(msg.data)) {
    if (key.startsWith('_')) continue;
    const def = schemaMap.get(key);

    // Unknown key — warn but continue (allow custom keys)
    if (!def) continue;

    // Type validation
    if (def.dataType === 'INTEGER' || def.dataType === 'FLOAT') {
      if (typeof value !== 'number') {
        const error = new Error(`Key "${key}": expected numeric, got ${typeof value}`);
        (error as Error & { code: string }).code = 'ERR_TYPE_MISMATCH';
        throw error;
      }

      // Range validation
      if (def.min !== undefined && def.min !== null && value < def.min) {
        const error = new Error(`Key "${key}": value ${value} below minimum ${def.min}`);
        (error as Error & { code: string }).code = 'ERR_RANGE_VIOLATION';
        throw error;
      }
      if (def.max !== undefined && def.max !== null && value > def.max) {
        const error = new Error(`Key "${key}": value ${value} above maximum ${def.max}`);
        (error as Error & { code: string }).code = 'ERR_RANGE_VIOLATION';
        throw error;
      }

      // Resolution validation for FLOAT
      if (def.dataType === 'FLOAT' && def.resolution) {
        const factor = 1 / def.resolution;
        const rounded = Math.round(value * factor) / factor;
        if (Math.abs(value - rounded) > Number.EPSILON) {
          // Auto-round and warn
          msg.data[key] = rounded;
          warnings.push(`WARN_RESOLUTION_ROUNDED:${key}`);
        }
      }
    }

    if (def.dataType === 'BOOLEAN' && typeof value !== 'boolean') {
      const error = new Error(`Key "${key}": expected boolean, got ${typeof value}`);
      (error as Error & { code: string }).code = 'ERR_TYPE_MISMATCH';
      throw error;
    }
  }

  // Timestamp drift validation
  if (msg.timestamp) {
    const maxDriftHours = await getConfigOrDefault<number>('pipeline.timestamp_max_drift_hours', 24);
    const msgTime = new Date(msg.timestamp).getTime();
    const now = Date.now();
    const driftMs = Math.abs(msgTime - now);
    const driftHours = driftMs / (1000 * 60 * 60);

    if (driftHours > maxDriftHours) {
      // Replace with server time and warn
      msg.timestamp = new Date().toISOString();
      warnings.push('WARN_TIMESTAMP_CORRECTED');
    }
  }
}

// ─── Stage 9: Data Persistence ──────────────────────────

async function executeStage9(msg: IngestionMessage): Promise<void> {
  switch (msg.messageType) {
    case 'POST_TELEMETRY':
      await saveTelemetry(msg);
      break;
    case 'POST_ATTRIBUTES':
      await saveAttributes(msg);
      break;
    case 'POST_CHECKLIST':
      await saveChecklist(msg);
      break;
    case 'POST_BINARY':
      await saveBinary(msg);
      break;
    case 'DEVICE_EVENT':
      addDeviceEventRow({
        time: new Date(msg.timestamp),
        entityId: msg.entityId,
        eventType: (msg.data.event as string) ?? 'UNKNOWN',
        details: msg.data,
        sourceIp: msg.sourceIp || null,
        unsPath: msg.unsPath,
      });
      break;
    default:
      // Unknown message type — save as event
      addDeviceEventRow({
        time: new Date(msg.timestamp),
        entityId: msg.entityId,
        eventType: `UNKNOWN_${msg.messageType}`,
        details: msg.data,
        sourceIp: msg.sourceIp || null,
        unsPath: msg.unsPath,
      });
  }
}

// ─── Stage 10: Audit Trail ──────────────────────────────

async function executeStage10(msg: IngestionMessage): Promise<void> {
  // Only audit compliance-critical actions
  // Telemetry → NOT audited (immutable in TSDB)
  // Device events → NOT audited
  // Binary → NOT audited

  let action: string | null = null;
  let targetType: string | null = null;

  switch (msg.messageType) {
    case 'POST_ATTRIBUTES':
      action = 'DATA_ATTRIBUTES_UPDATED';
      targetType = 'ENTITY';
      break;
    case 'POST_CHECKLIST':
      action = 'DATA_CHECKLIST_SUBMITTED';
      targetType = 'CHECKLIST';
      break;
    default:
      // No audit for telemetry, events, binary
      return;
  }

  // All roles are audited — 21 CFR Part 11 compliance requires complete audit trail

  const timestamp = new Date();
  const userId = msg.metadata?.userId || msg.credentialId || 'system';
  const afterValue = {
    messageType: msg.messageType,
    entityId: msg.entityId,
    dataKeys: Object.keys(msg.data).filter((k) => !k.startsWith('_')),
  };

  // Audit 2026-05-04 fix C3: route through the chained auditLog() helper so
  // ingestion-time audit rows participate in the tamper-evident chain. The
  // helper acquires the advisory lock + computes the chain link.
  const { auditLog } = await import('../../lib/audit.js');
  await auditLog({
    userId,
    userName: msg.metadata?.userName ?? undefined,
    userRole: msg.metadata?.userRole ?? undefined,
    action,
    targetType,
    targetId: msg.entityId,
    afterValue,
    ipAddress: msg.sourceIp || undefined,
    sessionId: msg.metadata?.sessionId ?? undefined,
  });
}

// ─── Stage 11: Event Emission ───────────────────────────

async function executeStage11(msg: IngestionMessage, _warnings: string[]): Promise<void> {
  // Publish to internal-bus for WebSocket broadcast (Phase 4 — was Redis)
  bus.emit('ws:events', {
    entityId: msg.entityId,
    type: msg.messageType,
    data: msg.data,
    timestamp: msg.timestamp,
  });

  // NOTE: The legacy alarm_notification enqueue and template-alarm-rule
  // evaluation were removed on 2026-05-17 with the rule-chain + alarm
  // tear-out. Telemetry no longer triggers alarms in this pipeline.
}

/**
 * Phase 4 (2026-05-01): bus is in-process — no Redis to close. Renamed from
 * `closePipelineRedis` to accurately reflect what shutdown actually clears
 * (the rate-limit setInterval timer + map).
 */
export async function stopRateLimitCleanup(): Promise<void> {
  clearInterval(rateLimitCleanupTimer);
  rateLimitMap.clear();
}
