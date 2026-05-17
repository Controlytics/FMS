/**
 * MQTT Handler — Parses UNS topics, determines message type, normalizes, and enqueues.
 *
 * UNS Topic Structure:
 *   digilog/v1/{enterprise}/{site}/{area}/{line}/{cell}/{entity}/{suffix}
 *
 * Suffix → Message Type:
 *   telemetry       → POST_TELEMETRY
 *   attributes      → POST_ATTRIBUTES
 *   events          → DEVICE_EVENT
 *   rpc/response/…  → RPC_RESPONSE
 *   binary/…        → POST_BINARY
 */

import { randomUUID } from 'node:crypto';
import { JOB_PRIORITY } from '@digilog/queue';
import { normalizeMessage, normalizeBatch } from '../modules/data-ingestion/message-normalizer.js';
import type { MessageType } from '../modules/data-ingestion/message-normalizer.js';
import { onRpcResponse } from '../modules/data-ingestion/rpc-handler.js';
import { enqueueIngestionJob } from '../modules/data-ingestion/ingestion.service.js';
import { prisma } from '../lib/prisma.js';

const UNS_ROOT = process.env.UNS_ROOT_PREFIX ?? 'digilog/v1';
const UNS_ROOT_SEGMENTS = UNS_ROOT.split('/').length; // e.g. "digilog/v1" → 2

interface ParsedTopic {
  enterprise: string;
  site: string;
  area: string;
  line: string;
  cell: string;
  entity: string;
  suffix: string;
  fullPath: string; // The entity-level UNS path (without suffix)
}

/**
 * Parse a UNS topic into its ISA-95 segments.
 * Expected format: {UNS_ROOT}/{enterprise}/{site}/{area}/{line}/{cell}/{entity}/{suffix}
 */
function parseTopic(topic: string): ParsedTopic | null {
  const segments = topic.split('/');

  // Minimum segments: root(2) + enterprise + site + area + line + cell + entity + suffix = 10
  // But we allow shorter paths where some ISA-95 levels may be missing
  // We need at least root + entity + suffix (root_segments + 2)
  if (segments.length < UNS_ROOT_SEGMENTS + 2) {
    return null;
  }

  // Verify the root prefix matches
  const rootSegments = segments.slice(0, UNS_ROOT_SEGMENTS);
  if (rootSegments.join('/') !== UNS_ROOT) {
    return null;
  }

  // Everything after the root: enterprise/site/area/line/cell/entity/suffix...
  const pathSegments = segments.slice(UNS_ROOT_SEGMENTS);

  // Determine where the suffix starts based on known suffixes
  const suffixPatterns = ['telemetry', 'attributes', 'events', 'rpc', 'binary'];
  let suffixIndex = -1;

  for (let i = 0; i < pathSegments.length; i++) {
    if (suffixPatterns.includes(pathSegments[i])) {
      suffixIndex = i;
      break;
    }
  }

  if (suffixIndex < 1) {
    // No recognized suffix or suffix at first position (no entity name)
    return null;
  }

  // Entity path segments are everything before the suffix
  const entityPath = pathSegments.slice(0, suffixIndex);
  const suffix = pathSegments.slice(suffixIndex).join('/');

  // Map to ISA-95 levels (fill from the end to support variable-depth hierarchies)
  const entity = entityPath[entityPath.length - 1] ?? '';
  const cell = entityPath[entityPath.length - 2] ?? '';
  const line = entityPath[entityPath.length - 3] ?? '';
  const area = entityPath[entityPath.length - 4] ?? '';
  const site = entityPath[entityPath.length - 5] ?? '';
  const enterprise = entityPath[entityPath.length - 6] ?? '';

  const fullPath = `${UNS_ROOT}/${entityPath.join('/')}`;

  return { enterprise, site, area, line, cell, entity, suffix, fullPath };
}

/**
 * Determine message type from the topic suffix.
 */
function getMessageType(suffix: string): MessageType | null {
  if (suffix === 'telemetry') return 'POST_TELEMETRY';
  if (suffix === 'attributes') return 'POST_ATTRIBUTES';
  if (suffix === 'events') return 'DEVICE_EVENT';
  if (suffix.startsWith('rpc/response')) return 'RPC_RESPONSE';
  if (suffix.startsWith('binary')) return 'POST_BINARY';
  return null;
}

/**
 * Get queue job priority based on message type.
 */
function getJobPriority(messageType: MessageType): number {
  switch (messageType) {
    case 'POST_TELEMETRY': return JOB_PRIORITY.TELEMETRY;
    case 'POST_ATTRIBUTES': return JOB_PRIORITY.ATTRIBUTE_UPDATE;
    case 'DEVICE_EVENT': return JOB_PRIORITY.DEVICE_EVENT;
    case 'POST_BINARY': return JOB_PRIORITY.BINARY_METADATA;
    default: return JOB_PRIORITY.TELEMETRY;
  }
}

