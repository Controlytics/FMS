/**
 * Ingestion Service — Pipeline Stages 3, 6, 7, 8, 9, 10, 11.
 *
 * Pipeline flow:
 *   Stage 3: Device Validation (IP allowlist, rate limiting)
 *   Stage 6: Message Normalization & Validation (schema, types, ranges, timestamps)
 *   Stage 7: Rule Chain Resolution & Execution
 *   Stage 8: Rule Chain Output (alarms, notifications)
 *   Stage 9: Data Persistence (TSDB + PG)
 *   Stage 10: Audit Trail (compliance-critical only)
 *   Stage 11: Event Emission (Redis pub/sub, MQTT retained, notifications)
 */

import { prisma } from '../../lib/prisma.js';
import { computeChecksum } from '../../lib/hash-chain.js';
import { flushAll } from '@digilog/db';
import { Queue } from 'bullmq';
import { getRedisConnection, QUEUES, JOB_PRIORITY } from '@digilog/queue';
import IORedis from 'ioredis';
import type { IngestionMessage } from './message-normalizer.js';
import { getConfigOrDefault } from './ingestion-config.service.js';
import { markOnline } from './connectivity-tracker.js';
import { executeRuleChain } from '../rule-chain/rule-engine.js';
import type { AlarmAction, NotificationAction } from '../rule-chain/types.js';
import {
  saveTelemetry,
  saveAttributes,
  saveChecklist,
  createAlarm,
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
import { dispatchNotification } from "../notification-delivery/notification-dispatcher.js";

// ─── Redis publisher for Stage 11 ──────────────────────

let redisPub: IORedis | null = null;

function getRedisPublisher(): IORedis {
  if (!redisPub) {
    redisPub = new IORedis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
  }
  return redisPub;
}

let notificationQueue: Queue | null = null;

function getNotificationQueue(): Queue {
  if (!notificationQueue) {
    notificationQueue = new Queue(QUEUES.NOTIFICATION.name, {
      connection: getRedisConnection(),
      defaultJobOptions: QUEUES.NOTIFICATION.defaultJobOptions,
    });
  }
  return notificationQueue;
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
 * Called by the BullMQ worker for each job.
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

    // ── Stage 6.5: Template Alarm Rules Evaluation ──
    const stage6_5Start = Date.now();
    try {
      await evaluateTemplateAlarmRules(msg, warnings);
      if (trace) {
        recordStage(trace, {
          stage: 6,
          name: 'Template Alarm Rules',
          status: 'SUCCESS',
          durationMs: Date.now() - stage6_5Start,
        });
      }
    } catch (err) {
      warnings.push(`WARN_TEMPLATE_ALARM:${err instanceof Error ? err.message : String(err)}`);
      if (trace) {
        recordStage(trace, {
          stage: 6,
          name: 'Template Alarm Rules',
          status: 'FAILED',
          durationMs: Date.now() - stage6_5Start,
          errorCode: 'ERR_TEMPLATE_ALARM',
        });
      }
    }

    // ── Stages 7-8: Rule Chain Resolution & Execution ──
    let ruleChainAlarms: AlarmAction[] = [];
    let ruleChainNotifications: NotificationAction[] = [];

    const stage7Start = Date.now();
    try {
      if (msg.ruleChainId && msg.entityId) {
        const engineResult = await executeRuleChain(
          { ...msg.data, _messageType: msg.messageType },
          msg.metadata,
          msg.ruleChainId,
          {
            entityId: msg.entityId,
            entityName: msg.entityName,
            templateId: msg.templateId,
            unsPath: msg.unsPath,
          },
        );

        // Collect alarms and notifications from rule chain
        ruleChainAlarms = engineResult.alarms;
        ruleChainNotifications = engineResult.notifications;

        // Merge metadata from rule chain
        if (engineResult.metadata) {
          Object.assign(msg.metadata, engineResult.metadata);
        }

        // Rule chain can modify the message data
        const { _messageType, _saveAs, _scope, ...cleanData } = engineResult.message;
        if (Object.keys(cleanData).length > 0) {
          msg.data = cleanData as Record<string, unknown>;
        }

        if (engineResult.errors.length > 0) {
          for (const err of engineResult.errors) {
            warnings.push(`WARN_RULE_CHAIN:${err}`);
          }
        }

        // Dispatch RULE_CHAIN_TRIGGERED notification
        dispatchNotification({
          eventType: 'RULE_CHAIN_TRIGGERED',
          context: {},
          variables: {
            ruleChainName: msg.ruleChainId, entityName: msg.entityName ?? msg.entityId ?? 'N/A',
            nodesExecuted: String(engineResult.nodesExecuted), durationMs: String(engineResult.durationMs),
            timestamp: new Date().toISOString(),
          },
        }).catch(err => console.error('[RuleChainTriggered] Notification dispatch failed:', err.message));

        if (trace) {
          recordStage(trace, {
            stage: 7,
            name: 'Rule Chain Resolution',
            status: 'SUCCESS',
            durationMs: Date.now() - stage7Start,
            details: { chainId: msg.ruleChainId, nodesExecuted: engineResult.nodesExecuted },
          });
        }
      } else {
        if (trace) {
          recordStage(trace, {
            stage: 7,
            name: 'Rule Chain Resolution',
            status: 'SKIPPED',
            durationMs: 0,
          });
        }
      }
    } catch (err) {
      // Rule chain errors are warnings, not failures (fail-safe)
      warnings.push(`WARN_RULE_CHAIN_FAILED:${err instanceof Error ? err.message : String(err)}`);
      if (trace) {
        recordStage(trace, {
          stage: 7,
          name: 'Rule Chain Resolution',
          status: 'FAILED',
          durationMs: Date.now() - stage7Start,
          errorCode: 'ERR_RULE_CHAIN',
        });
      }
    }

    // Stage 8: Process rule chain outputs (alarms + notifications)
    const stage8Start = Date.now();
    try {
      for (const alarm of ruleChainAlarms) {
        if (alarm.clear) {
          // Clear existing alarm, storing the telemetry values at clear time
          await prisma.alarm.updateMany({
            where: { entityId: alarm.entityId, alarmType: alarm.alarmType, status: 'ACTIVE' },
            data: {
              status: 'CLEARED',
              clearedAt: new Date(),
              clearDetails: alarm.details ? (alarm.details as any) : undefined,
            },
          });

          // Dispatch ALARM_CLEARED notification
          const clearEntity = await prisma.assetInstance.findUnique({ where: { id: alarm.entityId }, select: { name: true } });
          dispatchNotification({
            eventType: 'ALARM_CLEARED',
            context: { severity: alarm.severity, alarmType: alarm.alarmType },
            variables: {
              alarmType: alarm.alarmType, severity: alarm.severity ?? 'INFO',
              entityName: clearEntity?.name ?? alarm.entityId, entityId: alarm.entityId,
              clearedBy: 'Rule Chain (Auto)', remarks: 'Automatically cleared by rule chain',
              timestamp: new Date().toISOString(),
            },
          }).catch(err => console.error('[AlarmAutoClear] Notification dispatch failed:', err.message));
        } else {
          // Deduplicate: only create if no ACTIVE alarm of same type exists
          // Alarm dedup check
          const existing = await prisma.alarm.findFirst({
            where: { entityId: alarm.entityId, alarmType: alarm.alarmType, status: 'ACTIVE' },
          });
          if (!existing) {
            // Creating new alarm
            await createAlarm({
              entityId: alarm.entityId,
              alarmType: alarm.alarmType,
              severity: alarm.severity,
              unsPath: msg.unsPath,
              triggerDetails: alarm.details,
              ruleChainId: msg.ruleChainId,
            });
          }
        }
      }

      for (const notification of ruleChainNotifications) {
        try {
          const queue = getNotificationQueue();
          await queue.add('rule_chain_notification', {
            type: notification.type,
            entityId: msg.entityId,
            title: notification.title,
            message: notification.message,
            targetRole: notification.targetRole,
            metadata: notification.metadata,
          }, {
            priority: JOB_PRIORITY.ALARM_PROCESSING,
          });
        } catch {
          warnings.push('WARN_NOTIFICATION_ENQUEUE_FAILED');
        }
      }

      if (trace) {
        recordStage(trace, {
          stage: 8,
          name: 'Rule Chain Output',
          status: 'SUCCESS',
          durationMs: Date.now() - stage8Start,
          details: { alarms: ruleChainAlarms.length, notifications: ruleChainNotifications.length },
        });
      }
    } catch (err) {
      warnings.push(`WARN_RULE_OUTPUT:${err instanceof Error ? err.message : String(err)}`);
      if (trace) {
        recordStage(trace, {
          stage: 8,
          name: 'Rule Chain Output',
          status: 'FAILED',
          durationMs: Date.now() - stage8Start,
          errorCode: 'ERR_RULE_OUTPUT',
        });
      }
    }

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
    } catch {
      // Emit failures are WARNINGS, NOT failures
      stage11Warnings.push('WARN_EMIT_FAILED');
      warnings.push('WARN_EMIT_FAILED');
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

    // Add to DLQ
    const failedStage = trace?.failedStage ?? 'unknown';
    await addToDLQ(msg, errorMessage, failedStage);

    // NOTE: Returning { success: false } instead of re-throwing so BullMQ marks
    // the job as completed (DLQ handles retries). Re-throwing would cause infinite
    // BullMQ retries for permanently invalid messages.
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
    case 'ALARM':
      await createAlarm({
        entityId: msg.entityId,
        alarmType: (msg.data.alarmType as string) ?? 'UNKNOWN',
        severity: (msg.data.severity as string) ?? 'WARNING',
        unsPath: msg.unsPath,
        triggerDetails: msg.data,
        ruleChainId: msg.ruleChainId || undefined,
      });
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
    case 'ALARM':
      action = 'ALARM_CREATED';
      targetType = 'ALARM';
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

  const checksum = computeChecksum({
    timestamp: timestamp.toISOString(),
    userId,
    action,
    targetType,
    targetId: msg.entityId,
    afterValue,
  } as Record<string, unknown>);

  // Audit write MUST succeed — failure = CRITICAL → DLQ
  await prisma.auditTrail.create({
    data: {
      timestamp,
      userId,
      userName: msg.metadata?.userName ?? undefined,
      userRole: msg.metadata?.userRole ?? undefined,
      action,
      targetType,
      targetId: msg.entityId,
      afterValue,
      ipAddress: msg.sourceIp || undefined,
      sessionId: msg.metadata?.sessionId ?? undefined,
      checksum,
    },
  });
}

// ─── Stage 11: Event Emission ───────────────────────────

async function executeStage11(msg: IngestionMessage, warnings: string[]): Promise<void> {
  // 1. Publish to Redis pub/sub for WebSocket broadcast
  try {
    const redis = getRedisPublisher();
    await redis.publish('ws:events', JSON.stringify({
      entityId: msg.entityId,
      type: msg.messageType,
      data: msg.data,
      timestamp: msg.timestamp,
    }));
  } catch {
    warnings.push('WARN_EMIT_WS_FAILED');
  }

  // 2. Enqueue notification if alarm created
  if (msg.messageType === 'ALARM') {
    try {
      const queue = getNotificationQueue();
      await queue.add('alarm_notification', {
        type: 'ALARM',
        entityId: msg.entityId,
        title: `Alarm: ${msg.data.alarmType ?? 'Unknown'}`,
        message: `${msg.data.severity ?? 'WARNING'} alarm on entity ${msg.entityName}`,
        metadata: {
          alarmType: msg.data.alarmType,
          severity: msg.data.severity,
        },
      }, {
        priority: JOB_PRIORITY.ALARM_PROCESSING,
      });
    } catch {
      warnings.push('WARN_EMIT_NOTIFICATION_FAILED');
    }
  }
}


// ─── Template Alarm Rule Evaluator ──────────────────────

interface TemplateAlarmRule {
  name: string;
  type: string;        // HIGH, LOW, etc.
  enabled: boolean;
  severity: string;    // CRITICAL, WARNING, etc.
  sourceField: string; // telemetry key to check
  condition: string;   // ">", "<", ">=", "<=", "==", "!="
  threshold: number;
  notifyRoles?: string[];
}

function evaluateCondition(value: number, condition: string, threshold: number): boolean {
  switch (condition) {
    case '>':  return value > threshold;
    case '<':  return value < threshold;
    case '>=': return value >= threshold;
    case '<=': return value <= threshold;
    case '==': return value === threshold;
    case '!=': return value !== threshold;
    default:   return false;
  }
}

/**
 * Evaluate template-level alarm rules against incoming telemetry data.
 * Creates alarms when conditions are met; clears them when resolved.
 */
async function evaluateTemplateAlarmRules(
  msg: IngestionMessage,
  warnings: string[],
): Promise<void> {
  // Only evaluate for telemetry messages
  if (msg.messageType !== 'POST_TELEMETRY' || !msg.templateId) return;

  const template = await prisma.assetTemplate.findUnique({
    where: { id: msg.templateId },
    select: { alarmRules: true },
  });

  if (!template?.alarmRules || !Array.isArray(template.alarmRules)) return;

  const rules = template.alarmRules as unknown as TemplateAlarmRule[];
  if (rules.length === 0) return;

  for (const rule of rules) {
    if (!rule.enabled || !rule.sourceField || rule.threshold === undefined) continue;

    const value = msg.data[rule.sourceField];
    if (value === undefined || value === null || typeof value !== 'number') continue;

    const alarmType = `${rule.type}_${rule.sourceField}`.toUpperCase();
    const triggered = evaluateCondition(value, rule.condition, rule.threshold);

    if (triggered) {
      // Check for existing active alarm to avoid duplicates
      const existing = await prisma.alarm.findFirst({
        where: { entityId: msg.entityId, alarmType, status: 'ACTIVE' },
      });

      if (!existing) {
        console.info(`[TemplateAlarm] ${rule.name}: ${rule.sourceField}=${value} ${rule.condition} ${rule.threshold} → TRIGGERED`);
        await createAlarm({
          entityId: msg.entityId,
          alarmType,
          severity: rule.severity || 'WARNING',
          unsPath: msg.unsPath,
          triggerDetails: {
            ruleName: rule.name,
            _sourceField: rule.sourceField,
            _condition: rule.condition,
            _threshold: rule.threshold,
            actualValue: value,
            templateId: msg.templateId,
          },
        });
      }
    } else {
      // Auto-clear: if value is back to normal, clear the alarm
      const activeAlarm = await prisma.alarm.findFirst({
        where: { entityId: msg.entityId, alarmType, status: 'ACTIVE' },
      });

      if (activeAlarm) {
        console.info(`[TemplateAlarm] ${rule.name}: ${rule.sourceField}=${value} back to normal → CLEARED`);
        await prisma.alarm.updateMany({
          where: { entityId: msg.entityId, alarmType, status: 'ACTIVE' },
          data: {
            status: 'CLEARED',
            clearedAt: new Date(),
            clearDetails: {
              reason: 'Auto-cleared: value returned to normal range',
              sourceField: rule.sourceField,
              clearedValue: value,
              threshold: rule.threshold,
              condition: rule.condition,
            } as any,
          },
        });

        // Dispatch ALARM_CLEARED notification
        const entity = await prisma.assetInstance.findUnique({ where: { id: msg.entityId }, select: { name: true } });
        dispatchNotification({
          eventType: 'ALARM_CLEARED',
          context: { severity: rule.severity, alarmType },
          variables: {
            alarmType, severity: rule.severity || 'WARNING',
            entityName: entity?.name ?? msg.entityId, entityId: msg.entityId,
            clearedBy: 'System (Auto)', remarks: `Value ${rule.sourceField}=${value} returned to normal`,
            timestamp: new Date().toISOString(),
          },
        }).catch(err => console.error('[TemplateAlarmClear] Notification dispatch failed:', err.message));
      }
    }
  }
}

/** Close the Redis publisher used by the pipeline and clean up timers. */
export async function closePipelineRedis(): Promise<void> {
  clearInterval(rateLimitCleanupTimer);
  rateLimitMap.clear();
  if (redisPub) {
    await redisPub.quit();
    redisPub = null;
  }
}
