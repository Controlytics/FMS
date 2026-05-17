/**
 * Message Normalizer — Transforms all protocols into a unified IngestionMessage envelope.
 * Supports three payload formats:
 *   1. Simple: { key: value, ... }
 *   2. Timestamped: { ts: number, values: { key: value, ... } }
 *   3. Batch: [{ ts: number, values: { key: value, ... } }, ...]
 */

import { randomUUID } from 'node:crypto';

export interface IngestionMessage {
  messageId: string;
  timestamp: string;
  protocol: 'mqtt' | 'http' | 'websocket' | 'internal';
  entityId: string;
  entityName: string;
  templateId: string;
  unsPath: string;
  credentialId: string;
  sourceIp: string;
  messageType: string;
  data: Record<string, unknown>;
  metadata: Record<string, string>;
  traceId: string;
}

export type MessageType =
  | 'POST_TELEMETRY'
  | 'POST_ATTRIBUTES'
  | 'POST_CHECKLIST'
  | 'POST_BINARY'
  | 'DEVICE_EVENT'
  | 'RPC_REQUEST'
  | 'RPC_RESPONSE'
  | 'CONNECTIVITY_EVENT';

export interface NormalizeParams {
  protocol: 'mqtt' | 'http' | 'websocket' | 'internal';
  entityId: string;
  entityName: string;
  templateId: string;
  unsPath: string;
  credentialId: string;
  sourceIp: string;
  messageType: MessageType;
  rawPayload: unknown;
  traceId?: string;
  metadata?: Record<string, string>;
}

/**
 * Detect payload format and normalize to { data, timestamp }.
 * - Simple: { key: value } → { data: payload, timestamp: now }
 * - Timestamped: { ts: number, values: {...} } → { data: values, timestamp: ts }
 * - Batch: [{ts, values}, ...] → flattened into first entry (batch handled at enqueue level)
 */
function normalizePayload(rawPayload: unknown): { data: Record<string, unknown>; timestamp: string } {
  const now = new Date().toISOString();

  if (rawPayload === null || rawPayload === undefined) {
    return { data: {}, timestamp: now };
  }

  // Batch format: array of { ts, values }
  if (Array.isArray(rawPayload)) {
    if (rawPayload.length === 0) {
      return { data: {}, timestamp: now };
    }
    // Use the first batch entry; additional entries will be handled by the caller
    const first = rawPayload[0] as Record<string, unknown>;
    const ts = first.ts;
    const values = (first.values as Record<string, unknown>) ?? {};
    return {
      data: values,
      timestamp: typeof ts === 'number' ? new Date(ts).toISOString() : now,
    };
  }

  if (typeof rawPayload === 'object') {
    const obj = rawPayload as Record<string, unknown>;

    // Timestamped format: { ts: number, values: {...} }
    if ('ts' in obj && 'values' in obj) {
      const ts = obj.ts;
      const values = (obj.values as Record<string, unknown>) ?? {};
      return {
        data: values,
        timestamp: typeof ts === 'number' ? new Date(ts).toISOString() : now,
      };
    }

    // Simple format: { key: value }
    return { data: obj, timestamp: now };
  }

  // Fallback: wrap primitive as { value: ... }
  return { data: { value: rawPayload }, timestamp: now };
}

/**
 * Create a normalized IngestionMessage from any protocol source.
 */
export function normalizeMessage(params: NormalizeParams): IngestionMessage {
  const { data, timestamp } = normalizePayload(params.rawPayload);

  return {
    messageId: randomUUID(),
    timestamp,
    protocol: params.protocol,
    entityId: params.entityId,
    entityName: params.entityName,
    templateId: params.templateId,
    unsPath: params.unsPath,
    credentialId: params.credentialId,
    sourceIp: params.sourceIp,
    messageType: params.messageType,
    data,
    metadata: params.metadata ?? {},
    traceId: params.traceId ?? randomUUID(),
  };
}

/**
 * Normalize a batch payload into multiple IngestionMessages.
 * For batch format [{ ts, values }, ...], creates one message per entry.
 * For non-batch payloads, returns a single-element array.
 */
export function normalizeBatch(params: NormalizeParams): IngestionMessage[] {
  const traceId = params.traceId ?? randomUUID();

  if (!Array.isArray(params.rawPayload) || params.rawPayload.length === 0) {
    return [normalizeMessage({ ...params, traceId })];
  }

  return (params.rawPayload as Array<Record<string, unknown>>).map((entry) => {
    const ts = entry.ts;
    const values = (entry.values as Record<string, unknown>) ?? entry;
    const timestamp = typeof ts === 'number' ? new Date(ts).toISOString() : new Date().toISOString();

    return {
      messageId: randomUUID(),
      timestamp,
      protocol: params.protocol,
      entityId: params.entityId,
      entityName: params.entityName,
      templateId: params.templateId,
      unsPath: params.unsPath,
      credentialId: params.credentialId,
      sourceIp: params.sourceIp,
      messageType: params.messageType,
      data: values,
      metadata: params.metadata ?? {},
      traceId,
    };
  });
}
