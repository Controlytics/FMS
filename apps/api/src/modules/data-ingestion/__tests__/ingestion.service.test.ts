import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Hoisted mocks ──────────────────────────────────────────────────────

const {
  mockDeviceCredentialFindUnique,
  mockAssetTemplateFindUnique,
  mockAlarmUpdateMany,
  mockAuditTrailCreate,
  mockAssetInstanceFindUnique,
  mockComputeChecksum,
  mockGetConfigOrDefault,
  mockMarkOnline,
  mockExecuteRuleChain,
  mockSaveTelemetry,
  mockSaveAttributes,
  mockSaveChecklist,
  mockCreateAlarm,
  mockSaveBinary,
  mockIsTraceEnabled,
  mockCreateTrace,
  mockRecordStage,
  mockFinalizeTrace,
  mockMarkTraceDLQ,
  mockAddToDLQ,
  mockFlushAll,
  mockAddDeviceEventRow,
  mockPublish,
  mockQuit,
  mockGetProducer,
  mockAddJob,
} = vi.hoisted(() => ({
  mockDeviceCredentialFindUnique: vi.fn(),
  mockAssetTemplateFindUnique: vi.fn(),
  mockAlarmUpdateMany: vi.fn(),
  mockAuditTrailCreate: vi.fn(),
  mockAssetInstanceFindUnique: vi.fn(),
  mockComputeChecksum: vi.fn(),
  mockGetConfigOrDefault: vi.fn(),
  mockMarkOnline: vi.fn(),
  mockExecuteRuleChain: vi.fn(),
  mockSaveTelemetry: vi.fn(),
  mockSaveAttributes: vi.fn(),
  mockSaveChecklist: vi.fn(),
  mockCreateAlarm: vi.fn(),
  mockSaveBinary: vi.fn(),
  mockIsTraceEnabled: vi.fn(),
  mockCreateTrace: vi.fn(),
  mockRecordStage: vi.fn(),
  mockFinalizeTrace: vi.fn(),
  mockMarkTraceDLQ: vi.fn(),
  mockAddToDLQ: vi.fn(),
  mockFlushAll: vi.fn(),
  mockAddDeviceEventRow: vi.fn(),
  mockPublish: vi.fn(),
  mockQuit: vi.fn(),
  mockGetProducer: vi.fn(),
  mockAddJob: vi.fn(),
}));

// ── vi.mock declarations ───────────────────────────────────────────────

vi.mock('../../../lib/prisma.js', () => ({
  prisma: {
    deviceCredential: {
      findUnique: mockDeviceCredentialFindUnique,
    },
    assetTemplate: {
      findUnique: mockAssetTemplateFindUnique,
    },
    alarm: {
      updateMany: mockAlarmUpdateMany,
    },
    auditTrail: {
      create: mockAuditTrailCreate,
    },
    assetInstance: {
      findUnique: mockAssetInstanceFindUnique,
    },
  },
}));

vi.mock('../../../lib/hash-chain.js', () => ({
  computeChecksum: mockComputeChecksum,
}));

vi.mock('../ingestion-config.service.js', () => ({
  getConfigOrDefault: mockGetConfigOrDefault,
}));

vi.mock('../connectivity-tracker.js', () => ({
  markOnline: mockMarkOnline,
}));

vi.mock('../../rule-chain/rule-engine.js', () => ({
  executeRuleChain: mockExecuteRuleChain,
}));

vi.mock('../ingestion.repository.js', () => ({
  saveTelemetry: mockSaveTelemetry,
  saveAttributes: mockSaveAttributes,
  saveChecklist: mockSaveChecklist,
  createAlarm: mockCreateAlarm,
  saveBinary: mockSaveBinary,
}));

vi.mock('../pipeline-tracer.js', () => ({
  isTraceEnabled: mockIsTraceEnabled,
  createTrace: mockCreateTrace,
  recordStage: mockRecordStage,
  finalizeTrace: mockFinalizeTrace,
  markTraceDLQ: mockMarkTraceDLQ,
}));

vi.mock('../dlq-manager.js', () => ({
  addToDLQ: mockAddToDLQ,
}));

vi.mock('@digilog/db', () => ({
  flushAll: mockFlushAll,
  addDeviceEventRow: mockAddDeviceEventRow,
}));

