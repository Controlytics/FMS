/**
 * Ingestion Repository — Stage 9 Data Persistence.
 * Handles writing ingestion data to TSDB and PostgreSQL.
 *
 * Rules:
 * - Telemetry: ts_telemetry (batched) + LatestTelemetry (conditional upsert)
 * - Attributes: ts_attributes (immediate) + entity attributes (PG update)
 * - Checklist: ts_checklist_responses (immediate) + ChecklistReview (PG insert)
 * - Alarm: Alarm table (PG insert)
 * - Binary: file + ts_binary_data (immediate)
 * - Device Events: ts_device_events (batched)
 * - Auto-register DataStream for new telemetry keys
 */

import { createHash, randomUUID } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { getTsdbPool, addTelemetryRow } from '@digilog/db';
import type { IngestionMessage } from './message-normalizer.js';
import { dispatchNotification } from '../notification-delivery/notification-dispatcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Telemetry Persistence ──────────────────────────────

interface TelemetryValue {
  valueNum: number | null;
  valueStr: string | null;
  valueBool: boolean | null;
  valueJson: unknown | null;
}

function classifyValue(value: unknown): TelemetryValue {
  if (value === null || value === undefined) {
    return { valueNum: null, valueStr: null, valueBool: null, valueJson: null };
  }
  if (typeof value === 'number') {
    return { valueNum: value, valueStr: null, valueBool: null, valueJson: null };
  }
  if (typeof value === 'boolean') {
    return { valueNum: null, valueStr: null, valueBool: value, valueJson: null };
  }
  if (typeof value === 'string') {
    return { valueNum: null, valueStr: value, valueBool: null, valueJson: null };
  }
  // Object / Array → JSON
  return { valueNum: null, valueStr: null, valueBool: null, valueJson: value };
}

/** Save telemetry data — batched to TSDB + conditional upsert to LatestTelemetry. */
export async function saveTelemetry(msg: IngestionMessage): Promise<{ keysWritten: number }> {
  const time = new Date(msg.timestamp);
  const entries = Object.entries(msg.data);
  let keysWritten = 0;

  for (const [key, value] of entries) {
    if (key.startsWith('_')) continue; // Skip metadata keys
    const classified = classifyValue(value);

    // Batch to TSDB
    addTelemetryRow({
      time,
      entityId: msg.entityId,
      key,
      valueNum: classified.valueNum,
      valueStr: classified.valueStr,
      valueBool: classified.valueBool,
      valueJson: classified.valueJson,
      unsPath: msg.unsPath,
      source: 'device',
      sourceIp: msg.sourceIp || null,
      traceId: msg.traceId || null,
    });

    // Atomic upsert LatestTelemetry — single SQL statement, no race condition
    try {
      const jsonVal = classified.valueJson ? JSON.stringify(classified.valueJson) : null;
      await prisma.$executeRaw`
        INSERT INTO "latest_telemetry" ("id", "entity_id", "key", "value_num", "value_str", "value_bool", "value_json", "last_updated")
        VALUES (gen_random_uuid(), ${msg.entityId}::uuid, ${key}, ${classified.valueNum}, ${classified.valueStr}, ${classified.valueBool},
          ${jsonVal}::jsonb, ${time})
        ON CONFLICT ("entity_id", "key")
        DO UPDATE SET
          "value_num" = EXCLUDED."value_num",
          "value_str" = EXCLUDED."value_str",
          "value_bool" = EXCLUDED."value_bool",
          "value_json" = EXCLUDED."value_json",
          "last_updated" = EXCLUDED."last_updated"
        WHERE EXCLUDED."last_updated" > "latest_telemetry"."last_updated"
      `;
    } catch {
      // LatestTelemetry update failure is non-critical
    }

    // Auto-register DataStream
    await autoRegisterDataStream(msg.entityId, key, value, msg.unsPath);
    keysWritten++;
  }

  return { keysWritten };
}

