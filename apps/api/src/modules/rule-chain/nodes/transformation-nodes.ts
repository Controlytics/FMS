/**
 * Transform Node Registrations
 */

import { registerNode } from '../node-registry.js';
import type { NodeResult } from '../types.js';
import { prisma } from '../../../lib/prisma.js';
import { safeExecuteScript, resolveTemplate, parseCommaSeparated, resolvePath, dedupCache } from './index.js';

export function registerTransformationNodes(): void {

registerNode({
  type: 'script-transform',
  category: 'TRANSFORM',
  name: 'Script Transform',
  description: 'Custom JavaScript to modify message. Return the modified msg object.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { script: 'return msg;' },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const script = (config.script as string) ?? 'return msg;';
      const result = safeExecuteScript(script, { msg: { ...message }, metadata: ctx.metadata, msgType: message._messageType ?? '' });
      if (result && typeof result === 'object') {
        return { output: 'Success', message: result as Record<string, unknown> };
      }
      return { output: 'Success', message };
    } catch (err) {
      return { output: 'Failure', message, log: `Script error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

registerNode({
  type: 'rename-keys',
  category: 'TRANSFORM',
  name: 'Rename Keys',
  description: 'Map telemetry key names (e.g. "temp" -> "temperature_celsius").',
  outputs: ['Success', 'Failure'],
  defaultConfig: { mapping: {} },
  async execute(message, config, _ctx): Promise<NodeResult> {
    const mapping = (config.mapping as Record<string, string>) ?? {};
    const transformed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(message)) {
      const newKey = mapping[key] ?? key;
      transformed[newKey] = value;
    }
    return { output: 'Success', message: transformed };
  },
});

registerNode({
  type: 'change-originator',
  category: 'TRANSFORM',
  name: 'Change Originator',
  description: 'Switch message entity to parent or related entity.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { target: 'parent' },
  configSchema: {
    target: { type: 'select', label: 'Target', options: ['parent', 'related'], description: 'Which entity to switch to.' },
    relationType: { type: 'select', label: 'Relation Type (for related)', options: ['CONTAINS', 'FEEDS', 'DEPENDS_ON', 'MONITORS', 'CONNECTED_TO'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const target = (config.target as string) ?? 'parent';
      if (target === 'parent') {
        const entity = await prisma.assetInstance.findUnique({
          where: { id: ctx.entityId },
          select: { parentId: true, parent: { select: { id: true, name: true, templateId: true, unsPath: true } } },
        });
        if (entity?.parent) {
          const meta = { ...ctx.metadata };
          meta.originalEntityId = ctx.entityId;
          return {
            output: 'Success',
            message: { ...message, _entityId: entity.parent.id, _entityName: entity.parent.name },
            metadata: meta,
          };
        }
      } else if (target === 'related') {
        const relationType = (config.relationType as string) ?? 'CONTAINS';
        const rel = await prisma.assetRelationship.findFirst({
          where: { sourceAssetId: ctx.entityId, relationshipType: relationType as any },
          select: { targetAsset: { select: { id: true, name: true, templateId: true, unsPath: true } } },
        });
        const target = (rel as any)?.targetAsset;
        if (target) {
          const meta = { ...ctx.metadata, originalEntityId: ctx.entityId };
          return {
            output: 'Success',
            message: { ...message, _entityId: target.id, _entityName: target.name },
            metadata: meta,
          };
        }
      }
      return { output: 'Failure', message, log: 'No target entity found' };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'to-email',
  category: 'TRANSFORM',
  name: 'To Email',
  description: 'Transform message into email notification format.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { to: '', subject: 'Alert: ${entityName}', body: 'Data received from ${entityName}', contentType: 'text/html' },
  configSchema: {
    to: { type: 'string', label: 'To', description: 'Recipient email address.' },
    subject: { type: 'string', label: 'Subject', description: 'Email subject. Supports ${entityName} variables.' },
    body: { type: 'textarea', label: 'Body', description: 'Email body. Supports ${entityName}, ${msg.key} variables.' },
    contentType: { type: 'select', label: 'Content Type', options: ['text/html', 'text/plain'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const subject = resolveTemplate((config.subject as string) ?? '', ctx, message);
    const body = resolveTemplate((config.body as string) ?? '', ctx, message);
    const emailMsg = {
      ...message,
      _email: { to: config.to, subject, body, contentType: config.contentType ?? 'text/html', entityId: ctx.entityId },
    };
    return { output: 'Success', message: emailMsg };
  },
});

registerNode({
  type: 'unit-conversion',
  category: 'TRANSFORM',
  name: 'Unit Conversion',
  description: 'Apply formula-based unit conversion to numeric values.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { conversions: [] },
  async execute(message, config, _ctx): Promise<NodeResult> {
    try {
      const conversions = (config.conversions as Array<{ key: string; formula: string }>) ?? [];
      const result = { ...message };
      for (const conv of conversions) {
        const val = result[conv.key];
        if (typeof val === 'number') {
          result[conv.key] = safeExecuteScript(`return ${conv.formula};`, { x: val }) as number;
        }
      }
      return { output: 'Success', message: result };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'copy-keys',
  category: 'TRANSFORM',
  name: 'Copy Keys',
  description: 'Copies specified keys from message to metadata or vice versa.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { direction: 'msg-to-metadata', keys: '' },
  configSchema: {
    direction: { type: 'select', label: 'Direction', options: ['msg-to-metadata', 'metadata-to-msg'] },
    keys: { type: 'textarea', label: 'Keys', description: 'Comma-separated list of keys to copy.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const keys = parseCommaSeparated(config.keys);
    if ((config.direction as string) === 'metadata-to-msg') {
      const result = { ...message };
      for (const k of keys) { if (ctx.metadata[k] !== undefined) result[k] = ctx.metadata[k]; }
      return { output: 'Success', message: result };
    }
    const meta = { ...ctx.metadata };
    for (const k of keys) { if (message[k] !== undefined) meta[k] = String(message[k]); }
    return { output: 'Success', message, metadata: meta };
  },
});

registerNode({
  type: 'delete-keys',
  category: 'TRANSFORM',
  name: 'Delete Keys',
  description: 'Removes specified keys from the message data and/or metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { messageKeys: '', metadataKeys: '' },
  configSchema: {
    messageKeys: { type: 'textarea', label: 'Message Keys', description: 'Comma-separated keys to remove from message.' },
    metadataKeys: { type: 'textarea', label: 'Metadata Keys', description: 'Comma-separated keys to remove from metadata.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const msgKeys = parseCommaSeparated(config.messageKeys);
    const metaKeys = parseCommaSeparated(config.metadataKeys);
    const result = { ...message };
    for (const k of msgKeys) delete result[k];
    const meta = { ...ctx.metadata };
    for (const k of metaKeys) delete meta[k];
    return { output: 'Success', message: result, metadata: meta };
  },
});

registerNode({
  type: 'deduplication',
  category: 'TRANSFORM',
  name: 'Deduplication',
  description: 'Detects and filters duplicate messages based on configurable keys within a time window.',
  outputs: ['Unique', 'Duplicate', 'Failure'],
  defaultConfig: { strategy: 'ALL_KEYS', keys: '', windowMs: 60000 },
  configSchema: {
    strategy: { type: 'select', label: 'Strategy', options: ['ALL_KEYS', 'SPECIFIC_KEYS'] },
    keys: { type: 'textarea', label: 'Keys', description: 'Comma-separated keys for SPECIFIC_KEYS strategy.' },
    windowMs: { type: 'number', label: 'Window (ms)', description: 'Time window for duplicate detection in milliseconds.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const keys = parseCommaSeparated(config.keys);
      const windowMs = (config.windowMs as number) ?? 60000;
      const dataToHash = (config.strategy as string) === 'SPECIFIC_KEYS' && keys.length > 0
        ? Object.fromEntries(keys.map((k) => [k, message[k]]))
        : message;
      const hashStr = `${ctx.entityId}:${JSON.stringify(dataToHash)}`;
      const now = Date.now();
      const lastSeen = dedupCache.get(hashStr);
      if (lastSeen !== undefined && (now - lastSeen) < windowMs) {
        return { output: 'Duplicate', message };
      }
      dedupCache.set(hashStr, now);
      return { output: 'Unique', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'split-array',
  category: 'TRANSFORM',
  name: 'Split Array',
  description: 'Splits an array in the message into individual messages. Returns first element and marks for further processing.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { arrayKey: 'data', keepOriginalKeys: true },
  configSchema: {
    arrayKey: { type: 'string', label: 'Array Key', description: 'Key in the message that contains the array to split.' },
    keepOriginalKeys: { type: 'boolean', label: 'Keep Original Keys', description: 'Retain non-array keys from original message in each split message.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const arrayKey = (config.arrayKey as string) ?? 'data';
      const arr = message[arrayKey];
      if (!Array.isArray(arr) || arr.length === 0) return { output: 'Failure', message, log: `Key "${arrayKey}" is not a non-empty array` };
      const keepKeys = config.keepOriginalKeys !== false;
      const baseMsg = keepKeys ? Object.fromEntries(Object.entries(message).filter(([k]) => k !== arrayKey)) : {};
      const first = typeof arr[0] === 'object' && arr[0] ? { ...baseMsg, ...arr[0] } : { ...baseMsg, [arrayKey]: arr[0] };
      const meta = { ...ctx.metadata, _splitIndex: '0', _splitTotal: String(arr.length) };
      return { output: 'Success', message: first, metadata: meta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'json-path',
  category: 'TRANSFORM',
  name: 'JSON Path',
  description: 'Extracts values from the message using dot-notation path expressions.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { expressions: '{}' },
  configSchema: {
    expressions: { type: 'textarea', label: 'Expressions (JSON)', description: 'JSON object: {"outputKey": "data.sensors[0].temperature"}.' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    try {
      let expressions: Record<string, string>;
      try { expressions = JSON.parse((config.expressions as string) ?? '{}'); } catch { return { output: 'Failure', message, log: 'Invalid expressions JSON' }; }
      const result = { ...message };
      for (const [outKey, path] of Object.entries(expressions)) {
        const val = resolvePath(message, path);
        if (val !== undefined) result[outKey] = val;
      }
      return { output: 'Success', message: result };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'duplicate-to-related',
  category: 'TRANSFORM',
  name: 'Duplicate to Related',
  description: 'Sends a copy of the message to related entities. Changes the originator context for downstream processing.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { relationType: 'CONTAINS', direction: 'source' },
  configSchema: {
    relationType: {
      type: 'select', label: 'Relation Type',
      options: ['CONTAINS', 'CONTAINED_IN', 'FEEDS', 'FED_BY', 'DEPENDS_ON', 'DEPENDED_ON_BY', 'BACKS_UP', 'BACKED_UP_BY', 'MONITORS', 'MONITORED_BY', 'CONNECTED_TO'],
    },
    direction: { type: 'select', label: 'Direction', options: ['source', 'target'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const relationType = (config.relationType as string) ?? 'CONTAINS';
      const direction = (config.direction as string) ?? 'source';
      const where = (direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType as any }
        : { targetAssetId: ctx.entityId, relationshipType: relationType as any });
      const rels = await prisma.assetRelationship.findMany({
        where,
        select: direction === 'source'
          ? { targetAsset: { select: { id: true, name: true, templateId: true, unsPath: true } } }
          : { sourceAsset: { select: { id: true, name: true, templateId: true, unsPath: true } } },
        take: 50,
      });
      const targets = rels.map((r: any) => direction === 'source' ? r.targetAsset : r.sourceAsset).filter(Boolean);
      return {
        output: 'Success',
        message: { ...message, _duplicateToEntities: targets },
        metadata: { ...ctx.metadata, _duplicateCount: String(targets.length) },
      };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'math-function',
  category: 'TRANSFORM',
  name: 'Math Function',
  description: 'Apply mathematical functions to numeric message values (abs, ceil, floor, round, sqrt, log, exp, min, max, pow).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { operations: '[]' },
  configSchema: {
    operations: { type: 'textarea', label: 'Operations (JSON)', description: 'JSON array of {key, function, outputKey} objects. Functions: abs, ceil, floor, round, sqrt, log, exp, pow, min, max.' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    try {
      let operations: Array<{ key: string; function: string; outputKey?: string; arg?: number }>;
      try { operations = JSON.parse((config.operations as string) ?? '[]'); } catch { return { output: 'Failure', message, log: 'Invalid operations JSON' }; }
      const result = { ...message };
      const mathFns: Record<string, (v: number, arg?: number) => number> = {
        abs: Math.abs, ceil: Math.ceil, floor: Math.floor, round: Math.round,
        sqrt: Math.sqrt, log: Math.log, exp: Math.exp,
        pow: (v, a) => Math.pow(v, a ?? 2),
        min: (v, a) => Math.min(v, a ?? 0),
        max: (v, a) => Math.max(v, a ?? 0),
      };
      for (const op of operations) {
        const val = Number(result[op.key]);
        if (isNaN(val)) continue;
        const fn = mathFns[op.function];
        if (fn) result[op.outputKey ?? op.key] = fn(val, op.arg);
      }
      return { output: 'Success', message: result };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

}