vi.mock('ioredis', () => ({
  default: class MockRedis {
    publish = mockPublish;
    quit = mockQuit;
  },
}));

vi.mock('@digilog/queue', () => ({
  getProducer: mockGetProducer,
  QUEUES: {
    NOTIFICATION: {
      name: 'notification',
      defaultJobOptions: { attempts: 3, removeOnComplete: true, removeOnFail: false },
    },
    INGESTION: {
      name: 'ingestion',
      defaultJobOptions: { attempts: 3, removeOnComplete: true, removeOnFail: false },
    },
  },
  JOB_PRIORITY: {
    ALARM_PROCESSING: 2,
    TELEMETRY: 5,
  },
}));

// ── Import SUT (after mocks) ──────────────────────────────────────────

import { processIngestionMessage } from '../ingestion.service.js';

// ── Fixtures ──────────────────────────────────────────────────────────

function makeMessage(overrides?: Record<string, unknown>) {
  return {
    messageId: 'msg-001',
    timestamp: new Date().toISOString(),
    protocol: 'mqtt' as const,
    entityId: 'entity-001',
    entityName: 'Sensor-A',
    templateId: 'tmpl-001',
    unsPath: 'digilog/v1/sensors/temp',
    credentialId: 'cred-001',
    sourceIp: '192.168.1.10',
    messageType: 'POST_TELEMETRY',
    data: { temperature: 25.5 },
    metadata: {} as Record<string, string>,
    ruleChainId: '',
    traceId: '',
    ...overrides,
  };
}

function defaultRuleEngineResult() {
  return {
    success: true,
    message: {},
    metadata: {},
    alarms: [],
    notifications: [],
    errors: [],
    nodesExecuted: 0,
    durationMs: 0,
  };
}

// ── Setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default sensible returns
  mockIsTraceEnabled.mockResolvedValue(false);
  mockGetConfigOrDefault.mockImplementation(async (key: string, defaultValue: unknown) => defaultValue);
  mockExecuteRuleChain.mockResolvedValue(defaultRuleEngineResult());
  mockSaveTelemetry.mockResolvedValue({ keysWritten: 1 });
  mockSaveAttributes.mockResolvedValue({ keysWritten: 1 });
  mockSaveChecklist.mockResolvedValue({ checklistId: 'chk-001' });
  mockCreateAlarm.mockResolvedValue({ alarmId: 'alarm-001' });
  mockSaveBinary.mockResolvedValue({ filePath: '/tmp/file' });
  mockFlushAll.mockResolvedValue(undefined);
  mockComputeChecksum.mockReturnValue('test-checksum');
  mockAuditTrailCreate.mockResolvedValue({ id: 'audit-001' });
  mockPublish.mockResolvedValue(1);
  mockAddJob.mockResolvedValue({ id: 'job-001' });
  mockGetProducer.mockResolvedValue({ addJob: mockAddJob, release: vi.fn() });
  mockMarkOnline.mockResolvedValue(undefined);
  mockAddToDLQ.mockResolvedValue(undefined);
  mockFinalizeTrace.mockResolvedValue(undefined);
  mockDeviceCredentialFindUnique.mockResolvedValue(null);
  mockAssetTemplateFindUnique.mockResolvedValue(null);
});

// ── Tests ─────────────────────────────────────────────────────────────

