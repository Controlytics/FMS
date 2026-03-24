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
    console.warn(`[TelemetryBatcher] Buffer overflow — dropped ${dropped.length} oldest telemetry rows`);
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
    console.warn(`[TelemetryBatcher] Buffer overflow — dropped ${dropped.length} oldest device event rows`);
  }

  deviceEventBuffer.push(row);
  if (deviceEventBuffer.length >= batchSize) {
    flushDeviceEvents().catch((err) => {
      console.error('[TelemetryBatcher] DeviceEvent flush error:', err);
    });
  }
}

export async function flushTelemetry(): Promise<void> {
  if (telemetryBuffer.length === 0 || !pool) return;

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
    // Put rows back on failure for retry, but respect max buffer size
    if (telemetryBuffer.length + rows.length <= maxBufferSize) {
      telemetryBuffer.unshift(...rows);
    } else {
      // Only re-queue what fits; drop oldest excess
      const space = Math.max(0, maxBufferSize - telemetryBuffer.length);
      if (space > 0) {
        telemetryBuffer.unshift(...rows.slice(-space));
      }
      console.warn(`[TelemetryBatcher] Dropped ${rows.length - space} telemetry rows on re-queue (buffer full)`);
    }
    throw err;
  }
}

export async function flushDeviceEvents(): Promise<void> {
  if (deviceEventBuffer.length === 0 || !pool) return;

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
    // Put rows back on failure for retry, but respect max buffer size
    if (deviceEventBuffer.length + rows.length <= maxBufferSize) {
      deviceEventBuffer.unshift(...rows);
    } else {
      const space = Math.max(0, maxBufferSize - deviceEventBuffer.length);
      if (space > 0) {
        deviceEventBuffer.unshift(...rows.slice(-space));
      }
      console.warn(`[TelemetryBatcher] Dropped ${rows.length - space} device event rows on re-queue (buffer full)`);
    }
    throw err;
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
  isInitialized = false;
}

export function getTelemetryBufferSize(): number {
  return telemetryBuffer.length;
}

export function getDeviceEventBufferSize(): number {
  return deviceEventBuffer.length;
}
