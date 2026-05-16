import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────
// Phase 4 (2026-05-01): Redis publish replaced by internal-bus.bus.emit. Tests
// now spy on the bus's emit method via vi.mock instead of mocking ioredis.

const { mockGetConfigOrDefault, mockQuery, mockEmit } = vi.hoisted(() => ({
  mockGetConfigOrDefault: vi.fn(),
  mockQuery: vi.fn(),
  mockEmit: vi.fn(),
}));

vi.mock('../ingestion-config.service.js', () => ({
  getConfigOrDefault: mockGetConfigOrDefault,
}));

vi.mock('@digilog/db', () => ({
  getTsdbPool: () => ({ query: mockQuery }),
}));

vi.mock('../../../lib/internal-bus.js', () => ({
  bus: {
    emit: mockEmit,
    on: vi.fn(() => () => {}),
    off: vi.fn(),
    listenerCount: vi.fn(() => 0),
  },
}));

// Legacy alias kept so existing test assertions still read clearly.
const mockPublish = mockEmit;

// ── Import SUT (after mocks) ──────────────────────────────────────────

import {
  isTraceEnabled,
  createTrace,
  recordStage,
  traceStage,
  finalizeTrace,
  markTraceDLQ,
} from '../pipeline-tracer.js';
import type { PipelineTrace, StageResult } from '../pipeline-tracer.js';

// ── Fixtures ───────────────────────────────────────────────────────────

function makeTrace(overrides?: Partial<PipelineTrace>): PipelineTrace {
  return {
    messageId: 'msg-001',
    entityId: 'entity-001',
    entityName: 'Sensor-A',
    transport: 'MQTT',
    messageType: 'TELEMETRY',
    payloadSize: 128,
    stages: [],
    finalStatus: 'SUCCESS',
    failedStage: null,
    errorCode: null,
    errorMessage: null,
    warnings: [],
    totalDurationMs: 0,
    startTime: Date.now(),
    ...overrides,
  };
}

