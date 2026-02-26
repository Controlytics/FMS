/**
 * Pipeline Debug Tracer — Records stage-by-stage execution for debugging.
 * Only active when trace is enabled globally, per-entity, or per-template.
 * Writes to ts_pipeline_traces (TSDB) after pipeline completes.
 * Publishes real-time trace data to Redis ws:trace:{entityId}.
 */

import { getTsdbPool } from '@digilog/db';
import IORedis from 'ioredis';
import { getConfigOrDefault } from './ingestion-config.service.js';

export interface StageResult {
  stage: number;
  name: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  errorCode?: string;
  warnings?: string[];
  details?: Record<string, unknown>;
}

export type FinalStatus = 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'FAILED' | 'DLQ';

export interface PipelineTrace {
  messageId: string;
  entityId: string | null;
  entityName: string | null;
  transport: string;
  messageType: string;
  payloadSize: number;
  stages: StageResult[];
  finalStatus: FinalStatus;
  failedStage: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  warnings: string[];
  totalDurationMs: number;
  startTime: number;
}

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

/** Check if tracing is enabled for this message context. */
export async function isTraceEnabled(entityId?: string, templateId?: string): Promise<boolean> {
  // Check global trace flag
  const globalTrace = await getConfigOrDefault<boolean>('pipeline.trace_enabled', false);
  if (globalTrace) return true;

  // Per-entity and per-template traces would be stored in a separate config
  // For now, global flag is the primary control
  // Entity/template-level trace flags can be added via getConfigOrDefault calls
  if (entityId) {
    const entityTrace = await getConfigOrDefault<boolean>(`pipeline.trace_entity.${entityId}`, false);
    if (entityTrace) return true;
  }
  if (templateId) {
    const templateTrace = await getConfigOrDefault<boolean>(`pipeline.trace_template.${templateId}`, false);
    if (templateTrace) return true;
  }

  return false;
}

/** Create a new pipeline trace context. */
export function createTrace(params: {
  messageId: string;
  entityId: string | null;
  entityName: string | null;
  transport: string;
  messageType: string;
  payloadSize: number;
}): PipelineTrace {
  return {
    messageId: params.messageId,
    entityId: params.entityId,
    entityName: params.entityName,
    transport: params.transport,
    messageType: params.messageType,
    payloadSize: params.payloadSize,
    stages: [],
    finalStatus: 'SUCCESS',
    failedStage: null,
    errorCode: null,
    errorMessage: null,
    warnings: [],
    totalDurationMs: 0,
    startTime: Date.now(),
  };
}

/** Record a stage result into the trace. */
export function recordStage(trace: PipelineTrace, result: StageResult): void {
  trace.stages.push(result);
  if (result.warnings) {
    trace.warnings.push(...result.warnings);
  }
}

/** Execute a traced stage and record its result. */
export async function traceStage<T>(
  trace: PipelineTrace | null,
  stageNum: number,
  stageName: string,
  fn: () => Promise<T>,
): Promise<{ result: T; warnings: string[] }> {
  const warnings: string[] = [];
  const start = Date.now();

  if (!trace) {
    const result = await fn();
    return { result, warnings };
  }

  try {
    const result = await fn();
    recordStage(trace, {
      stage: stageNum,
      name: stageName,
      status: 'SUCCESS',
      durationMs: Date.now() - start,
      warnings: warnings.length > 0 ? warnings : undefined,
    });
    return { result, warnings };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorCode = (err as { code?: string })?.code ?? 'ERR_STAGE_FAILED';
    recordStage(trace, {
      stage: stageNum,
      name: stageName,
      status: 'FAILED',
      durationMs: Date.now() - start,
      errorCode,
    });
    trace.failedStage = stageName;
    trace.errorCode = errorCode;
    trace.errorMessage = errorMessage;
    throw err;
  }
}

/** Finalize the trace — compute final status, write to TSDB, publish to Redis. */
export async function finalizeTrace(trace: PipelineTrace): Promise<void> {
  trace.totalDurationMs = Date.now() - trace.startTime;

  // Compute final status
  const hasFailed = trace.stages.some((s) => s.status === 'FAILED');
  const hasWarnings = trace.warnings.length > 0;

  if (hasFailed) {
    trace.finalStatus = 'FAILED';
  } else if (hasWarnings) {
    trace.finalStatus = 'SUCCESS_WITH_WARNINGS';
  } else {
    trace.finalStatus = 'SUCCESS';
  }

  // Write to TSDB
  try {
    const pool = getTsdbPool();
    await pool.query(
      `INSERT INTO ts_pipeline_traces (
        time, message_id, entity_id, entity_name, transport, message_type,
        payload_size, stages, final_status, failed_stage, error_code,
        error_message, warnings, total_duration_ms
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        new Date(),
        trace.messageId,
        trace.entityId,
        trace.entityName,
        trace.transport,
        trace.messageType,
        trace.payloadSize,
        JSON.stringify(trace.stages),
        trace.finalStatus,
        trace.failedStage,
        trace.errorCode,
        trace.errorMessage,
        trace.warnings.length > 0 ? JSON.stringify(trace.warnings) : null,
        trace.totalDurationMs,
      ],
    );
  } catch (err) {
    // Trace write failure is not critical — log and continue
    console.error('[PipelineTracer] Failed to write trace:', err);
  }

  // Publish to Redis for real-time UI streaming
  if (trace.entityId) {
    try {
      const redis = getRedisPublisher();
      await redis.publish(`ws:trace:${trace.entityId}`, JSON.stringify({
        messageId: trace.messageId,
        entityId: trace.entityId,
        messageType: trace.messageType,
        finalStatus: trace.finalStatus,
        totalDurationMs: trace.totalDurationMs,
        stages: trace.stages,
        warnings: trace.warnings,
      }));
    } catch {
      // Non-critical
    }
  }
}

/** Mark the trace as routed to DLQ. */
export function markTraceDLQ(trace: PipelineTrace): void {
  trace.finalStatus = 'DLQ';
}

/** Close the Redis publisher on shutdown. */
export async function closeTracerRedis(): Promise<void> {
  if (redisPub) {
    await redisPub.quit();
    redisPub = null;
  }
}
