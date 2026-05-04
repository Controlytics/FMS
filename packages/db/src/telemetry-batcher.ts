import type pg from 'pg';

interface TelemetryRow {
  time: Date;
  entityId: string;
  key: string;
  valueNum: number | null;
  valueStr: string | null;
  valueBool: boolean | null;
  valueJson: unknown | null;
  unsPath: string;
  source: string;
  sourceIp: string | null;
  traceId: string | null;
}

interface DeviceEventRow {
  time: Date;
  entityId: string;
  eventType: string;
  details: unknown | null;
  sourceIp: string | null;
  unsPath: string;
}

let pool: pg.Pool | null = null;
const telemetryBuffer: TelemetryRow[] = [];
const deviceEventBuffer: DeviceEventRow[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let batchSize = 100;
let flushIntervalMs = 1000;
let maxBufferSize = 10_000;
let isInitialized = false;

/**
 * Audit 2026-05-04 fix (queue review H4): drop counters for the
 * monitoring/runbook surface. Previously every backpressure drop logged
 * a single warn line and the dropped row vanished — operators had no
 * way to count how many writes were lost over time, no metric to alert
 * on. These counters are append-only since process start; they reset
 * on `closeTelemetryBatcher()` so test runs start clean. Exposed via
 * `getTelemetryBatcherStats()` for the system-health endpoint to
 * surface to operators.
 *
 * 21 CFR Part 11 implication: dropped telemetry rows on backpressure
 * are an undocumented data-loss path. Counters are the minimum-viable
 * disclosure — a future commit should add an alarm hook (queue H4
 * follow-up).
 */
const stats = {
  telemetryDroppedOverflow: 0,
  telemetryDroppedRequeue: 0,
  deviceEventDroppedOverflow: 0,
  deviceEventDroppedRequeue: 0,
};
export function getTelemetryBatcherStats(): Readonly<typeof stats> {
  return stats;
}

export function initTelemetryBatcher(tsdbPool: pg.Pool, opts?: { batchSize?: number; flushIntervalMs?: number; maxBufferSize?: number }): void {
  if (isInitialized) return;
  pool = tsdbPool;
  batchSize = opts?.batchSize ?? 100;
  flushIntervalMs = opts?.flushIntervalMs ?? 1000;
  maxBufferSize = opts?.maxBufferSize ?? 10_000;

  flushTimer = setInterval(() => {
    flushAll().catch((err) => {
      console.error('[TelemetryBatcher] Flush error:', err);
    });
  }, flushIntervalMs);

  isInitialized = true;
}

export function addTelemetryRow(row: TelemetryRow): void {
  // Backpressure: drop oldest rows when buffer exceeds max size
  if (telemetryBuffer.length >= maxBufferSize) {
    const dropped = telemetryBuffer.splice(0, Math.floor(maxBufferSize * 0.1));
    stats.telemetryDroppedOverflow += dropped.length;
    console.warn(`[TelemetryBatcher] Buffer overflow — dropped ${dropped.length} oldest telemetry rows (lifetime overflow drops: ${stats.telemetryDroppedOverflow})`);
  }

  telemetryBuffer.push(row);
  if (telemetryBuffer.length >= batchSize) {
    flushTelemetry().catch((err) => {
      console.error('[TelemetryBatcher] Telemetry flush error:', err);
    });
  }
}

export function addDeviceEventRow(row: DeviceEventRow): void {
  // Backpressure: drop oldest rows when buffer exceeds max size
  if (deviceEventBuffer.length >= maxBufferSize) {
    const dropped = deviceEventBuffer.splice(0, Math.floor(maxBufferSize * 0.1));
    stats.deviceEventDroppedOverflow += dropped.length;
    console.warn(`[TelemetryBatcher] Buffer overflow — dropped ${dropped.length} oldest device event rows (lifetime overflow drops: ${stats.deviceEventDroppedOverflow})`);
  }

  deviceEventBuffer.push(row);
  if (deviceEventBuffer.length >= batchSize) {
    flushDeviceEvents().catch((err) => {
      console.error('[TelemetryBatcher] DeviceEvent flush error:', err);
    });
  }
}

let flushingTelemetry = false;
export async function flushTelemetry(): Promise<void> {
  if (flushingTelemetry) return;
  if (telemetryBuffer.length === 0 || !pool) return;
  flushingTelemetry = true;

  const rows = telemetryBuffer.splice(0);
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const offset = i * 11;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11})`
    );
    values.push(
      r.time, r.entityId, r.key, r.valueNum, r.valueStr,
      r.valueBool, r.valueJson ? JSON.stringify(r.valueJson) : null,
      r.unsPath, r.source, r.sourceIp, r.traceId,
    );
  }

  const sql = `INSERT INTO ts_telemetry (time, entity_id, key, value_num, value_str, value_bool, value_json, uns_path, source, source_ip, trace_id) VALUES ${placeholders.join(', ')}`;

  try {
    await pool.query(sql, values);
  } catch (err) {
    // Audit 2026-05-04 fix (queue review H3): the previous implementation
    // unshifted rows one-by-one in a loop = O(n*m) where n=existing buffer,
    // m=requeued batch. Under sustained TSDB outage with batchSize=100 +
    // a 10k buffer, every requeue copied ~5000 elements per row = 500K
    // memory writes per flush. New approach: build the result with
    // .concat() (one allocation, two copies) — O(n+m). Same logical
    // result: failed rows go to the FRONT so they're retried first.
    const space = Math.max(0, maxBufferSize - telemetryBuffer.length);
    if (rows.length <= space) {
      telemetryBuffer.splice(0, 0, ...rows);  // splice with spread is O(n+m)
    } else {
      // Only the last `space` rows fit; drop the oldest excess.
      const requeue = rows.slice(-space);
      const dropped = rows.length - space;
      if (dropped > 0) {
        stats.telemetryDroppedRequeue += dropped;
        console.warn(`[TelemetryBatcher] Dropped ${dropped} telemetry rows on re-queue (buffer full; lifetime requeue drops: ${stats.telemetryDroppedRequeue})`);
      }
      if (requeue.length > 0) telemetryBuffer.splice(0, 0, ...requeue);
    }
    throw err;
  } finally {
    flushingTelemetry = false;
  }
}

let flushingDeviceEvents = false;
export async function flushDeviceEvents(): Promise<void> {
  if (flushingDeviceEvents) return;
  if (deviceEventBuffer.length === 0 || !pool) return;
  flushingDeviceEvents = true;

  const rows = deviceEventBuffer.splice(0);
  const values: unknown[] = [];
  const placeholders: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const offset = i * 6;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`
    );
    values.push(
      r.time, r.entityId, r.eventType,
      r.details ? JSON.stringify(r.details) : null,
      r.sourceIp, r.unsPath,
    );
  }

  const sql = `INSERT INTO ts_device_events (time, entity_id, event_type, details, source_ip, uns_path) VALUES ${placeholders.join(', ')}`;

  try {
    await pool.query(sql, values);
  } catch (err) {
    // Audit 2026-05-04 fix (queue review H3): same O(n+m) requeue as
    // flushTelemetry — see that function's inline note.
    const space = Math.max(0, maxBufferSize - deviceEventBuffer.length);
    if (rows.length <= space) {
      deviceEventBuffer.splice(0, 0, ...rows);
    } else {
      const requeue = rows.slice(-space);
      const dropped = rows.length - space;
      if (dropped > 0) {
        stats.deviceEventDroppedRequeue += dropped;
        console.warn(`[TelemetryBatcher] Dropped ${dropped} device event rows on re-queue (buffer full; lifetime requeue drops: ${stats.deviceEventDroppedRequeue})`);
      }
      if (requeue.length > 0) deviceEventBuffer.splice(0, 0, ...requeue);
    }
    throw err;
  } finally {
    flushingDeviceEvents = false;
  }
}

export async function flushAll(): Promise<void> {
  await Promise.all([flushTelemetry(), flushDeviceEvents()]);
}

export async function closeTelemetryBatcher(): Promise<void> {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  // Final flush
  await flushAll();
  // Reset drop counters so test runs start from a clean slate; production
  // closes the batcher only at shutdown so the reset is invisible.
  stats.telemetryDroppedOverflow = 0;
  stats.telemetryDroppedRequeue = 0;
  stats.deviceEventDroppedOverflow = 0;
  stats.deviceEventDroppedRequeue = 0;
  isInitialized = false;
}

export function getTelemetryBufferSize(): number {
  return telemetryBuffer.length;
}

export function getDeviceEventBufferSize(): number {
  return deviceEventBuffer.length;
}