/**
 * Handle an incoming MQTT message.
 * Parses the topic, determines message type, normalizes, and enqueues to the
 * graphile-worker ingestion queue.
 */
export async function handleMqttMessage(topic: string, payload: Buffer): Promise<void> {
  const parsed = parseTopic(topic);
  if (!parsed) {
    // Unrecognized topic structure — ignore silently
    return;
  }

  const messageType = getMessageType(parsed.suffix);
  if (!messageType) {
    return;
  }

  // Parse payload (JSON)
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(payload.toString('utf-8'));
  } catch {
    // Binary or non-JSON payload
    rawPayload = { _raw: payload.toString('base64'), _encoding: 'base64' };
  }

  // Check for Last Will and Testament (LWT) — device disconnected
  if (messageType === 'DEVICE_EVENT') {
    const data = rawPayload as Record<string, unknown>;
    if (data.event === 'DISCONNECTED' || data.type === 'DISCONNECTED') {
      await handleLwtMessage(parsed.fullPath, data);
      return;
    }
  }

  // Handle RPC response — store in Redis, don't enqueue
  if (messageType === 'RPC_RESPONSE') {
    const suffixParts = parsed.suffix.split('/');
    // rpc/response/{requestId}
    const requestId = suffixParts[2];
    if (requestId) {
      await onRpcResponse(requestId, rawPayload as Record<string, unknown>);
    }
    return;
  }

  // Resolve entity by UNS path
  const unsMapping = await prisma.unsMapping.findUnique({
    where: { unsPath: parsed.fullPath },
  });

  if (!unsMapping) {
    // Unknown entity path — skip
    return;
  }

  const entity = await prisma.assetInstance.findUnique({
    where: { id: unsMapping.entityId },
    include: { template: { select: { id: true, name: true } } },
  });

  if (!entity || !entity.isActive) {
    return;
  }

  // Resolve credential for this entity
  const credential = await prisma.deviceCredential.findUnique({
    where: { entityId: entity.id },
  });

  const credentialId = credential?.id ?? '';

  // Normalize messages (handle batch payloads)
  const messages = normalizeBatch({
    protocol: 'mqtt',
    entityId: entity.id,
    entityName: entity.name,
    templateId: entity.template.id,
    unsPath: parsed.fullPath,
    credentialId,
    sourceIp: '',
    messageType,
    rawPayload,
  });

  // Enqueue to graphile-worker ingestion queue
  const priority = getJobPriority(messageType);

  for (const msg of messages) {
    await enqueueIngestionJob(msg, { priority, jobId: msg.messageId });
  }

  // Update connectivity status last activity
  await prisma.connectivityStatus.upsert({
    where: { entityId: entity.id },
    update: { lastActivityAt: new Date(), status: 'ONLINE' },
    create: {
      entityId: entity.id,
      status: 'ONLINE',
      lastActivityAt: new Date(),
      protocol: 'MQTT',
    },
  });
}

/**
 * Handle LWT (Last Will and Testament) message — device disconnected.
 * Updates ConnectivityStatus to OFFLINE.
 */
async function handleLwtMessage(unsPath: string, data: Record<string, unknown>): Promise<void> {
  const unsMapping = await prisma.unsMapping.findUnique({
    where: { unsPath },
  });

  if (!unsMapping) return;

  await prisma.connectivityStatus.upsert({
    where: { entityId: unsMapping.entityId },
    update: {
      status: 'OFFLINE',
      lastDisconnectedAt: new Date(),
    },
    create: {
      entityId: unsMapping.entityId,
      status: 'OFFLINE',
      lastDisconnectedAt: new Date(),
      protocol: 'MQTT',
    },
  });

  // Also update credential lastDisconnectedAt
  await prisma.deviceCredential.updateMany({
    where: { entityId: unsMapping.entityId },
    data: { lastDisconnectedAt: new Date() },
  });

  // Enqueue as a connectivity event
  const entity = await prisma.assetInstance.findUnique({
    where: { id: unsMapping.entityId },
    include: { template: { select: { id: true, name: true } } },
  });

  if (!entity) return;

  const credential = await prisma.deviceCredential.findUnique({
    where: { entityId: entity.id },
  });

  const msg = {
    messageId: randomUUID(),
    timestamp: new Date().toISOString(),
    protocol: 'mqtt' as const,
    entityId: entity.id,
    entityName: entity.name,
    templateId: entity.template.id,
    unsPath,
    credentialId: credential?.id ?? '',
    sourceIp: '',
    messageType: 'CONNECTIVITY_EVENT',
    data: { event: 'DISCONNECTED', ...data },
    metadata: {},
    traceId: randomUUID(),
  };

  await enqueueIngestionJob(msg, {
    priority: JOB_PRIORITY.DEVICE_EVENT,
    jobId: msg.messageId,
  });
}