describe('processIngestionMessage', () => {
  // ── Stage 3: Device Validation ──────────────────────────────────────

  describe('Stage 3 — Device Validation', () => {
    it('skips validation for POST_CHECKLIST messages', async () => {
      const msg = makeMessage({
        messageType: 'POST_CHECKLIST',
        credentialId: 'cred-001',
        data: { question1: 'yes' },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      // Should NOT query deviceCredential at all for checklist
      expect(mockDeviceCredentialFindUnique).not.toHaveBeenCalled();
    });

    it('skips validation when credentialId is empty', async () => {
      const msg = makeMessage({ credentialId: '' });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockDeviceCredentialFindUnique).not.toHaveBeenCalled();
    });

    it('passes IP allowlist check when sourceIp matches', async () => {
      // Enable IP validation
      mockGetConfigOrDefault.mockImplementation(async (key: string, defaultValue: unknown) => {
        if (key === 'device.ip_validation_enabled') return true;
        return defaultValue;
      });

      // Credential has the sourceIp in allowedIps
      mockDeviceCredentialFindUnique.mockResolvedValue({
        allowedIps: ['192.168.1.10', '10.0.0.1'],
        maxDataRatePerMin: 600,
      });

      const msg = makeMessage({ sourceIp: '192.168.1.10' });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockAddToDLQ).not.toHaveBeenCalled();
    });

    it('fails with ERR_IP_MISMATCH when sourceIp not in allowlist → DLQ', async () => {
      mockGetConfigOrDefault.mockImplementation(async (key: string, defaultValue: unknown) => {
        if (key === 'device.ip_validation_enabled') return true;
        if (key === 'device.rate_limit_enabled') return false;
        return defaultValue;
      });

      mockDeviceCredentialFindUnique.mockResolvedValue({
        allowedIps: ['10.0.0.1', '10.0.0.2'],
      });

      const msg = makeMessage({ sourceIp: '192.168.1.99' });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(false);
      expect(mockAddToDLQ).toHaveBeenCalledOnce();
      expect(mockAddToDLQ).toHaveBeenCalledWith(
        msg,
        expect.stringContaining('not in allowlist'),
        expect.anything(),
      );
    });

    it('passes rate limit when under limit', async () => {
      // IP validation off, rate limiting on (default)
      mockGetConfigOrDefault.mockImplementation(async (key: string, defaultValue: unknown) => {
        if (key === 'device.ip_validation_enabled') return false;
        if (key === 'device.rate_limit_enabled') return true;
        return defaultValue;
      });

      mockDeviceCredentialFindUnique.mockResolvedValue({
        maxDataRatePerMin: 600,
      });

      const msg = makeMessage();

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockAddToDLQ).not.toHaveBeenCalled();
    });

    it('fails with ERR_RATE_LIMITED when over limit → DLQ', async () => {
      mockGetConfigOrDefault.mockImplementation(async (key: string, defaultValue: unknown) => {
        if (key === 'device.ip_validation_enabled') return false;
        if (key === 'device.rate_limit_enabled') return true;
        return defaultValue;
      });

      // Credential with very low rate limit
      mockDeviceCredentialFindUnique.mockResolvedValue({
        maxDataRatePerMin: 1,
      });

      const msg = makeMessage({ credentialId: 'cred-rate-test' });

      // First call — creates bucket with count=1 (passes since 1 is not > 1)
      const result1 = await processIngestionMessage(msg);
      expect(result1.success).toBe(true);

      // Second call — count=2 which is > maxRate of 1
      const result2 = await processIngestionMessage(msg);

      expect(result2.success).toBe(false);
      expect(mockAddToDLQ).toHaveBeenCalledOnce();
      expect(mockAddToDLQ).toHaveBeenCalledWith(
        msg,
        expect.stringContaining('Rate limit exceeded'),
        expect.anything(),
      );
    });
  });

  // ── Stage 6: Schema Validation ──────────────────────────────────────

  describe('Stage 6 — Schema Validation', () => {
    it('skips validation for DEVICE_EVENT messages', async () => {
      const msg = makeMessage({
        messageType: 'DEVICE_EVENT',
        credentialId: '',
        data: { event: 'REBOOT' },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      // Should NOT query assetTemplate for device events
      expect(mockAssetTemplateFindUnique).not.toHaveBeenCalled();
    });

    it('skips validation for POST_BINARY messages', async () => {
      const msg = makeMessage({
        messageType: 'POST_BINARY',
        credentialId: '',
        data: { filename: 'test.bin', data: 'base64data' },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockAssetTemplateFindUnique).not.toHaveBeenCalled();
    });

    it('fails with ERR_TYPE_MISMATCH when string given for numeric field → DLQ', async () => {
      mockAssetTemplateFindUnique.mockResolvedValue({
        telemetrySchema: [
          { key: 'temperature', dataType: 'FLOAT' },
        ],
      });

      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_TELEMETRY',
        data: { temperature: 'not-a-number' },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(false);
      expect(mockAddToDLQ).toHaveBeenCalledOnce();
      expect(mockAddToDLQ).toHaveBeenCalledWith(
        msg,
        expect.stringContaining('expected numeric'),
        expect.anything(),
      );
    });

    it('fails with ERR_RANGE_VIOLATION when value below min → DLQ', async () => {
      mockAssetTemplateFindUnique.mockResolvedValue({
        telemetrySchema: [
          { key: 'pressure', dataType: 'FLOAT', min: 0, max: 100 },
        ],
      });

      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_TELEMETRY',
        data: { pressure: -5 },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(false);
      expect(mockAddToDLQ).toHaveBeenCalledOnce();
      expect(mockAddToDLQ).toHaveBeenCalledWith(
        msg,
        expect.stringContaining('below minimum'),
        expect.anything(),
      );
    });

    it('fails with ERR_RANGE_VIOLATION when value above max → DLQ', async () => {
      mockAssetTemplateFindUnique.mockResolvedValue({
        telemetrySchema: [
          { key: 'pressure', dataType: 'FLOAT', min: 0, max: 100 },
        ],
      });

      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_TELEMETRY',
        data: { pressure: 150 },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(false);
      expect(mockAddToDLQ).toHaveBeenCalledOnce();
      expect(mockAddToDLQ).toHaveBeenCalledWith(
        msg,
        expect.stringContaining('above maximum'),
        expect.anything(),
      );
    });

    it('corrects timestamp beyond drift and adds warning', async () => {
      mockAssetTemplateFindUnique.mockResolvedValue({
        telemetrySchema: [
          { key: 'temperature', dataType: 'FLOAT' },
        ],
      });

      // getConfigOrDefault: IP validation off, rate limit off, drift = 24h
      mockGetConfigOrDefault.mockImplementation(async (key: string, defaultValue: unknown) => {
        if (key === 'device.ip_validation_enabled') return false;
        if (key === 'device.rate_limit_enabled') return false;
        if (key === 'pipeline.timestamp_max_drift_hours') return 24;
        return defaultValue;
      });

      // Timestamp 48 hours in the past — beyond 24h drift
      const oldTimestamp = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_TELEMETRY',
        timestamp: oldTimestamp,
        data: { temperature: 22.0 },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(result.warnings).toContain('WARN_TIMESTAMP_CORRECTED');
      // The timestamp should have been replaced with a server timestamp (not the old one)
      expect(msg.timestamp).not.toBe(oldTimestamp);
    });
  });

  // ── Stage 7: Rule Chain ─────────────────────────────────────────────

  describe('Stage 7 — Rule Chain', () => {
    it('executes rule chain and collects alarms', async () => {
      mockExecuteRuleChain.mockResolvedValue({
        success: true,
        message: { temperature: 30 },
        metadata: {},
        alarms: [
          {
            entityId: 'entity-001',
            alarmType: 'HIGH_TEMP',
            severity: 'WARNING',
            details: { threshold: 28 },
          },
        ],
        notifications: [],
        errors: [],
        nodesExecuted: 3,
        durationMs: 12,
      });

      mockCreateAlarm.mockResolvedValue({ alarmId: 'alarm-from-rule' });

      const msg = makeMessage({
        credentialId: '',
        ruleChainId: 'chain-001',
        data: { temperature: 30 },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockExecuteRuleChain).toHaveBeenCalledOnce();
      expect(mockExecuteRuleChain).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 30, _messageType: 'POST_TELEMETRY' }),
        expect.any(Object),
        'chain-001',
        expect.objectContaining({ entityId: 'entity-001' }),
      );
      // Stage 8 should process the alarm from rule chain
      expect(mockCreateAlarm).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 'entity-001',
          alarmType: 'HIGH_TEMP',
          severity: 'WARNING',
        }),
      );
    });

    it('adds warning on rule chain error and continues (fail-safe)', async () => {
      mockExecuteRuleChain.mockRejectedValue(new Error('Rule evaluation failed'));

      const msg = makeMessage({
        credentialId: '',
        ruleChainId: 'chain-broken',
        data: { temperature: 25 },
      });

      const result = await processIngestionMessage(msg);

      // Pipeline should still succeed — rule chain errors are non-fatal
      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('WARN_RULE_CHAIN_FAILED'),
        ]),
      );
    });

    it('skips rule chain when no ruleChainId', async () => {
      const msg = makeMessage({
        credentialId: '',
        ruleChainId: '',
        data: { temperature: 25 },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockExecuteRuleChain).not.toHaveBeenCalled();
    });
  });

  // ── Stage 9: Data Persistence ───────────────────────────────────────

  describe('Stage 9 — Data Persistence', () => {
    it('calls saveTelemetry for POST_TELEMETRY', async () => {
      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_TELEMETRY',
        data: { temperature: 25.5 },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockSaveTelemetry).toHaveBeenCalledOnce();
      expect(mockSaveTelemetry).toHaveBeenCalledWith(msg);
      expect(mockFlushAll).toHaveBeenCalledOnce();
    });

    it('calls saveAttributes for POST_ATTRIBUTES', async () => {
      mockAssetTemplateFindUnique.mockResolvedValue({
        attributeSchema: [
          { key: 'firmware', dataType: 'STRING' },
        ],
      });

      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_ATTRIBUTES',
        data: { firmware: 'v2.1.0' },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockSaveAttributes).toHaveBeenCalledOnce();
      expect(mockSaveAttributes).toHaveBeenCalledWith(msg);
      expect(mockFlushAll).toHaveBeenCalledOnce();
    });

    it('calls saveChecklist for POST_CHECKLIST', async () => {
      const msg = makeMessage({
        messageType: 'POST_CHECKLIST',
        credentialId: '',
        data: { question1: 'yes', question2: 'no' },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockSaveChecklist).toHaveBeenCalledOnce();
      expect(mockSaveChecklist).toHaveBeenCalledWith(msg);
      expect(mockFlushAll).toHaveBeenCalledOnce();
    });
  });

  // ── Stage 10: Audit Trail ───────────────────────────────────────────

  describe('Stage 10 — Audit Trail', () => {
    it('creates audit trail entry with DATA_ATTRIBUTES_UPDATED for POST_ATTRIBUTES', async () => {
      mockAssetTemplateFindUnique.mockResolvedValue({
        attributeSchema: [
          { key: 'firmware', dataType: 'STRING' },
        ],
      });

      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_ATTRIBUTES',
        data: { firmware: 'v2.1.0' },
        metadata: { userId: 'user-001', userName: 'John Doe', userRole: 'ADMIN', sessionId: 'sess-001' },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockComputeChecksum).toHaveBeenCalledOnce();
      expect(mockAuditTrailCreate).toHaveBeenCalledOnce();
      expect(mockAuditTrailCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'DATA_ATTRIBUTES_UPDATED',
          targetType: 'ENTITY',
          targetId: 'entity-001',
          userId: 'user-001',
          userName: 'John Doe',
          checksum: 'test-checksum',
        }),
      });
    });

    it('does NOT create audit trail for POST_TELEMETRY', async () => {
      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_TELEMETRY',
        data: { temperature: 25.5 },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(true);
      expect(mockAuditTrailCreate).not.toHaveBeenCalled();
      expect(mockComputeChecksum).not.toHaveBeenCalled();
    });
  });

  // ── Stage 11: Event Emission ────────────────────────────────────────

  describe('Stage 11 — Event Emission', () => {
    it('adds warning but returns success:true when emission fails', async () => {
      // Make Redis publish throw
      mockPublish.mockRejectedValue(new Error('Redis connection lost'));

      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_TELEMETRY',
        data: { temperature: 25.5 },
      });

      const result = await processIngestionMessage(msg);

      // Pipeline should still succeed — emit failures are warnings
      expect(result.success).toBe(true);
      expect(result.warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('WARN_EMIT'),
        ]),
      );
      // Should NOT route to DLQ
      expect(mockAddToDLQ).not.toHaveBeenCalled();
    });
  });

  // ── DLQ: Pipeline failure routing ───────────────────────────────────

  describe('DLQ — Pipeline failure routing', () => {
    it('routes to DLQ and returns success:false on critical stage failure', async () => {
      // Make stage 9 (persistence) fail
      mockSaveTelemetry.mockRejectedValue(new Error('Database write failed'));

      const msg = makeMessage({
        credentialId: '',
        messageType: 'POST_TELEMETRY',
        data: { temperature: 25.5 },
      });

      const result = await processIngestionMessage(msg);

      expect(result.success).toBe(false);
      expect(result.messageId).toBe('msg-001');
      expect(mockAddToDLQ).toHaveBeenCalledOnce();
      expect(mockAddToDLQ).toHaveBeenCalledWith(
        msg,
        'Database write failed',
        expect.anything(),
      );
    });
  });
});
