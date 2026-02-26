import { describe, it, expect } from 'vitest';
import { normalizeMessage, normalizeBatch } from '../message-normalizer.js';
import type { NormalizeParams } from '../message-normalizer.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const baseParams: NormalizeParams = {
  protocol: 'http',
  entityId: 'entity-1',
  entityName: 'Sensor-1',
  templateId: 'template-1',
  unsPath: 'digilog/v1/enterprise/sensor-1',
  credentialId: 'cred-1',
  sourceIp: '192.168.1.1',
  messageType: 'POST_TELEMETRY',
  rawPayload: null,
};

describe('normalizeMessage', () => {
  it('should normalize a simple object payload', () => {
    const msg = normalizeMessage({
      ...baseParams,
      rawPayload: { temp: 72, humidity: 45 },
    });

    expect(msg.data).toEqual({ temp: 72, humidity: 45 });
    expect(msg.timestamp).toBeDefined();
  });

  it('should normalize a timestamped payload { ts, values }', () => {
    const msg = normalizeMessage({
      ...baseParams,
      rawPayload: { ts: 1700000000000, values: { temp: 72 } },
    });

    expect(msg.data).toEqual({ temp: 72 });
    expect(msg.timestamp).toBe(new Date(1700000000000).toISOString());
  });

  it('should normalize null payload to empty data', () => {
    const msg = normalizeMessage({ ...baseParams, rawPayload: null });

    expect(msg.data).toEqual({});
  });

  it('should normalize undefined payload to empty data', () => {
    const msg = normalizeMessage({ ...baseParams, rawPayload: undefined });

    expect(msg.data).toEqual({});
  });

  it('should normalize empty array payload to empty data', () => {
    const msg = normalizeMessage({ ...baseParams, rawPayload: [] });

    expect(msg.data).toEqual({});
  });

  it('should normalize batch array by using the first entry', () => {
    const msg = normalizeMessage({
      ...baseParams,
      rawPayload: [{ ts: 1700000000000, values: { a: 1 } }],
    });

    expect(msg.data).toEqual({ a: 1 });
    expect(msg.timestamp).toBe(new Date(1700000000000).toISOString());
  });

  it('should wrap a numeric primitive payload as { value: number }', () => {
    const msg = normalizeMessage({ ...baseParams, rawPayload: 42 });

    expect(msg.data).toEqual({ value: 42 });
  });

  it('should wrap a string primitive payload as { value: string }', () => {
    const msg = normalizeMessage({ ...baseParams, rawPayload: 'hello' });

    expect(msg.data).toEqual({ value: 'hello' });
  });

  it('should set messageId as a valid UUID', () => {
    const msg = normalizeMessage({ ...baseParams });

    expect(msg.messageId).toMatch(UUID_REGEX);
  });

  it('should copy protocol, entityId, and entityName from params', () => {
    const msg = normalizeMessage({ ...baseParams });

    expect(msg.protocol).toBe('http');
    expect(msg.entityId).toBe('entity-1');
    expect(msg.entityName).toBe('Sensor-1');
  });

  it('should use provided traceId when given', () => {
    const msg = normalizeMessage({
      ...baseParams,
      traceId: 'custom-trace-id',
    });

    expect(msg.traceId).toBe('custom-trace-id');
  });

  it('should generate a UUID traceId when not provided', () => {
    const msg = normalizeMessage({ ...baseParams });

    expect(msg.traceId).toMatch(UUID_REGEX);
  });

  it('should default metadata to {} when not provided', () => {
    const msg = normalizeMessage({ ...baseParams });

    expect(msg.metadata).toEqual({});
  });
});

describe('normalizeBatch', () => {
  it('should return a single-element array for non-array payload', () => {
    const msgs = normalizeBatch({
      ...baseParams,
      rawPayload: { temp: 72 },
    });

    expect(msgs).toHaveLength(1);
    expect(msgs[0].data).toEqual({ temp: 72 });
  });

  it('should return one message per batch entry with the same traceId', () => {
    const msgs = normalizeBatch({
      ...baseParams,
      rawPayload: [
        { ts: 1700000000000, values: { a: 1 } },
        { ts: 1700000001000, values: { b: 2 } },
        { ts: 1700000002000, values: { c: 3 } },
      ],
    });

    expect(msgs).toHaveLength(3);
    expect(msgs[0].data).toEqual({ a: 1 });
    expect(msgs[1].data).toEqual({ b: 2 });
    expect(msgs[2].data).toEqual({ c: 3 });

    const traceId = msgs[0].traceId;
    expect(traceId).toMatch(UUID_REGEX);
    expect(msgs[1].traceId).toBe(traceId);
    expect(msgs[2].traceId).toBe(traceId);

    // Each message should have a unique messageId
    const messageIds = new Set(msgs.map((m) => m.messageId));
    expect(messageIds.size).toBe(3);
  });

  it('should return a single message for empty array (fallback)', () => {
    const msgs = normalizeBatch({ ...baseParams, rawPayload: [] });

    expect(msgs).toHaveLength(1);
    expect(msgs[0].data).toEqual({});
  });
});