// ─── Attribute Persistence ──────────────────────────────

/** Save attributes — immediate INSERT to TSDB + update entity attributes in PG. */
export async function saveAttributes(msg: IngestionMessage): Promise<{ keysWritten: number }> {
  const time = new Date(msg.timestamp);
  const pool = getTsdbPool();
  const entries = Object.entries(msg.data);
  let keysWritten = 0;
  const updatedBy = msg.metadata?.userId || msg.credentialId || 'system';
  const scope = msg.credentialId ? 'client' : 'server';

  for (const [key, value] of entries) {
    if (key.startsWith('_')) continue;
    const classified = classifyValue(value);

    // Immediate INSERT to ts_attributes (compliance — NOT batched)
    await pool.query(
      `INSERT INTO ts_attributes (time, entity_id, scope, key, value_num, value_str, value_bool, value_json, updated_by, uns_path, source_ip, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [time, msg.entityId, scope, key, classified.valueNum, classified.valueStr,
       classified.valueBool, classified.valueJson ? JSON.stringify(classified.valueJson) : null,
       updatedBy, msg.unsPath, msg.sourceIp || null],
    );

    keysWritten++;
  }

  // Update entity attributes in PG
  if (keysWritten > 0) {
    const entity = await prisma.assetInstance.findUnique({
      where: { id: msg.entityId },
      select: { attributes: true },
    });

    const currentAttrs = (entity?.attributes as Record<string, unknown>) ?? {};
    const newAttrs = { ...currentAttrs };
    for (const [key, value] of entries) {
      if (!key.startsWith('_')) {
        newAttrs[key] = value;
      }
    }

    await prisma.assetInstance.update({
      where: { id: msg.entityId },
      data: { attributes: newAttrs as Prisma.InputJsonValue },
    });
  }

  return { keysWritten };
}

// ─── Checklist Persistence ──────────────────────────────

/** Save checklist response — immediate INSERT to TSDB + ChecklistReview in PG. */
export async function saveChecklist(msg: IngestionMessage): Promise<{ checklistId: string }> {
  const time = new Date(msg.timestamp);
  const pool = getTsdbPool();
  const checklistId = randomUUID();
  const submittedBy = msg.metadata?.userId || msg.data._userSub as string || 'unknown';
  const answers = { ...msg.data };
  // Remove metadata keys from answers
  delete answers._remarks;
  delete answers._userId;
  delete answers._userSub;

  // SHA-256 hash of answers for signature binding
  const answersHash = createHash('sha256').update(JSON.stringify(answers)).digest('hex');

  // Immediate INSERT to ts_checklist_responses (compliance — NOT batched)
  await pool.query(
    `INSERT INTO ts_checklist_responses (time, entity_id, template_id, checklist_id, submitted_by, answers, answers_hash, uns_path, source_ip, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [time, msg.entityId, msg.templateId, checklistId, submittedBy,
     JSON.stringify(answers), answersHash, msg.unsPath, msg.sourceIp || null],
  );

  // INSERT ChecklistReview in PG
  await prisma.checklistReview.create({
    data: {
      checklistId,
      entityId: msg.entityId,
      templateId: msg.templateId,
      currentStep: 'SUBMITTED',
      currentSequence: 1,
      performedBy: submittedBy,
      performedAt: time,
    },
  });

  return { checklistId };
}

// ─── Alarm Persistence ──────────────────────────────────

/** Create an alarm — INSERT into Alarm table in PG. */
export async function createAlarm(params: {
  entityId: string;
  alarmType: string;
  severity: string;
  unsPath: string;
  triggerDetails?: Record<string, unknown>;
  ruleChainId?: string;
}): Promise<{ alarmId: string }> {
  const alarm = await prisma.alarm.create({
    data: {
      entityId: params.entityId,
      alarmType: params.alarmType,
      severity: params.severity,
      status: 'ACTIVE',
      unsPath: params.unsPath,
      triggerDetails: (params.triggerDetails as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      createdByRuleChain: params.ruleChainId ?? null,
    },
  });

  console.log("[createAlarm] Alarm created:", alarm.id, "- dispatching notification");
  // Dispatch notification for ALARM_CREATED event
  const entity = await prisma.assetInstance.findUnique({ where: { id: params.entityId }, select: { name: true } });
  const entityName = entity?.name ?? params.unsPath;
  const triggerJson = params.triggerDetails ?? {};
  // Build trigger details string for email
  const triggerEntries = Object.entries(triggerJson)
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  const conditionInfo = triggerJson._sourceField
    ? `${triggerJson._sourceField} ${triggerJson._condition ?? ''} ${triggerJson._threshold ?? ''}`
    : '';
  dispatchNotification({
    eventType: 'ALARM_CREATED',
    context: { severity: params.severity, alarmType: params.alarmType },
    variables: {
      alarmId: alarm.id,
      alarmType: params.alarmType,
      severity: params.severity,
      status: 'ACTIVE',
      entityName,
      entityId: params.entityId,
      unsPath: params.unsPath,
      triggerDetails: triggerEntries || 'N/A',
      triggerCondition: conditionInfo || 'N/A',
      ruleChainId: params.ruleChainId ?? 'N/A',
      message: `${params.alarmType} alarm on ${entityName}`,
      timestamp: new Date().toISOString(),
    },
  }).catch(err => console.error('[createAlarm] Notification dispatch failed:', err.message));

  return { alarmId: alarm.id };
}

// ─── Binary Persistence ──────────────────────────────────

/** Save binary data — write file + INSERT to ts_binary_data (TSDB). */
export async function saveBinary(msg: IngestionMessage): Promise<{ filePath: string }> {
  const time = new Date(msg.timestamp);
  const pool = getTsdbPool();

  const data = msg.data as {
    filename?: string;
    mimetype?: string;
    size?: number;
    data?: string; // base64
  };

  // Write file to disk
  const binaryDir = path.join(__dirname, '..', '..', '..', 'uploads', 'binary', msg.entityId);
  await mkdir(binaryDir, { recursive: true });

  const fileName = `${Date.now()}-${data.filename ?? 'unnamed'}`;
  const filePath = path.join(binaryDir, fileName);
  const buffer = data.data ? Buffer.from(data.data, 'base64') : Buffer.alloc(0);

  await writeFile(filePath, buffer);

  // SHA-256 hash of file content
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  // Determine data type from mimetype
  let dataType = 'document';
  if (data.mimetype?.startsWith('image/')) dataType = 'image';
  else if (data.mimetype?.startsWith('audio/')) dataType = 'audio';

  // Immediate INSERT to ts_binary_data
  await pool.query(
    `INSERT INTO ts_binary_data (time, entity_id, data_type, file_path, file_hash, file_size, mime_type, metadata, uploaded_by, uns_path, tenant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [time, msg.entityId, dataType, filePath, fileHash, buffer.length,
     data.mimetype ?? 'application/octet-stream', null,
     msg.credentialId || 'device', msg.unsPath],
  );

  return { filePath };
}

// ─── DataStream Auto-Registration ───────────────────────

async function autoRegisterDataStream(
  entityId: string,
  key: string,
  value: unknown,
  unsPath: string,
): Promise<void> {
  try {
    const dataType = inferDataType(value);
    await prisma.dataStream.upsert({
      where: { entityId_key: { entityId, key } },
      create: {
        entityId,
        key,
        dataType,
        unsPath,
        source: 'device',
        isActive: true,
      },
      update: {
        // Only update if already exists (keep existing type)
        updatedAt: new Date(),
      },
    });
  } catch {
    // DataStream registration failure is non-critical
  }
}

function inferDataType(value: unknown): string {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'INTEGER' : 'FLOAT';
  }
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'string') return 'STRING';
  return 'JSON';
}
