import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initTelemetryBatcher,
  addTelemetryRow,
  addDeviceEventRow,
  flushTelemetry,
  flushDeviceEvents,
  flushAll,
  closeTelemetryBatcher,
  getTelemetryBufferSize,
  getDeviceEventBufferSize,
} from '../telemetry-batcher.js';

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

function makeTelemetryRow(overrides?: Partial<TelemetryRow>): TelemetryRow {
  return {
    time: new Date('2026-01-15T10:00:00Z'),
    entityId: 'entity-001',
    key: 'temperature',
    valueNum: 25.5,
    valueStr: null,
    valueBool: null,
    valueJson: null,
    unsPath: '/site/area/line/sensor',
    source: 'mqtt',
    sourceIp: '192.168.1.10',
    traceId: 'trace-abc-123',
    ...overrides,
  };
}

function makeDeviceEventRow(overrides?: Partial<DeviceEventRow>): DeviceEventRow {
  return {
    time: new Date('2026-01-15T10:00:00Z'),
    entityId: 'entity-002',
    eventType: 'CONNECTED',
    details: null,
    sourceIp: '192.168.1.20',
    unsPath: '/site/area/line/device',
    ...overrides,
  };
}

function createMockPool() {
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
}

describe('telemetry-batcher', () => {
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockPool = createMockPool();
  });

  afterEach(async () => {
    await closeTelemetryBatcher();
    vi.useRealTimers();
  });

  // ─── initTelemetryBatcher ───────────────────────────────────────────

  describe('initTelemetryBatcher', () => {
    it('should initialize with default options', () => {
      initTelemetryBatcher(mockPool as any);
      expect(getTelemetryBufferSize()).toBe(0);
      expect(getDeviceEventBufferSize()).toBe(0);
    });

    it('should be a no-op if already initialized', () => {
      const pool2 = createMockPool();
      initTelemetryBatcher(mockPool as any);
      // Add a row so we can verify pool reference did not change
      addTelemetryRow(makeTelemetryRow());
      // Second init with a different pool should be ignored
      initTelemetryBatcher(pool2 as any);
      // Flush should use the original pool
      flushTelemetry();
      vi.advanceTimersByTime(0);
      expect(mockPool.query).toHaveBeenCalled();
      expect(pool2.query).not.toHaveBeenCalled();
    });

    it('should accept custom batchSize and flushIntervalMs', async () => {
      initTelemetryBatcher(mockPool as any, { batchSize: 2, flushIntervalMs: 5000 });
      addTelemetryRow(makeTelemetryRow());
      // Should not auto-flush at 1 row (batchSize is 2)
      expect(getTelemetryBufferSize()).toBe(1);
      // Adding second row triggers auto-flush
      addTelemetryRow(makeTelemetryRow({ key: 'humidity' }));
      // Allow the flush promise to resolve
      await vi.advanceTimersByTimeAsync(0);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(getTelemetryBufferSize()).toBe(0);
    });
  });

  // ─── addTelemetryRow ───────────────────────────────────────────────

  describe('addTelemetryRow', () => {
    it('should add a row and report correct buffer size', () => {
      initTelemetryBatcher(mockPool as any);
      addTelemetryRow(makeTelemetryRow());
      expect(getTelemetryBufferSize()).toBe(1);
      addTelemetryRow(makeTelemetryRow({ key: 'pressure' }));
      expect(getTelemetryBufferSize()).toBe(2);
    });

    it('should not affect device event buffer', () => {
      initTelemetryBatcher(mockPool as any);
      addTelemetryRow(makeTelemetryRow());
      expect(getDeviceEventBufferSize()).toBe(0);
    });
  });

  // ─── addDeviceEventRow ─────────────────────────────────────────────

  describe('addDeviceEventRow', () => {
    it('should add a row and report correct buffer size', () => {
      initTelemetryBatcher(mockPool as any);
      addDeviceEventRow(makeDeviceEventRow());
      expect(getDeviceEventBufferSize()).toBe(1);
      addDeviceEventRow(makeDeviceEventRow({ eventType: 'DISCONNECTED' }));
      expect(getDeviceEventBufferSize()).toBe(2);
    });

    it('should not affect telemetry buffer', () => {
      initTelemetryBatcher(mockPool as any);
      addDeviceEventRow(makeDeviceEventRow());
      expect(getTelemetryBufferSize()).toBe(0);
    });
  });

  // ─── backpressure ────────────────────────────────────────────────

  describe('backpressure', () => {
    it('should drop oldest telemetry rows when buffer exceeds maxBufferSize', () => {
      initTelemetryBatcher(mockPool as any, { batchSize: 1000, maxBufferSize: 50 });

      // Fill buffer to max
      for (let i = 0; i < 50; i++) {
        addTelemetryRow(makeTelemetryRow({ key: `key-${i}` }));
      }
      expect(getTelemetryBufferSize()).toBe(50);

      // Adding one more triggers drop of 10% (5 rows), then adds the new one
      addTelemetryRow(makeTelemetryRow({ key: 'overflow' }));
      // 50 - 5 (dropped) + 1 (new) = 46
      expect(getTelemetryBufferSize()).toBe(46);
    });

    it('should drop oldest device event rows when buffer exceeds maxBufferSize', () => {
      initTelemetryBatcher(mockPool as any, { batchSize: 1000, maxBufferSize: 20 });

      for (let i = 0; i < 20; i++) {
        addDeviceEventRow(makeDeviceEventRow({ eventType: `evt-${i}` }));
      }
      expect(getDeviceEventBufferSize()).toBe(20);

      addDeviceEventRow(makeDeviceEventRow({ eventType: 'overflow' }));
      // 20 - 2 (10% of 20) + 1 = 19
      expect(getDeviceEventBufferSize()).toBe(19);
    });
  });

  // ─── flushTelemetry ────────────────────────────────────────────────

  describe('flushTelemetry', () => {
    it('should build correct multi-row INSERT SQL and clear buffer', async () => {
      initTelemetryBatcher(mockPool as any);
      const row1 = makeTelemetryRow({ key: 'temp', valueNum: 22.0 });
      const row2 = makeTelemetryRow({ key: 'humidity', valueNum: 55.0, valueJson: { unit: '%' } });
      addTelemetryRow(row1);
      addTelemetryRow(row2);
      expect(getTelemetryBufferSize()).toBe(2);

      await flushTelemetry();

      expect(getTelemetryBufferSize()).toBe(0);
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const [sql, values] = mockPool.query.mock.calls[0];

      // Verify SQL structure
      expect(sql).toContain('INSERT INTO ts_telemetry');
      expect(sql).toContain('time, entity_id, key, value_num, value_str, value_bool, value_json, uns_path, source, source_ip, trace_id');
      // Two rows = placeholders $1..$11 and $12..$22
      expect(sql).toContain('$1');
      expect(sql).toContain('$11');
      expect(sql).toContain('$12');
      expect(sql).toContain('$22');

      // Verify values array length: 2 rows * 11 columns = 22
      expect(values).toHaveLength(22);

      // Verify first row values
      expect(values[0]).toEqual(row1.time);
      expect(values[1]).toBe('entity-001');
      expect(values[2]).toBe('temp');
      expect(values[3]).toBe(22.0);

      // Verify second row's valueJson is stringified
      expect(values[17]).toBe(JSON.stringify({ unit: '%' }));
    });

    it('should be a no-op when buffer is empty', async () => {
      initTelemetryBatcher(mockPool as any);
      await flushTelemetry();
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should stringify non-null valueJson', async () => {
      initTelemetryBatcher(mockPool as any);
      const jsonData = { nested: { value: [1, 2, 3] } };
      addTelemetryRow(makeTelemetryRow({ valueJson: jsonData }));
      await flushTelemetry();

      const [, values] = mockPool.query.mock.calls[0];
      // valueJson is the 7th column (index 6)
      expect(values[6]).toBe(JSON.stringify(jsonData));
    });

    it('should pass null for null valueJson', async () => {
      initTelemetryBatcher(mockPool as any);
      addTelemetryRow(makeTelemetryRow({ valueJson: null }));
      await flushTelemetry();

      const [, values] = mockPool.query.mock.calls[0];
      // valueJson is the 7th column (index 6)
      expect(values[6]).toBeNull();
    });
  });

  // ─── flushDeviceEvents ─────────────────────────────────────────────

  describe('flushDeviceEvents', () => {
    it('should build correct multi-row INSERT SQL and clear buffer', async () => {
      initTelemetryBatcher(mockPool as any);
      const row1 = makeDeviceEventRow({ eventType: 'CONNECTED' });
      const row2 = makeDeviceEventRow({ eventType: 'DISCONNECTED', details: { reason: 'timeout' } });
      addDeviceEventRow(row1);
      addDeviceEventRow(row2);
      expect(getDeviceEventBufferSize()).toBe(2);

      await flushDeviceEvents();

      expect(getDeviceEventBufferSize()).toBe(0);
      expect(mockPool.query).toHaveBeenCalledTimes(1);

      const [sql, values] = mockPool.query.mock.calls[0];

      // Verify SQL structure
      expect(sql).toContain('INSERT INTO ts_device_events');
      expect(sql).toContain('time, entity_id, event_type, details, source_ip, uns_path');
      // Two rows = placeholders $1..$6 and $7..$12
      expect(sql).toContain('$1');
      expect(sql).toContain('$6');
      expect(sql).toContain('$7');
      expect(sql).toContain('$12');

      // Verify values array length: 2 rows * 6 columns = 12
      expect(values).toHaveLength(12);

      // Verify first row values
      expect(values[0]).toEqual(row1.time);
      expect(values[1]).toBe('entity-002');
      expect(values[2]).toBe('CONNECTED');
      expect(values[3]).toBeNull(); // details null

      // Verify second row's details is stringified
      expect(values[9]).toBe(JSON.stringify({ reason: 'timeout' }));
    });

    it('should be a no-op when buffer is empty', async () => {
      initTelemetryBatcher(mockPool as any);
      await flushDeviceEvents();
      expect(mockPool.query).not.toHaveBeenCalled();
    });
  });

  // ─── auto-flush on batchSize ───────────────────────────────────────

  describe('auto-flush', () => {
    it('should auto-flush telemetry when buffer reaches batchSize', async () => {
      initTelemetryBatcher(mockPool as any, { batchSize: 3 });
      addTelemetryRow(makeTelemetryRow({ key: 'a' }));
      addTelemetryRow(makeTelemetryRow({ key: 'b' }));
      expect(getTelemetryBufferSize()).toBe(2);
      expect(mockPool.query).not.toHaveBeenCalled();

      // Third row triggers auto-flush
      addTelemetryRow(makeTelemetryRow({ key: 'c' }));
      // Let the async flush resolve
      await vi.advanceTimersByTimeAsync(0);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(getTelemetryBufferSize()).toBe(0);
    });

    it('should auto-flush device events when buffer reaches batchSize', async () => {
      initTelemetryBatcher(mockPool as any, { batchSize: 2 });
      addDeviceEventRow(makeDeviceEventRow({ eventType: 'CONNECTED' }));
      expect(getDeviceEventBufferSize()).toBe(1);

      // Second row triggers auto-flush
      addDeviceEventRow(makeDeviceEventRow({ eventType: 'DISCONNECTED' }));
      await vi.advanceTimersByTimeAsync(0);
      expect(mockPool.query).toHaveBeenCalledTimes(1);
      expect(getDeviceEventBufferSize()).toBe(0);
    });
  });

  // ─── flush error handling ──────────────────────────────────────────

  describe('flush error handling', () => {
    it('should put telemetry rows back in buffer on query failure', async () => {
      initTelemetryBatcher(mockPool as any);
      addTelemetryRow(makeTelemetryRow({ key: 'temp' }));
      addTelemetryRow(makeTelemetryRow({ key: 'humidity' }));
      expect(getTelemetryBufferSize()).toBe(2);

      mockPool.query.mockRejectedValueOnce(new Error('connection lost'));

      await expect(flushTelemetry()).rejects.toThrow('connection lost');

      // Rows should be put back
      expect(getTelemetryBufferSize()).toBe(2);
    });

    it('should put device event rows back in buffer on query failure', async () => {
      initTelemetryBatcher(mockPool as any);
      addDeviceEventRow(makeDeviceEventRow({ eventType: 'CONNECTED' }));
      expect(getDeviceEventBufferSize()).toBe(1);

      mockPool.query.mockRejectedValueOnce(new Error('db error'));

      await expect(flushDeviceEvents()).rejects.toThrow('db error');

      // Row should be put back
      expect(getDeviceEventBufferSize()).toBe(1);
    });
  });

  // ─── flushAll ──────────────────────────────────────────────────────

  describe('flushAll', () => {
    it('should flush both telemetry and device event buffers', async () => {
      initTelemetryBatcher(mockPool as any);
      addTelemetryRow(makeTelemetryRow());
      addDeviceEventRow(makeDeviceEventRow());

      await flushAll();

      expect(getTelemetryBufferSize()).toBe(0);
      expect(getDeviceEventBufferSize()).toBe(0);
      // Two separate queries: one for telemetry, one for device events
      expect(mockPool.query).toHaveBeenCalledTimes(2);
    });
  });

  // ─── interval-based flush ──────────────────────────────────────────

  describe('interval-based flush', () => {
    it('should flush buffers on the configured interval', async () => {
      initTelemetryBatcher(mockPool as any, { flushIntervalMs: 2000 });
      addTelemetryRow(makeTelemetryRow());
      addDeviceEventRow(makeDeviceEventRow());

      // No flush yet
      expect(mockPool.query).not.toHaveBeenCalled();

      // Advance timer past the interval
      await vi.advanceTimersByTimeAsync(2000);

      // Both buffers should have been flushed
      expect(mockPool.query).toHaveBeenCalledTimes(2);
      expect(getTelemetryBufferSize()).toBe(0);
      expect(getDeviceEventBufferSize()).toBe(0);
    });
  });

  // ─── closeTelemetryBatcher ─────────────────────────────────────────

  describe('closeTelemetryBatcher', () => {
    it('should clear the interval timer, flush remaining data, and reset state', async () => {
      initTelemetryBatcher(mockPool as any, { flushIntervalMs: 5000 });
      addTelemetryRow(makeTelemetryRow());
      addDeviceEventRow(makeDeviceEventRow());

      await closeTelemetryBatcher();

      // Both buffers should be flushed
      expect(getTelemetryBufferSize()).toBe(0);
      expect(getDeviceEventBufferSize()).toBe(0);
      expect(mockPool.query).toHaveBeenCalledTimes(2);

      // After close, advancing timers should NOT trigger more flushes
      mockPool.query.mockClear();
      await vi.advanceTimersByTimeAsync(10000);
      expect(mockPool.query).not.toHaveBeenCalled();
    });

    it('should allow re-initialization after close', async () => {
      initTelemetryBatcher(mockPool as any);
      await closeTelemetryBatcher();

      // Re-initialize with a new pool
      const pool2 = createMockPool();
      initTelemetryBatcher(pool2 as any);
      addTelemetryRow(makeTelemetryRow());
      await flushTelemetry();

      expect(pool2.query).toHaveBeenCalledTimes(1);
      expect(mockPool.query).not.toHaveBeenCalled();

      // Clean up the second init
      await closeTelemetryBatcher();
    });
  });
});