function makeStageResult(overrides?: Partial<StageResult>): StageResult {
  return {
    stage: 1,
    name: 'VALIDATE',
    status: 'SUCCESS',
    durationMs: 5,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────

describe('pipeline-tracer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createTrace ────────────────────────────────────────────────────

  describe('createTrace', () => {
    // 1. Creates a trace with all provided params
    it('should create a trace with the provided params', () => {
      const trace = createTrace({
        messageId: 'msg-123',
        entityId: 'ent-456',
        entityName: 'Pump-A',
        transport: 'HTTP',
        messageType: 'ATTRIBUTE',
        payloadSize: 256,
      });

      expect(trace.messageId).toBe('msg-123');
      expect(trace.entityId).toBe('ent-456');
      expect(trace.entityName).toBe('Pump-A');
      expect(trace.transport).toBe('HTTP');
      expect(trace.messageType).toBe('ATTRIBUTE');
      expect(trace.payloadSize).toBe(256);
    });

    // 2. Initializes default fields correctly
    it('should initialize stages as empty array and finalStatus as SUCCESS', () => {
      const trace = createTrace({
        messageId: 'msg-001',
        entityId: null,
        entityName: null,
        transport: 'MQTT',
        messageType: 'TELEMETRY',
        payloadSize: 64,
      });

      expect(trace.stages).toEqual([]);
      expect(trace.finalStatus).toBe('SUCCESS');
      expect(trace.failedStage).toBeNull();
      expect(trace.errorCode).toBeNull();
      expect(trace.errorMessage).toBeNull();
      expect(trace.warnings).toEqual([]);
      expect(trace.totalDurationMs).toBe(0);
    });

    // 3. Sets startTime to approximately now
    it('should set startTime close to current time', () => {
      const before = Date.now();
      const trace = createTrace({
        messageId: 'msg-001',
        entityId: null,
        entityName: null,
        transport: 'WS',
        messageType: 'RPC',
        payloadSize: 32,
      });
      const after = Date.now();

      expect(trace.startTime).toBeGreaterThanOrEqual(before);
      expect(trace.startTime).toBeLessThanOrEqual(after);
    });

    // 4. Supports null entityId and entityName
    it('should accept null entityId and entityName', () => {
      const trace = createTrace({
        messageId: 'msg-001',
        entityId: null,
        entityName: null,
        transport: 'MQTT',
        messageType: 'TELEMETRY',
        payloadSize: 0,
      });

      expect(trace.entityId).toBeNull();
      expect(trace.entityName).toBeNull();
    });
  });

  // ── recordStage ────────────────────────────────────────────────────

  describe('recordStage', () => {
    // 5. Pushes a stage result onto trace.stages
    it('should push a stage result into the trace stages array', () => {
      const trace = makeTrace();
      const result = makeStageResult({ stage: 3, name: 'NORMALIZE' });

      recordStage(trace, result);

      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0]).toBe(result);
      expect(trace.stages[0].stage).toBe(3);
      expect(trace.stages[0].name).toBe('NORMALIZE');
    });

    // 6. Appends multiple stages in order
    it('should append multiple stages in order', () => {
      const trace = makeTrace();

      recordStage(trace, makeStageResult({ stage: 1, name: 'S1' }));
      recordStage(trace, makeStageResult({ stage: 2, name: 'S2' }));
      recordStage(trace, makeStageResult({ stage: 3, name: 'S3' }));

      expect(trace.stages).toHaveLength(3);
      expect(trace.stages.map((s) => s.name)).toEqual(['S1', 'S2', 'S3']);
    });

    // 7. Appends stage warnings to trace.warnings
    it('should append stage warnings to trace-level warnings', () => {
      const trace = makeTrace();
      const result = makeStageResult({
        warnings: ['low battery', 'high latency'],
      });

      recordStage(trace, result);

      expect(trace.warnings).toEqual(['low battery', 'high latency']);
    });

    // 8. Does not modify warnings if stage has no warnings
    it('should not modify trace warnings when stage has no warnings', () => {
      const trace = makeTrace();
      const result = makeStageResult(); // no warnings field

      recordStage(trace, result);

      expect(trace.warnings).toEqual([]);
    });

    // 9. Accumulates warnings from multiple stages
    it('should accumulate warnings from multiple stages', () => {
      const trace = makeTrace();

      recordStage(trace, makeStageResult({ warnings: ['w1'] }));
      recordStage(trace, makeStageResult({ warnings: ['w2', 'w3'] }));

      expect(trace.warnings).toEqual(['w1', 'w2', 'w3']);
    });
  });

  // ── markTraceDLQ ───────────────────────────────────────────────────

  describe('markTraceDLQ', () => {
    // 10. Sets finalStatus to DLQ
    it('should set finalStatus to DLQ', () => {
      const trace = makeTrace({ finalStatus: 'SUCCESS' });

      markTraceDLQ(trace);

      expect(trace.finalStatus).toBe('DLQ');
    });

    // 11. Overrides any previous finalStatus
    it('should override a FAILED finalStatus to DLQ', () => {
      const trace = makeTrace({ finalStatus: 'FAILED' });

      markTraceDLQ(trace);

      expect(trace.finalStatus).toBe('DLQ');
    });
  });

  // ── traceStage ─────────────────────────────────────────────────────

  describe('traceStage', () => {
    // 12. Records SUCCESS when fn resolves
    it('should record a SUCCESS stage when fn resolves', async () => {
      const trace = makeTrace();
      const fn = vi.fn().mockResolvedValue({ parsed: true });

      const { result } = await traceStage(trace, 6, 'NORMALIZE', fn);

      expect(result).toEqual({ parsed: true });
      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].stage).toBe(6);
      expect(trace.stages[0].name).toBe('NORMALIZE');
      expect(trace.stages[0].status).toBe('SUCCESS');
      expect(trace.stages[0].durationMs).toBeGreaterThanOrEqual(0);
    });

    // 13. Records FAILED when fn throws and re-throws the error
    it('should record a FAILED stage and re-throw when fn rejects', async () => {
      const trace = makeTrace();
      const error = new Error('Schema mismatch');
      const fn = vi.fn().mockRejectedValue(error);

      await expect(traceStage(trace, 9, 'PERSIST', fn)).rejects.toThrow('Schema mismatch');

      expect(trace.stages).toHaveLength(1);
      expect(trace.stages[0].status).toBe('FAILED');
      expect(trace.stages[0].name).toBe('PERSIST');
      expect(trace.stages[0].errorCode).toBe('ERR_STAGE_FAILED');
      expect(trace.failedStage).toBe('PERSIST');
      expect(trace.errorCode).toBe('ERR_STAGE_FAILED');
      expect(trace.errorMessage).toBe('Schema mismatch');
    });

    // 14. Uses error.code if present on the thrown error
    it('should use error.code from thrown error when available', async () => {
      const trace = makeTrace();
      const error = Object.assign(new Error('timeout'), { code: 'ETIMEOUT' });
      const fn = vi.fn().mockRejectedValue(error);

      await expect(traceStage(trace, 3, 'RESOLVE', fn)).rejects.toThrow('timeout');

      expect(trace.stages[0].errorCode).toBe('ETIMEOUT');
      expect(trace.errorCode).toBe('ETIMEOUT');
    });

    // 15. Runs fn without recording when trace is null
    it('should execute fn and return result when trace is null', async () => {
      const fn = vi.fn().mockResolvedValue(42);

      const { result, warnings } = await traceStage(null, 1, 'VALIDATE', fn);

      expect(result).toBe(42);
      expect(warnings).toEqual([]);
      expect(fn).toHaveBeenCalledOnce();
    });

    // 16. Does not catch errors when trace is null (fn still throws)
    it('should propagate errors from fn when trace is null', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      await expect(traceStage(null, 1, 'VALIDATE', fn)).rejects.toThrow('fail');
    });

    // 17. Handles non-Error thrown values
    it('should handle non-Error thrown values with String() fallback', async () => {
      const trace = makeTrace();
      const fn = vi.fn().mockRejectedValue('string-error');

      await expect(traceStage(trace, 1, 'VALIDATE', fn)).rejects.toBe('string-error');

      expect(trace.errorMessage).toBe('string-error');
      expect(trace.errorCode).toBe('ERR_STAGE_FAILED');
    });
  });

  // ── isTraceEnabled ─────────────────────────────────────────────────

  describe('isTraceEnabled', () => {
    // 18. Returns true when global trace flag is enabled
    it('should return true when global trace is enabled', async () => {
      mockGetConfigOrDefault.mockResolvedValue(true);

      const result = await isTraceEnabled();

      expect(result).toBe(true);
      expect(mockGetConfigOrDefault).toHaveBeenCalledWith('pipeline.trace_enabled', false);
    });

    // 19. Returns false when all flags are disabled
    it('should return false when all trace flags are disabled', async () => {
      mockGetConfigOrDefault.mockResolvedValue(false);

      const result = await isTraceEnabled();

      expect(result).toBe(false);
    });

    // 20. Returns true when entity-level trace is enabled
    it('should return true when entity-level trace is enabled', async () => {
      mockGetConfigOrDefault
        .mockResolvedValueOnce(false) // global
        .mockResolvedValueOnce(true); // entity

      const result = await isTraceEnabled('entity-001');

      expect(result).toBe(true);
      expect(mockGetConfigOrDefault).toHaveBeenCalledWith('pipeline.trace_entity.entity-001', false);
    });

    // 21. Returns true when template-level trace is enabled
    it('should return true when template-level trace is enabled', async () => {
      mockGetConfigOrDefault
        .mockResolvedValueOnce(false) // global
        .mockResolvedValueOnce(false) // entity
        .mockResolvedValueOnce(true); // template

      const result = await isTraceEnabled('entity-001', 'tmpl-001');

      expect(result).toBe(true);
      expect(mockGetConfigOrDefault).toHaveBeenCalledWith('pipeline.trace_template.tmpl-001', false);
    });

    // 22. Does not check entity/template when global is already true
    it('should short-circuit and not check entity/template when global is true', async () => {
      mockGetConfigOrDefault.mockResolvedValueOnce(true); // global = true

      const result = await isTraceEnabled('entity-001', 'tmpl-001');

      expect(result).toBe(true);
      // Only one call — the global check; no entity or template checks
      expect(mockGetConfigOrDefault).toHaveBeenCalledTimes(1);
    });
  });

  // ── finalizeTrace ──────────────────────────────────────────────────

  describe('finalizeTrace', () => {
    // 23. Sets finalStatus to SUCCESS when all stages succeeded and no warnings
    it('should finalize as SUCCESS when all stages passed with no warnings', async () => {
      mockQuery.mockResolvedValue({});
      mockPublish.mockResolvedValue(1);

      const trace = makeTrace();
      recordStage(trace, makeStageResult({ stage: 1, name: 'VALIDATE', status: 'SUCCESS' }));
      recordStage(trace, makeStageResult({ stage: 3, name: 'RESOLVE', status: 'SUCCESS' }));

      await finalizeTrace(trace);

      expect(trace.finalStatus).toBe('SUCCESS');
      expect(trace.totalDurationMs).toBeGreaterThanOrEqual(0);
    });

    // 24. Sets finalStatus to FAILED when any stage failed
    it('should finalize as FAILED when a stage has FAILED status', async () => {
      mockQuery.mockResolvedValue({});
      mockPublish.mockResolvedValue(1);

      const trace = makeTrace();
      recordStage(trace, makeStageResult({ stage: 1, status: 'SUCCESS' }));
      recordStage(trace, makeStageResult({ stage: 6, status: 'FAILED', errorCode: 'ERR_PARSE' }));

      await finalizeTrace(trace);

      expect(trace.finalStatus).toBe('FAILED');
    });

    // 25. Sets finalStatus to SUCCESS_WITH_WARNINGS when warnings exist but no failures
    it('should finalize as SUCCESS_WITH_WARNINGS when warnings present but no failures', async () => {
      mockQuery.mockResolvedValue({});
      mockPublish.mockResolvedValue(1);

      const trace = makeTrace();
      recordStage(trace, makeStageResult({ stage: 1, status: 'SUCCESS', warnings: ['drift detected'] }));

      await finalizeTrace(trace);

      expect(trace.finalStatus).toBe('SUCCESS_WITH_WARNINGS');
    });

    // 26. Writes trace data to TSDB via pool.query
    it('should write trace to TSDB with correct parameters', async () => {
      mockQuery.mockResolvedValue({});
      mockPublish.mockResolvedValue(1);

      const trace = makeTrace({ messageId: 'msg-write' });
      recordStage(trace, makeStageResult({ stage: 1, status: 'SUCCESS' }));

      await finalizeTrace(trace);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(sql).toContain('INSERT INTO ts_pipeline_traces');
      expect(params[1]).toBe('msg-write'); // message_id
      expect(params[2]).toBe('entity-001'); // entity_id
      expect(params[8]).toBe('SUCCESS'); // final_status
    });

    // 27. Publishes trace to Redis when entityId is present
    it('should publish trace to Redis channel ws:trace:{entityId}', async () => {
      mockQuery.mockResolvedValue({});
      mockPublish.mockResolvedValue(1);

      const trace = makeTrace({ entityId: 'ent-pub' });
      recordStage(trace, makeStageResult({ stage: 1, status: 'SUCCESS' }));

      await finalizeTrace(trace);

      expect(mockPublish).toHaveBeenCalledTimes(1);
      // Phase 4: bus.emit takes the payload as a JS object, not a JSON string.
      expect(mockPublish).toHaveBeenCalledWith(
        'ws:trace:ent-pub',
        expect.any(Object),
      );

      const published = mockPublish.mock.calls[0][1] as any;
      expect(published.entityId).toBe('ent-pub');
      expect(published.finalStatus).toBe('SUCCESS');
    });

    // 28. Does not publish to Redis when entityId is null
    it('should not publish to Redis when entityId is null', async () => {
      mockQuery.mockResolvedValue({});

      const trace = makeTrace({ entityId: null });
      recordStage(trace, makeStageResult({ stage: 1, status: 'SUCCESS' }));

      await finalizeTrace(trace);

      expect(mockPublish).not.toHaveBeenCalled();
    });

    // 29. Continues without throwing when TSDB write fails
    it('should not throw when TSDB write fails', async () => {
      mockQuery.mockRejectedValue(new Error('connection refused'));
      mockPublish.mockResolvedValue(1);

      const trace = makeTrace();
      recordStage(trace, makeStageResult({ stage: 1, status: 'SUCCESS' }));

      // Should not throw — trace write failure is non-critical
      await expect(finalizeTrace(trace)).resolves.toBeUndefined();
    });

    // 30. Passes null for warnings param when trace has no warnings
    it('should pass null for warnings when trace has no warnings', async () => {
      mockQuery.mockResolvedValue({});
      mockPublish.mockResolvedValue(1);

      const trace = makeTrace();
      recordStage(trace, makeStageResult({ stage: 1, status: 'SUCCESS' }));

      await finalizeTrace(trace);

      const params = mockQuery.mock.calls[0][1];
      // warnings param is index 12
      expect(params[12]).toBeNull();
    });
  });

});
