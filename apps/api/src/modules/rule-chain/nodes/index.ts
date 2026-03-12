/**
 * Node Implementations — All rule chain node types.
 * Auto-registered when imported.
 */

import vm from 'node:vm';
import { registerNode } from '../node-registry.js';
import { prisma } from '../../../lib/prisma.js';
import type { NodeDefinition, RuleNodeConfig, NodeContext, NodeResult } from '../types.js';

// ═══════════════════════════════════════════════════════
// HELPER UTILITIES
// ═══════════════════════════════════════════════════════

/** Execute user-supplied script in a sandboxed vm context (no process/require/global access). */
function safeExecuteScript(code: string, sandbox: Record<string, unknown>, timeout = 1000): unknown {
  const ctx = vm.createContext(sandbox);
  const script = new vm.Script(`(function(){ ${code} })()`, { filename: 'user-script.js' });
  return script.runInContext(ctx, { timeout });
}

/** Template variable resolution: replaces ${entityName}, ${metadata.key}, ${messageJson} */
function resolveTemplate(template: string, ctx: NodeContext, message: Record<string, unknown>): string {
  let result = template;
  result = result.replace(/\$\{entityName\}/g, ctx.entityName);
  result = result.replace(/\$\{entityId\}/g, ctx.entityId);
  result = result.replace(/\$\{templateId\}/g, ctx.templateId);
  result = result.replace(/\$\{unsPath\}/g, ctx.unsPath);
  result = result.replace(/\$\{messageJson\}/g, JSON.stringify(message));
  result = result.replace(/\$\{metadata\.(\w+)\}/g, (_, key) => ctx.metadata[key] ?? '');
  result = result.replace(/\$\{msg\.(\w+)\}/g, (_, key) => String(message[key] ?? ''));
  return result;
}

/** Parse comma-separated string to trimmed array */
function parseCommaSeparated(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Haversine distance between two GPS points in meters */
function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Point-in-polygon using ray casting algorithm */
function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [yi, xi] = polygon[i];
    const [yj, xj] = polygon[j];
    if ((yi > lng) !== (yj > lng) && lat < ((xj - xi) * (lng - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Dot-notation path resolver for JSON objects */
function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Simple LRU cache for stateful nodes */
class LRUCache<K, V> {
  private map = new Map<K, { value: V; ts: number }>();
  constructor(private maxSize: number, private ttlMs: number) {}
  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.ts > this.ttlMs) { this.map.delete(key); return undefined; }
    return entry.value;
  }
  set(key: K, value: V): void {
    if (this.map.size >= this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, ts: Date.now() });
  }
}

// Shared caches for stateful nodes
const dedupCache = new LRUCache<string, number>(10000, 300000);
const messageCountCache = new Map<string, number[]>();
const geofenceStateCache = new Map<string, boolean>();
const aggregateStreamCache = new Map<string, Array<{ value: number; ts: number }>>();

// ═══════════════════════════════════════════════════════
// INPUT NODES
// ═══════════════════════════════════════════════════════

registerNode({
  type: 'input',
  category: 'INPUT',
  name: 'Input',
  description: 'Entry point for the rule chain. Passes message through.',
  outputs: ['Success'],
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message };
  },
});

// ═══════════════════════════════════════════════════════
// FILTER NODES
// ═══════════════════════════════════════════════════════

registerNode({
  type: 'msg-type-filter',
  category: 'FILTER',
  name: 'Message Type Filter',
  description: 'Routes messages based on message type. True if type matches configured types.',
  outputs: ['True', 'False', 'Failure'],
  defaultConfig: { messageTypes: ['TELEMETRY'] },
  async execute(message, config, _ctx): Promise<NodeResult> {
    const types = (config.messageTypes as string[]) ?? [];
    const msgType = (message._messageType as string) ?? '';
    const matches = types.includes(msgType);
    return { output: matches ? 'True' : 'False', message };
  },
});

registerNode({
  type: 'script-filter',
  category: 'FILTER',
  name: 'Script Filter',
  description: 'Custom JavaScript filter. Return true for True output, false for False output.',
  outputs: ['True', 'False', 'Failure'],
  defaultConfig: { script: 'return msg.temperature > 100;' },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const script = (config.script as string) ?? 'return true;';
      const result = safeExecuteScript(script, { msg: message, metadata: ctx.metadata, msgType: message._messageType ?? '' });
      return { output: result ? 'True' : 'False', message };
    } catch (err) {
      return { output: 'Failure', message, log: `Script error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

registerNode({
  type: 'check-relation',
  category: 'FILTER',
  name: 'Check Relation',
  description: 'Checks if entity has a specific relationship type.',
  outputs: ['True', 'False', 'Failure'],
  defaultConfig: { relationType: 'CONTAINS', direction: 'source' },
  configSchema: {
    relationType: {
      type: 'select',
      label: 'Relation Type',
      options: ['CONTAINS', 'CONTAINED_IN', 'FEEDS', 'FED_BY', 'DEPENDS_ON', 'DEPENDED_ON_BY', 'BACKS_UP', 'BACKED_UP_BY', 'MONITORS', 'MONITORED_BY', 'CONNECTED_TO', 'CUSTOM'],
    },
    direction: { type: 'select', label: 'Direction', options: ['source', 'target'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const relationType = (config.relationType as string) ?? 'CONTAINS';
      const direction = (config.direction as string) ?? 'source';
      const where = direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType }
        : { targetAssetId: ctx.entityId, relationshipType: relationType };
      const count = await prisma.assetRelationship.count({ where });
      return { output: count > 0 ? 'True' : 'False', message };
    } catch (err) {
      return { output: 'Failure', message, log: `Check relation error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

registerNode({
  type: 'originator-type-filter',
  category: 'FILTER',
  name: 'Originator Type Filter',
  description: 'Filters by entity template name/category.',
  outputs: ['True', 'False', 'Failure'],
  defaultConfig: { templateNames: [] },
  configSchema: {
    templateNames: { type: 'textarea', label: 'Template Names', description: 'Comma-separated list of template names to match.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const templateNames = parseCommaSeparated(config.templateNames);
      const template = await prisma.assetTemplate.findUnique({
        where: { id: ctx.templateId },
        select: { name: true },
      });
      const matches = template ? templateNames.includes(template.name) : false;
      return { output: matches ? 'True' : 'False', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'check-alarm-status',
  category: 'FILTER',
  name: 'Check Alarm Status',
  description: 'Checks if an alarm exists with a specific status for the entity.',
  outputs: ['True', 'False', 'Failure'],
  defaultConfig: { alarmType: '', status: 'ACTIVE' },
  configSchema: {
    alarmType: { type: 'string', label: 'Alarm Type', description: 'Alarm type to check for.' },
    status: { type: 'select', label: 'Status', options: ['ACTIVE', 'ACKNOWLEDGED', 'CLEARED', 'MANUALLY_CLEARED'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const alarmType = (config.alarmType as string) ?? '';
      const status = (config.status as string) ?? 'ACTIVE';
      const count = await prisma.alarm.count({
        where: { entityId: ctx.entityId, alarmType, status },
      });
      return { output: count > 0 ? 'True' : 'False', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

// --- NEW FILTER NODES ---

registerNode({
  type: 'entity-type-filter',
  category: 'FILTER',
  name: 'Entity Type Filter',
  description: 'Routes messages based on entity template category (e.g., Sensor, Reactor, Pump).',
  outputs: ['True', 'False', 'Failure'],
  defaultConfig: { templateCategories: '' },
  configSchema: {
    templateCategories: { type: 'textarea', label: 'Template Categories', description: 'Comma-separated list of template categories to match.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const categories = parseCommaSeparated(config.templateCategories);
      const template = await prisma.assetTemplate.findUnique({
        where: { id: ctx.templateId },
        select: { category: true },
      });
      const matches = template ? categories.includes(template.category) : false;
      return { output: matches ? 'True' : 'False', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'entity-type-switch',
  category: 'FILTER',
  name: 'Entity Type Switch',
  description: 'Routes messages to different outputs based on entity template name. Each template name becomes an output label.',
  outputs: ['Other', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, ctx): Promise<NodeResult> {
    try {
      const template = await prisma.assetTemplate.findUnique({
        where: { id: ctx.templateId },
        select: { name: true },
      });
      return { output: template?.name ?? 'Other', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'template-switch',
  category: 'FILTER',
  name: 'Template Switch',
  description: 'Routes messages to different outputs based on entity template category. Each category becomes an output label.',
  outputs: ['Other', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, ctx): Promise<NodeResult> {
    try {
      const template = await prisma.assetTemplate.findUnique({
        where: { id: ctx.templateId },
        select: { category: true },
      });
      return { output: template?.category ?? 'Other', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'check-existence-fields',
  category: 'FILTER',
  name: 'Check Existence Fields',
  description: 'Checks whether specified keys exist in the message data or metadata.',
  outputs: ['True', 'False', 'Failure'],
  defaultConfig: { messageFields: '', metadataFields: '', checkAllKeys: true },
  configSchema: {
    messageFields: { type: 'textarea', label: 'Message Fields', description: 'Comma-separated list of message keys that must exist.' },
    metadataFields: { type: 'textarea', label: 'Metadata Fields', description: 'Comma-separated list of metadata keys that must exist.' },
    checkAllKeys: { type: 'boolean', label: 'Check All Keys', description: 'When true, ALL keys must exist. When false, ANY key match is sufficient.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const msgFields = parseCommaSeparated(config.messageFields);
      const metaFields = parseCommaSeparated(config.metadataFields);
      const checkAll = config.checkAllKeys !== false;
      const allFields: boolean[] = [];
      for (const f of msgFields) allFields.push(f in message && message[f] !== undefined);
      for (const f of metaFields) allFields.push(f in ctx.metadata && ctx.metadata[f] !== undefined);
      if (allFields.length === 0) return { output: 'True', message };
      const matches = checkAll ? allFields.every(Boolean) : allFields.some(Boolean);
      return { output: matches ? 'True' : 'False', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'msg-type-switch',
  category: 'FILTER',
  name: 'Message Type Switch',
  description: 'Routes messages to different outputs based on message type. Each type becomes an output label.',
  outputs: ['TELEMETRY', 'ATTRIBUTE_UPDATE', 'RPC_REQUEST', 'ALARM', 'CONNECT', 'DISCONNECT', 'Other', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    const msgType = (message._messageType as string) ?? 'Other';
    return { output: msgType || 'Other', message };
  },
});

registerNode({
  type: 'gps-geofencing-filter',
  category: 'FILTER',
  name: 'GPS Geofencing Filter',
  description: 'Checks if GPS coordinates in the message are within a defined geofence (circle or polygon).',
  outputs: ['True', 'False', 'Failure'],
  defaultConfig: { latKey: 'latitude', lngKey: 'longitude', fenceType: 'circle', centerLat: 0, centerLng: 0, radiusMeters: 1000, polygonPoints: '' },
  configSchema: {
    latKey: { type: 'string', label: 'Latitude Key', description: 'Message key for latitude value.' },
    lngKey: { type: 'string', label: 'Longitude Key', description: 'Message key for longitude value.' },
    fenceType: { type: 'select', label: 'Fence Type', options: ['circle', 'polygon'] },
    centerLat: { type: 'number', label: 'Center Latitude', description: 'Center latitude for circle fence.' },
    centerLng: { type: 'number', label: 'Center Longitude', description: 'Center longitude for circle fence.' },
    radiusMeters: { type: 'number', label: 'Radius (meters)', description: 'Radius in meters for circle fence.' },
    polygonPoints: { type: 'textarea', label: 'Polygon Points', description: 'JSON array of [lat, lng] pairs for polygon fence.' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    try {
      const lat = Number(message[(config.latKey as string) ?? 'latitude']);
      const lng = Number(message[(config.lngKey as string) ?? 'longitude']);
      if (isNaN(lat) || isNaN(lng)) return { output: 'Failure', message, log: 'Invalid coordinates' };

      if ((config.fenceType as string) === 'polygon') {
        let polygon: [number, number][];
        try { polygon = JSON.parse((config.polygonPoints as string) ?? '[]'); } catch { return { output: 'Failure', message, log: 'Invalid polygon JSON' }; }
        return { output: pointInPolygon(lat, lng, polygon) ? 'True' : 'False', message };
      }
      const dist = haversineDistance(lat, lng, Number(config.centerLat ?? 0), Number(config.centerLng ?? 0));
      return { output: dist <= Number(config.radiusMeters ?? 1000) ? 'True' : 'False', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'switch',
  category: 'FILTER',
  name: 'Switch',
  description: 'Custom JavaScript that returns an array of output labels to route the message to. Enables multi-path routing.',
  outputs: ['Failure'],
  defaultConfig: { script: "return ['True'];" },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const script = (config.script as string) ?? "return ['True'];";
      const result = safeExecuteScript(script, { msg: message, metadata: ctx.metadata, msgType: message._messageType ?? '' });
      const outputs = Array.isArray(result) ? result.map(String) : [String(result)];
      return { output: outputs[0] ?? 'Failure', message };
    } catch (err) {
      return { output: 'Failure', message, log: `Script error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

// ═══════════════════════════════════════════════════════
// ENRICHMENT NODES
// ═══════════════════════════════════════════════════════

registerNode({
  type: 'entity-attributes',
  category: 'ENRICHMENT',
  name: 'Entity Attributes',
  description: 'Attaches entity attributes to message metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, ctx): Promise<NodeResult> {
    try {
      const entity = await prisma.assetInstance.findUnique({
        where: { id: ctx.entityId },
        select: { attributes: true, customAttributes: true },
      });
      const attrs = {
        ...(entity?.attributes as Record<string, unknown> ?? {}),
        ...(entity?.customAttributes as Record<string, unknown> ?? {}),
      };
      const enrichedMeta = { ...ctx.metadata };
      for (const [k, v] of Object.entries(attrs)) {
        enrichedMeta[`attr_${k}`] = String(v);
      }
      return { output: 'Success', message, metadata: enrichedMeta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'entity-details',
  category: 'ENRICHMENT',
  name: 'Entity Details',
  description: 'Attaches entity name, template, parent info to metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, ctx): Promise<NodeResult> {
    try {
      const entity = await prisma.assetInstance.findUnique({
        where: { id: ctx.entityId },
        select: { name: true, templateId: true, parentId: true, status: true, template: { select: { name: true, category: true } } },
      });
      const meta = { ...ctx.metadata };
      if (entity) {
        meta.entityName = entity.name;
        meta.entityStatus = entity.status;
        meta.templateName = entity.template.name;
        meta.templateCategory = entity.template.category;
        if (entity.parentId) meta.parentId = entity.parentId;
      }
      return { output: 'Success', message, metadata: meta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'related-attributes',
  category: 'ENRICHMENT',
  name: 'Related Attributes',
  description: 'Fetches attributes from related entities and adds to metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { relationType: 'CONTAINS', direction: 'source' },
  configSchema: {
    relationType: {
      type: 'select', label: 'Relation Type',
      options: ['CONTAINS', 'CONTAINED_IN', 'FEEDS', 'FED_BY', 'DEPENDS_ON', 'DEPENDED_ON_BY', 'BACKS_UP', 'BACKED_UP_BY', 'MONITORS', 'MONITORED_BY', 'CONNECTED_TO', 'CUSTOM'],
    },
    direction: { type: 'select', label: 'Direction', options: ['source', 'target'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const relationType = (config.relationType as string) ?? 'CONTAINS';
      const direction = (config.direction as string) ?? 'source';
      const where = direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType }
        : { targetAssetId: ctx.entityId, relationshipType: relationType };
      const rels = await prisma.assetRelationship.findMany({
        where,
        select: direction === 'source'
          ? { targetAsset: { select: { name: true, attributes: true } } }
          : { sourceAsset: { select: { name: true, attributes: true } } },
        take: 10,
      });
      const meta = { ...ctx.metadata };
      for (let i = 0; i < rels.length; i++) {
        const rel = rels[i] as Record<string, unknown>;
        const asset = (direction === 'source' ? rel.targetAsset : rel.sourceAsset) as { name: string; attributes: Record<string, unknown> } | undefined;
        if (asset) {
          meta[`related_${i}_name`] = asset.name;
        }
      }
      return { output: 'Success', message, metadata: meta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'tenant-attributes',
  category: 'ENRICHMENT',
  name: 'Tenant Attributes',
  description: 'Attaches system-level settings to metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, ctx): Promise<NodeResult> {
    try {
      const configs = await prisma.systemConfig.findMany({ take: 20 });
      const meta: Record<string, string> = { ...ctx.metadata, tenantId: 'default' };
      for (const c of configs) meta[`sys_${c.configKey}`] = String(c.configValue).slice(0, 200);
      return { output: 'Success', message, metadata: meta };
    } catch {
      const meta = { ...ctx.metadata, tenantId: 'default' };
      return { output: 'Success', message, metadata: meta };
    }
  },
});

// --- NEW ENRICHMENT NODES ---

registerNode({
  type: 'originator-attributes',
  category: 'ENRICHMENT',
  name: 'Originator Attributes',
  description: 'Fetches specific attributes of the originating entity and adds them to message or metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { attributeKeys: '', addToMetadata: true },
  configSchema: {
    attributeKeys: { type: 'textarea', label: 'Attribute Keys', description: 'Comma-separated attribute keys to fetch (empty = all).' },
    addToMetadata: { type: 'boolean', label: 'Add to Metadata', description: 'When true, adds to metadata. When false, adds to message body.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const entity = await prisma.assetInstance.findUnique({
        where: { id: ctx.entityId },
        select: { attributes: true, customAttributes: true },
      });
      const allAttrs = { ...(entity?.attributes as Record<string, unknown> ?? {}), ...(entity?.customAttributes as Record<string, unknown> ?? {}) };
      const keys = parseCommaSeparated(config.attributeKeys);
      const filtered = keys.length > 0 ? Object.fromEntries(Object.entries(allAttrs).filter(([k]) => keys.includes(k))) : allAttrs;
      if (config.addToMetadata !== false) {
        const meta = { ...ctx.metadata };
        for (const [k, v] of Object.entries(filtered)) meta[`attr_${k}`] = String(v);
        return { output: 'Success', message, metadata: meta };
      }
      return { output: 'Success', message: { ...message, ...filtered } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'originator-telemetry',
  category: 'ENRICHMENT',
  name: 'Originator Telemetry',
  description: 'Fetches latest telemetry values for the originating entity and adds to message or metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { telemetryKeys: '', latestOnly: true },
  configSchema: {
    telemetryKeys: { type: 'textarea', label: 'Telemetry Keys', description: 'Comma-separated telemetry keys to fetch (empty = all).' },
    latestOnly: { type: 'boolean', label: 'Latest Only', description: 'Fetch only the latest value per key.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const keys = parseCommaSeparated(config.telemetryKeys);
      const where: Record<string, unknown> = { entityId: ctx.entityId };
      if (keys.length > 0) where.key = { in: keys };
      const telemetry = await prisma.latestTelemetry.findMany({ where: where as any, take: 100 });
      const meta = { ...ctx.metadata };
      for (const t of telemetry) {
        const val = t.valueNum ?? t.valueStr ?? t.valueBool;
        meta[`ts_${t.key}`] = String(val ?? '');
        meta[`ts_${t.key}_at`] = t.lastUpdated.toISOString();
      }
      return { output: 'Success', message, metadata: meta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'originator-fields',
  category: 'ENRICHMENT',
  name: 'Originator Fields',
  description: 'Fetches entity instance fields (name, status, unsPath, createdBy, etc.) and adds to metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { fields: 'name,status,unsPath,createdBy' },
  configSchema: {
    fields: { type: 'textarea', label: 'Fields', description: 'Comma-separated list: name, status, unsPath, createdBy, updatedBy, description, templateVersion.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const entity = await prisma.assetInstance.findUnique({
        where: { id: ctx.entityId },
        select: { name: true, status: true, unsPath: true, createdBy: true, updatedBy: true, description: true, templateVersion: true },
      });
      if (!entity) return { output: 'Failure', message, log: 'Entity not found' };
      const fields = parseCommaSeparated(config.fields);
      const meta = { ...ctx.metadata };
      const entityObj = entity as Record<string, unknown>;
      for (const f of fields) {
        if (entityObj[f] !== undefined && entityObj[f] !== null) meta[`field_${f}`] = String(entityObj[f]);
      }
      return { output: 'Success', message, metadata: meta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'calculate-delta',
  category: 'ENRICHMENT',
  name: 'Calculate Delta',
  description: 'Calculates the difference between the current and previous telemetry value. Adds delta to message.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { keys: '', addPeriod: true, roundTo: 2 },
  configSchema: {
    keys: { type: 'textarea', label: 'Keys', description: 'Comma-separated telemetry keys to calculate delta for (empty = all numeric).' },
    addPeriod: { type: 'boolean', label: 'Add Period', description: 'Include time delta (ms) between current and previous value.' },
    roundTo: { type: 'number', label: 'Decimal Places', description: 'Round delta to N decimal places.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const keys = parseCommaSeparated(config.keys);
      const roundTo = (config.roundTo as number) ?? 2;
      const numericKeys = keys.length > 0 ? keys : Object.keys(message).filter((k) => typeof message[k] === 'number' && !k.startsWith('_'));
      const result = { ...message };
      for (const key of numericKeys) {
        const currentVal = Number(message[key]);
        if (isNaN(currentVal)) continue;
        const prev = await prisma.latestTelemetry.findUnique({
          where: { entityId_key: { entityId: ctx.entityId, key } },
        });
        if (prev?.valueNum !== undefined && prev?.valueNum !== null) {
          const prevVal = Number(prev.valueNum);
          if (!isNaN(prevVal)) {
            const delta = Number((currentVal - prevVal).toFixed(roundTo));
            result[`_delta_${key}`] = delta;
            if (config.addPeriod !== false) {
              result[`_period_${key}`] = Date.now() - prev.lastUpdated.getTime();
            }
          }
        }
      }
      return { output: 'Success', message: result };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'related-entity-data',
  category: 'ENRICHMENT',
  name: 'Related Entity Data',
  description: 'Fetches attributes and telemetry from related entities and enriches the message.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { relationType: 'CONTAINS', direction: 'source', attributeKeys: '', telemetryKeys: '' },
  configSchema: {
    relationType: {
      type: 'select', label: 'Relation Type',
      options: ['CONTAINS', 'CONTAINED_IN', 'FEEDS', 'FED_BY', 'DEPENDS_ON', 'DEPENDED_ON_BY', 'BACKS_UP', 'BACKED_UP_BY', 'MONITORS', 'MONITORED_BY', 'CONNECTED_TO', 'CUSTOM'],
    },
    direction: { type: 'select', label: 'Direction', options: ['source', 'target'] },
    attributeKeys: { type: 'textarea', label: 'Attribute Keys', description: 'Comma-separated attribute keys to fetch from related entities.' },
    telemetryKeys: { type: 'textarea', label: 'Telemetry Keys', description: 'Comma-separated telemetry keys to fetch from related entities.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const relationType = (config.relationType as string) ?? 'CONTAINS';
      const direction = (config.direction as string) ?? 'source';
      const attrKeys = parseCommaSeparated(config.attributeKeys);
      const tsKeys = parseCommaSeparated(config.telemetryKeys);
      const where = direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType }
        : { targetAssetId: ctx.entityId, relationshipType: relationType };
      const rels = await prisma.assetRelationship.findMany({
        where,
        select: direction === 'source'
          ? { targetAssetId: true, targetAsset: { select: { name: true, attributes: true } } }
          : { sourceAssetId: true, sourceAsset: { select: { name: true, attributes: true } } },
        take: 20,
      });
      const meta = { ...ctx.metadata };
      for (let i = 0; i < rels.length; i++) {
        const rel = rels[i] as any;
        const asset = direction === 'source' ? rel.targetAsset : rel.sourceAsset;
        const assetId = direction === 'source' ? rel.targetAssetId : rel.sourceAssetId;
        if (asset) {
          meta[`related_${i}_name`] = asset.name;
          const attrs = asset.attributes as Record<string, unknown> ?? {};
          for (const k of (attrKeys.length > 0 ? attrKeys : Object.keys(attrs))) {
            if (attrs[k] !== undefined) meta[`related_${i}_attr_${k}`] = String(attrs[k]);
          }
        }
        if (tsKeys.length > 0 && assetId) {
          const telemetry = await prisma.latestTelemetry.findMany({ where: { entityId: assetId, key: { in: tsKeys } } });
          for (const t of telemetry) meta[`related_${i}_ts_${t.key}`] = String(t.valueNum ?? t.valueStr ?? t.valueBool ?? '');
        }
      }
      return { output: 'Success', message, metadata: meta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'fetch-entity-credentials',
  category: 'ENRICHMENT',
  name: 'Fetch Entity Credentials',
  description: 'Fetches the device credential (access token, protocol) for the originating entity.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, ctx): Promise<NodeResult> {
    try {
      const cred = await prisma.deviceCredential.findFirst({ where: { entityId: ctx.entityId } });
      const meta = { ...ctx.metadata };
      if (cred) {
        meta.credentialStatus = cred.status;
        meta.accessToken = cred.accessToken;
        if (cred.firstConnectedAt) meta.firstConnectedAt = cred.firstConnectedAt.toISOString();
        if (cred.lastConnectedAt) meta.lastConnectedAt = cred.lastConnectedAt.toISOString();
        if (cred.lastSourceIp) meta.lastSourceIp = cred.lastSourceIp;
      }
      return { output: 'Success', message, metadata: meta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'parent-attributes',
  category: 'ENRICHMENT',
  name: 'Parent Attributes',
  description: 'Fetches attributes from the parent entity (via parentId) and adds to metadata.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { attributeKeys: '' },
  configSchema: {
    attributeKeys: { type: 'textarea', label: 'Attribute Keys', description: 'Comma-separated attribute keys to fetch from parent (empty = all).' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const entity = await prisma.assetInstance.findUnique({
        where: { id: ctx.entityId },
        select: { parentId: true },
      });
      if (!entity?.parentId) return { output: 'Failure', message, log: 'No parent entity' };
      const parent = await prisma.assetInstance.findUnique({
        where: { id: entity.parentId },
        select: { name: true, attributes: true, customAttributes: true },
      });
      if (!parent) return { output: 'Failure', message, log: 'Parent not found' };
      const allAttrs = { ...(parent.attributes as Record<string, unknown> ?? {}), ...(parent.customAttributes as Record<string, unknown> ?? {}) };
      const keys = parseCommaSeparated(config.attributeKeys);
      const filtered = keys.length > 0 ? Object.fromEntries(Object.entries(allAttrs).filter(([k]) => keys.includes(k))) : allAttrs;
      const meta: Record<string, string> = { ...ctx.metadata, parentName: parent.name };
      for (const [k, v] of Object.entries(filtered)) meta[`parent_attr_${k}`] = String(v);
      return { output: 'Success', message, metadata: meta };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

// ═══════════════════════════════════════════════════════
// TRANSFORM NODES
// ═══════════════════════════════════════════════════════

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
          where: { sourceAssetId: ctx.entityId, relationshipType: relationType },
          select: { targetAsset: { select: { id: true, name: true, templateId: true, unsPath: true } } },
        });
        if (rel?.targetAsset) {
          const meta = { ...ctx.metadata, originalEntityId: ctx.entityId };
          return {
            output: 'Success',
            message: { ...message, _entityId: rel.targetAsset.id, _entityName: rel.targetAsset.name },
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

// --- NEW TRANSFORM NODES ---

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
      const where = direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType }
        : { targetAssetId: ctx.entityId, relationshipType: relationType };
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

// ═══════════════════════════════════════════════════════
// ACTION NODES
// ═══════════════════════════════════════════════════════

registerNode({
  type: 'save-timeseries',
  category: 'ACTION',
  name: 'Save Timeseries',
  description: 'Save data to ts_telemetry (default action for telemetry).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { defaultTTL: 0, useServerTs: false },
  configSchema: {
    defaultTTL: { type: 'number', label: 'Default TTL (seconds)', description: 'Time-to-live in seconds (0 = never expires).' },
    useServerTs: { type: 'boolean', label: 'Use Server Timestamp', description: 'Use server time instead of message timestamp.' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _saveAs: 'telemetry', _ttl: config.defaultTTL ?? 0, _useServerTs: config.useServerTs ?? false } };
  },
});

registerNode({
  type: 'save-attributes',
  category: 'ACTION',
  name: 'Save Attributes',
  description: 'Save data to entity attributes.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { scope: 'server' },
  configSchema: {
    scope: { type: 'select', label: 'Scope', options: ['server', 'custom'] },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _saveAs: 'attributes', _scope: config.scope ?? 'server' } };
  },
});

registerNode({
  type: 'create-alarm',
  category: 'ACTION',
  name: 'Create Alarm',
  description: 'Create or update an alarm with severity, type, and details.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { alarmType: 'THRESHOLD', severity: 'WARNING', propagate: false },
  configSchema: {
    alarmType: { type: 'string', label: 'Alarm Type', description: 'Type of alarm (e.g., THRESHOLD, RATE_OF_CHANGE).' },
    severity: { type: 'select', label: 'Severity', options: ['WARNING', 'ALARM', 'CRITICAL'] },
    propagate: { type: 'boolean', label: 'Propagate', description: 'Propagate alarm to parent entities.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const details: Record<string, unknown> = { ...message };
    if (config.sourceField) details._sourceField = config.sourceField;
    if (config.condition) details._condition = config.condition;
    if (config.threshold !== undefined) details._threshold = config.threshold;
    if (config.ruleType) details._ruleType = config.ruleType;
    const alarm = {
      entityId: ctx.entityId,
      alarmType: (config.alarmType as string) ?? 'THRESHOLD',
      severity: (config.severity as string) ?? 'WARNING',
      details,
      clear: false,
    };
    return { output: 'Success', message, alarms: [alarm] };
  },
});

registerNode({
  type: 'clear-alarm',
  category: 'ACTION',
  name: 'Clear Alarm',
  description: 'Clear an existing alarm by type.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { alarmType: 'THRESHOLD' },
  configSchema: {
    alarmType: { type: 'string', label: 'Alarm Type', description: 'Alarm type to clear.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const alarm = {
      entityId: ctx.entityId,
      alarmType: (config.alarmType as string) ?? 'THRESHOLD',
      severity: 'INFO',
      clear: true,
      details: message,
    };
    return { output: 'Success', message, alarms: [alarm] };
  },
});

registerNode({
  type: 'send-notification',
  category: 'ACTION',
  name: 'Send Notification',
  description: 'Enqueue a notification to the notification queue.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { title: 'Alert', messageTemplate: 'Alert on ${entityName}', targetRole: '' },
  configSchema: {
    title: { type: 'string', label: 'Title', description: 'Notification title.' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'Notification message. Supports ${entityName} variables.' },
    targetRole: { type: 'string', label: 'Target Role', description: 'Role to receive notification (empty = all).' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const title = resolveTemplate((config.title as string) ?? 'Alert', ctx, message);
    const msg = resolveTemplate((config.messageTemplate as string) ?? '', ctx, message);
    const notification = {
      type: 'RULE_CHAIN_ALERT',
      title,
      message: msg,
      targetRole: (config.targetRole as string) || undefined,
      metadata: { entityId: ctx.entityId },
    };
    return { output: 'Success', message, notifications: [notification] };
  },
});

registerNode({
  type: 'assign-to-user',
  category: 'ACTION',
  name: 'Assign to User',
  description: 'Set alarm assignee (metadata tag).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { userId: '' },
  configSchema: {
    userId: { type: 'string', label: 'User ID', description: 'User UUID to assign to.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const meta = { ...ctx.metadata, assignedTo: (config.userId as string) ?? '' };
    return { output: 'Success', message, metadata: meta };
  },
});

registerNode({
  type: 'log',
  category: 'ACTION',
  name: 'Log',
  description: 'Write to server log (debug only). Use a TBEL/JS function to format the log message.',
  outputs: ['Success'],
  defaultConfig: { level: 'info', template: 'Rule chain log: ${entityName}' },
  configSchema: {
    level: { type: 'select', label: 'Level', options: ['info', 'warn', 'error', 'debug'] },
    template: { type: 'textarea', label: 'Log Template', description: 'Log message. Supports ${entityName}, ${msg.key} variables.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const logMsg = resolveTemplate((config.template as string) ?? '', ctx, message);
    console.log(`[RuleChain:Log] ${logMsg}`, JSON.stringify(message).slice(0, 200));
    return { output: 'Success', message, log: logMsg };
  },
});

registerNode({
  type: 'rpc-call-reply',
  category: 'ACTION',
  name: 'RPC Call Reply',
  description: 'Send RPC response back to device.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _rpcReply: true } };
  },
});

// --- NEW ACTION NODES ---

registerNode({
  type: 'create-relation',
  category: 'ACTION',
  name: 'Create Relation',
  description: 'Creates a relationship between the originating entity and another entity.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { targetEntityId: '', relationType: 'CONTAINS', removeCurrentRelations: false },
  configSchema: {
    targetEntityId: { type: 'string', label: 'Target Entity ID', description: 'UUID of target entity (or use ${metadata.key} template).' },
    relationType: { type: 'select', label: 'Relation Type', options: ['CONTAINS', 'FEEDS', 'DEPENDS_ON', 'BACKS_UP', 'MONITORS', 'CONNECTED_TO', 'CUSTOM'] },
    removeCurrentRelations: { type: 'boolean', label: 'Remove Existing', description: 'Remove existing relations of this type before creating new one.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      let targetId = (config.targetEntityId as string) ?? '';
      targetId = resolveTemplate(targetId, ctx, message);
      if (!targetId) return { output: 'Failure', message, log: 'No target entity ID' };
      const relationType = (config.relationType as string) ?? 'CONTAINS';
      if (config.removeCurrentRelations) {
        await prisma.assetRelationship.deleteMany({ where: { sourceAssetId: ctx.entityId, relationshipType: relationType } });
      }
      const INVERSE_MAP: Record<string, string> = { CONTAINS: 'CONTAINED_IN', CONTAINED_IN: 'CONTAINS', FEEDS: 'FED_BY', FED_BY: 'FEEDS', DEPENDS_ON: 'DEPENDED_ON_BY', DEPENDED_ON_BY: 'DEPENDS_ON', BACKS_UP: 'BACKED_UP_BY', BACKED_UP_BY: 'BACKS_UP', MONITORS: 'MONITORED_BY', MONITORED_BY: 'MONITORS' };
      const inverseType = INVERSE_MAP[relationType] ?? relationType;
      await prisma.$transaction([
        prisma.assetRelationship.create({ data: { sourceAssetId: ctx.entityId, targetAssetId: targetId, relationshipType: relationType } }),
        prisma.assetRelationship.create({ data: { sourceAssetId: targetId, targetAssetId: ctx.entityId, relationshipType: inverseType } }),
      ]);
      return { output: 'Success', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'delete-relation',
  category: 'ACTION',
  name: 'Delete Relation',
  description: 'Deletes a relationship between the originating entity and another entity.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { targetEntityId: '', relationType: 'CONTAINS' },
  configSchema: {
    targetEntityId: { type: 'string', label: 'Target Entity ID', description: 'UUID of the target entity.' },
    relationType: { type: 'select', label: 'Relation Type', options: ['CONTAINS', 'FEEDS', 'DEPENDS_ON', 'BACKS_UP', 'MONITORS', 'CONNECTED_TO', 'CUSTOM'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      let targetId = (config.targetEntityId as string) ?? '';
      targetId = resolveTemplate(targetId, ctx, message);
      if (!targetId) return { output: 'Failure', message, log: 'No target entity ID' };
      const relationType = (config.relationType as string) ?? 'CONTAINS';
      await prisma.assetRelationship.deleteMany({
        where: { OR: [
          { sourceAssetId: ctx.entityId, targetAssetId: targetId, relationshipType: relationType },
          { sourceAssetId: targetId, targetAssetId: ctx.entityId },
        ]},
      });
      return { output: 'Success', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'delete-attributes',
  category: 'ACTION',
  name: 'Delete Attributes',
  description: 'Removes specified attributes from the entity in the database.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { scope: 'server', keys: '' },
  configSchema: {
    scope: { type: 'select', label: 'Scope', options: ['server', 'custom'] },
    keys: { type: 'textarea', label: 'Attribute Keys', description: 'Comma-separated attribute keys to delete.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const keys = parseCommaSeparated(config.keys);
      if (keys.length === 0) return { output: 'Failure', message, log: 'No keys specified' };
      const scope = (config.scope as string) ?? 'server';
      const entity = await prisma.assetInstance.findUnique({
        where: { id: ctx.entityId },
        select: { attributes: true, customAttributes: true },
      });
      if (!entity) return { output: 'Failure', message, log: 'Entity not found' };
      if (scope === 'server') {
        const attrs = { ...(entity.attributes as Record<string, unknown> ?? {}) };
        for (const k of keys) delete attrs[k];
        await prisma.assetInstance.update({ where: { id: ctx.entityId }, data: { attributes: attrs as any } });
      } else {
        const attrs = { ...(entity.customAttributes as Record<string, unknown> ?? {}) };
        for (const k of keys) delete attrs[k];
        await prisma.assetInstance.update({ where: { id: ctx.entityId }, data: { customAttributes: attrs as any } });
      }
      return { output: 'Success', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'rpc-call-request',
  category: 'ACTION',
  name: 'RPC Call Request',
  description: 'Sends an RPC request to the entity via MQTT. The entity is expected to reply on the RPC response topic.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { method: '', params: '{}', timeout: 5000 },
  configSchema: {
    method: { type: 'string', label: 'Method', description: 'RPC method name.' },
    params: { type: 'textarea', label: 'Parameters (JSON)', description: 'JSON object of RPC parameters.' },
    timeout: { type: 'number', label: 'Timeout (ms)', description: 'RPC timeout in milliseconds.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    let params: Record<string, unknown> = {};
    try { params = JSON.parse((config.params as string) ?? '{}'); } catch { /* use empty */ }
    return {
      output: 'Success',
      message: { ...message, _rpcRequest: { method: config.method, params, entityId: ctx.entityId, timeout: config.timeout ?? 5000 } },
    };
  },
});

registerNode({
  type: 'save-to-custom-table',
  category: 'ACTION',
  name: 'Save to Custom Table',
  description: 'Saves message data to a custom PostgreSQL table. Used for compliance logging or custom data stores.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { tableName: '', columnMapping: '{}' },
  configSchema: {
    tableName: { type: 'string', label: 'Table Name', description: 'Target PostgreSQL table name (must exist).' },
    columnMapping: { type: 'textarea', label: 'Column Mapping (JSON)', description: 'JSON mapping message keys to table columns (e.g., {"temperature": "temp_value"}).' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    try {
      const tableName = (config.tableName as string) ?? '';
      if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) return { output: 'Failure', message, log: 'Invalid table name' };
      let mapping: Record<string, string>;
      try { mapping = JSON.parse((config.columnMapping as string) ?? '{}'); } catch { return { output: 'Failure', message, log: 'Invalid column mapping JSON' }; }
      const columns = Object.values(mapping).filter((c) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c));
      const values = Object.keys(mapping).map((k) => message[k] ?? null);
      if (columns.length === 0) return { output: 'Failure', message, log: 'No valid columns' };
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      await prisma.$executeRawUnsafe(`INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`, ...values);
      return { output: 'Success', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'generator',
  category: 'ACTION',
  name: 'Generator',
  description: 'Generates synthetic messages using a JavaScript function. Useful for testing and simulation.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { script: 'return { temperature: Math.random() * 100, timestamp: Date.now() };', messageType: 'TELEMETRY' },
  configSchema: {
    script: { type: 'textarea', label: 'Generator Script', description: 'JavaScript that returns the message object to generate.' },
    messageType: { type: 'string', label: 'Message Type', description: 'Type to assign to generated messages.' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    try {
      const script = (config.script as string) ?? 'return {};';
      const generated = safeExecuteScript(script, { msg: message, Math, Date }) as Record<string, unknown>;
      if (generated && typeof generated === 'object') {
        return { output: 'Success', message: { ...generated, _messageType: config.messageType ?? 'TELEMETRY' } };
      }
      return { output: 'Failure', message, log: 'Script did not return an object' };
    } catch (err) {
      return { output: 'Failure', message, log: `Script error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

registerNode({
  type: 'message-count',
  category: 'ACTION',
  name: 'Message Count',
  description: 'Counts messages passing through this node within a time window. Adds count to message.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { windowMs: 60000, countKey: '_messageCount' },
  configSchema: {
    windowMs: { type: 'number', label: 'Window (ms)', description: 'Time window for counting in milliseconds.' },
    countKey: { type: 'string', label: 'Count Key', description: 'Message key to store the count in.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const windowMs = (config.windowMs as number) ?? 60000;
    const countKey = (config.countKey as string) ?? '_messageCount';
    const cacheKey = `${ctx.entityId}:msg-count`;
    const now = Date.now();
    const timestamps = messageCountCache.get(cacheKey) ?? [];
    timestamps.push(now);
    const filtered = timestamps.filter((t) => now - t < windowMs);
    messageCountCache.set(cacheKey, filtered);
    return { output: 'Success', message: { ...message, [countKey]: filtered.length } };
  },
});

registerNode({
  type: 'gps-geofencing-events',
  category: 'ACTION',
  name: 'GPS Geofencing Events',
  description: 'Generates ENTERED/LEFT events when entity GPS coordinates cross geofence boundaries.',
  outputs: ['Entered', 'Left', 'Inside', 'Outside', 'Failure'],
  defaultConfig: { latKey: 'latitude', lngKey: 'longitude', fenceType: 'circle', centerLat: 0, centerLng: 0, radiusMeters: 1000, polygonPoints: '' },
  configSchema: {
    latKey: { type: 'string', label: 'Latitude Key' },
    lngKey: { type: 'string', label: 'Longitude Key' },
    fenceType: { type: 'select', label: 'Fence Type', options: ['circle', 'polygon'] },
    centerLat: { type: 'number', label: 'Center Latitude' },
    centerLng: { type: 'number', label: 'Center Longitude' },
    radiusMeters: { type: 'number', label: 'Radius (meters)' },
    polygonPoints: { type: 'textarea', label: 'Polygon Points (JSON array of [lat,lng])' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const lat = Number(message[(config.latKey as string) ?? 'latitude']);
      const lng = Number(message[(config.lngKey as string) ?? 'longitude']);
      if (isNaN(lat) || isNaN(lng)) return { output: 'Failure', message, log: 'Invalid coordinates' };
      let isInside: boolean;
      if ((config.fenceType as string) === 'polygon') {
        let polygon: [number, number][];
        try { polygon = JSON.parse((config.polygonPoints as string) ?? '[]'); } catch { return { output: 'Failure', message, log: 'Invalid polygon JSON' }; }
        isInside = pointInPolygon(lat, lng, polygon);
      } else {
        const dist = haversineDistance(lat, lng, Number(config.centerLat ?? 0), Number(config.centerLng ?? 0));
        isInside = dist <= Number(config.radiusMeters ?? 1000);
      }
      const stateKey = `${ctx.entityId}:geofence`;
      const wasInside = geofenceStateCache.get(stateKey);
      geofenceStateCache.set(stateKey, isInside);
      if (wasInside === undefined) return { output: isInside ? 'Inside' : 'Outside', message };
      if (wasInside && !isInside) return { output: 'Left', message };
      if (!wasInside && isInside) return { output: 'Entered', message };
      return { output: isInside ? 'Inside' : 'Outside', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'calculated-fields',
  category: 'ACTION',
  name: 'Calculated Fields',
  description: 'Computes new fields from existing message values using configurable JavaScript expressions.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { calculations: '[]' },
  configSchema: {
    calculations: { type: 'textarea', label: 'Calculations (JSON)', description: 'JSON array of {outputKey, expression} objects. Use msg.keyName in expressions.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      let calculations: Array<{ outputKey: string; expression: string }>;
      try { calculations = JSON.parse((config.calculations as string) ?? '[]'); } catch { return { output: 'Failure', message, log: 'Invalid calculations JSON' }; }
      const result = { ...message };
      for (const calc of calculations) {
        try {
          const val = safeExecuteScript(`return ${calc.expression};`, { msg: message, metadata: ctx.metadata, Math });
          result[calc.outputKey] = val;
        } catch (e) {
          result[calc.outputKey] = null;
        }
      }
      return { output: 'Success', message: result };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'connectivity-state',
  category: 'ACTION',
  name: 'Connectivity State',
  description: 'Updates or checks the connectivity state of the originating entity.',
  outputs: ['Connected', 'Disconnected', 'Failure'],
  defaultConfig: { action: 'check' },
  configSchema: {
    action: { type: 'select', label: 'Action', options: ['check', 'set-connected', 'set-disconnected'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const action = (config.action as string) ?? 'check';
      if (action === 'check') {
        const cred = await prisma.deviceCredential.findFirst({
          where: { entityId: ctx.entityId },
          select: { lastConnectedAt: true },
        });
        const isConnected = cred?.lastConnectedAt ? (Date.now() - cred.lastConnectedAt.getTime() < 300000) : false;
        return { output: isConnected ? 'Connected' : 'Disconnected', message };
      }
      if (action === 'set-connected') {
        await prisma.deviceCredential.updateMany({
          where: { entityId: ctx.entityId },
          data: { lastConnectedAt: new Date() },
        });
        return { output: 'Connected', message };
      }
      return { output: 'Disconnected', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'entity-profile-action',
  category: 'ACTION',
  name: 'Entity Profile Action',
  description: 'Applies template-level alarm rules and configurations to the message. Evaluates all alarm rules defined in the entity template.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, ctx): Promise<NodeResult> {
    try {
      const template = await prisma.assetTemplate.findUnique({
        where: { id: ctx.templateId },
        select: { alarmRules: true },
      });
      const rules = (template?.alarmRules as Array<{ type: string; field: string; threshold?: number; severity: string }>) ?? [];
      const alarms: Array<{ entityId: string; alarmType: string; severity: string; details: Record<string, unknown>; clear: boolean }> = [];
      for (const rule of rules) {
        const val = message[rule.field];
        if (val === undefined) continue;
        const numVal = Number(val);
        let triggered = false;
        if (rule.type === 'HIGH' && !isNaN(numVal) && rule.threshold !== undefined) triggered = numVal > rule.threshold;
        else if (rule.type === 'LOW' && !isNaN(numVal) && rule.threshold !== undefined) triggered = numVal < rule.threshold;
        else if (rule.type === 'HIGH_HIGH' && !isNaN(numVal) && rule.threshold !== undefined) triggered = numVal > rule.threshold;
        else if (rule.type === 'LOW_LOW' && !isNaN(numVal) && rule.threshold !== undefined) triggered = numVal < rule.threshold;
        else if (rule.type === 'BOOLEAN_STATE') triggered = Boolean(val);
        const alarmType = `${rule.type}_${rule.field}`;
        if (triggered) {
          alarms.push({ entityId: ctx.entityId, alarmType, severity: rule.severity ?? 'WARNING', details: { field: rule.field, value: val, threshold: rule.threshold, ruleType: rule.type }, clear: false });
        } else {
          alarms.push({ entityId: ctx.entityId, alarmType, severity: 'INFO', details: { field: rule.field, value: val }, clear: true });
        }
      }
      return { output: 'Success', message, alarms };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'change-entity-status',
  category: 'ACTION',
  name: 'Change Entity Status',
  description: 'Updates the status of the originating entity.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { status: 'Active' },
  configSchema: {
    status: { type: 'select', label: 'New Status', options: ['Active', 'Inactive', 'Under Maintenance', 'Decommissioned', 'Quarantine'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const status = (config.status as string) ?? 'Active';
      await prisma.assetInstance.update({ where: { id: ctx.entityId }, data: { status } });
      return { output: 'Success', message: { ...message, _entityStatus: status } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

// ═══════════════════════════════════════════════════════
// EXTERNAL NODES
// ═══════════════════════════════════════════════════════

registerNode({
  type: 'rest-api-call',
  category: 'EXTERNAL',
  name: 'REST API Call',
  description: 'HTTP request to an external service. Supports all HTTP methods, custom headers, and timeout.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { url: '', method: 'POST', headers: '{}', timeout: 5000 },
  configSchema: {
    url: { type: 'string', label: 'URL', description: 'Target URL. Supports ${entityName}, ${metadata.key} variables.' },
    method: { type: 'select', label: 'Method', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    headers: { type: 'textarea', label: 'Headers (JSON)', description: 'Custom HTTP headers as JSON object.' },
    timeout: { type: 'number', label: 'Timeout (ms)', description: 'Request timeout in milliseconds.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const url = resolveTemplate((config.url as string) ?? '', ctx, message);
      if (!url) return { output: 'Failure', message, log: 'No URL configured' };
      const method = (config.method as string) ?? 'POST';
      let headers: Record<string, string> = {};
      try { headers = typeof config.headers === 'string' ? JSON.parse(config.headers) : (config.headers as Record<string, string>) ?? {}; } catch { /* use empty */ }
      const timeout = (config.timeout as number) ?? 5000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: method !== 'GET' ? JSON.stringify(message) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!response.ok) return { output: 'Failure', message, log: `HTTP ${response.status}: ${response.statusText}` };
      const responseData = await response.json().catch(() => ({}));
      return { output: 'Success', message: { ...message, _apiResponse: responseData } };
    } catch (err) {
      return { output: 'Failure', message, log: `API call error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
});

registerNode({
  type: 'mqtt-publish',
  category: 'EXTERNAL',
  name: 'MQTT Publish',
  description: 'Publish to a custom MQTT topic.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { topic: '', qos: 0, retain: false },
  configSchema: {
    topic: { type: 'string', label: 'Topic', description: 'MQTT topic. Supports ${entityName}, ${unsPath} variables.' },
    qos: { type: 'select', label: 'QoS', options: ['0', '1', '2'] },
    retain: { type: 'boolean', label: 'Retain', description: 'Retain message on broker.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const topic = resolveTemplate((config.topic as string) ?? '', ctx, message);
    return {
      output: 'Success',
      message: { ...message, _mqttPublish: { topic, qos: Number(config.qos ?? 0), retain: config.retain ?? false } },
    };
  },
});

registerNode({
  type: 'push-to-uns',
  category: 'EXTERNAL',
  name: 'Push to UNS',
  description: 'Publish data to a UNS path.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { unsPath: '' },
  configSchema: {
    unsPath: { type: 'string', label: 'UNS Path', description: 'Target UNS path (empty = entity default path).' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const unsPath = (config.unsPath as string) || ctx.unsPath;
    return { output: 'Success', message: { ...message, _unsPublish: { path: unsPath } } };
  },
});

registerNode({
  type: 'send-email',
  category: 'EXTERNAL',
  name: 'Send Email',
  description: 'Format and enqueue email notification.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { to: '', subject: '', body: '' },
  configSchema: {
    to: { type: 'string', label: 'To', description: 'Recipient email address.' },
    subject: { type: 'string', label: 'Subject', description: 'Email subject.' },
    body: { type: 'textarea', label: 'Body', description: 'Email body. Supports ${entityName} variables.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const notification = {
      type: 'EMAIL',
      title: resolveTemplate((config.subject as string) ?? '', ctx, message),
      message: resolveTemplate((config.body as string) ?? '', ctx, message),
      metadata: { to: config.to, entityId: ctx.entityId },
    };
    return { output: 'Success', message, notifications: [notification] };
  },
});

// --- NEW EXTERNAL NODES ---

registerNode({
  type: 'send-sms',
  category: 'EXTERNAL',
  name: 'Send SMS',
  description: 'Sends an SMS via a configured provider (Twilio, AWS SNS, or custom API).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { provider: 'twilio', phoneNumber: '', messageTemplate: 'Alert from ${entityName}', accountSid: '', authToken: '', fromNumber: '' },
  configSchema: {
    provider: { type: 'select', label: 'Provider', options: ['twilio', 'aws-sns', 'custom-api'] },
    phoneNumber: { type: 'string', label: 'To Phone Number', description: 'Target phone number.' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'SMS message. Supports ${entityName} variables.' },
    accountSid: { type: 'string', label: 'Account SID (Twilio)', description: 'Twilio account SID.' },
    authToken: { type: 'string', label: 'Auth Token', description: 'Provider auth token.' },
    fromNumber: { type: 'string', label: 'From Number', description: 'Sender phone number.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const smsBody = resolveTemplate((config.messageTemplate as string) ?? '', ctx, message);
      const provider = (config.provider as string) ?? 'twilio';
      if (provider === 'twilio') {
        const accountSid = (config.accountSid as string) ?? '';
        const authToken = (config.authToken as string) ?? '';
        if (!accountSid || !authToken) return { output: 'Failure', message, log: 'Missing Twilio credentials' };
        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
          body: new URLSearchParams({ To: (config.phoneNumber as string) ?? '', From: (config.fromNumber as string) ?? '', Body: smsBody }).toString(),
        });
        if (!response.ok) return { output: 'Failure', message, log: `Twilio: ${response.status}` };
      }
      return { output: 'Success', message: { ...message, _smsSent: true } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'send-to-slack',
  category: 'EXTERNAL',
  name: 'Send to Slack',
  description: 'Sends a message to a Slack channel via webhook URL.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { webhookUrl: '', channel: '', messageTemplate: 'Alert: ${entityName}', username: 'DigiLog' },
  configSchema: {
    webhookUrl: { type: 'string', label: 'Webhook URL', description: 'Slack incoming webhook URL.' },
    channel: { type: 'string', label: 'Channel', description: 'Override channel (optional).' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'Supports ${entityName}, ${msg.key} variables.' },
    username: { type: 'string', label: 'Bot Username' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const webhookUrl = (config.webhookUrl as string) ?? '';
      if (!webhookUrl) return { output: 'Failure', message, log: 'No webhook URL' };
      const text = resolveTemplate((config.messageTemplate as string) ?? '', ctx, message);
      const payload: Record<string, string> = { text };
      if (config.channel) payload.channel = config.channel as string;
      if (config.username) payload.username = config.username as string;
      const response = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) return { output: 'Failure', message, log: `Slack: ${response.status}` };
      return { output: 'Success', message };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'aws-sns',
  category: 'EXTERNAL',
  name: 'AWS SNS',
  description: 'Publishes a message to an Amazon SNS topic.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { topicArn: '', region: 'ap-south-1', messageTemplate: '' },
  configSchema: {
    topicArn: { type: 'string', label: 'Topic ARN' },
    region: { type: 'string', label: 'AWS Region' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'Supports ${entityName} variables. Empty = full message JSON.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const body = (config.messageTemplate as string) ? resolveTemplate(config.messageTemplate as string, ctx, message) : JSON.stringify(message);
    return { output: 'Success', message: { ...message, _awsSns: { topicArn: config.topicArn, region: config.region, body } } };
  },
});

registerNode({
  type: 'aws-sqs',
  category: 'EXTERNAL',
  name: 'AWS SQS',
  description: 'Sends a message to an Amazon SQS queue.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { queueUrl: '', region: 'ap-south-1', messageTemplate: '' },
  configSchema: {
    queueUrl: { type: 'string', label: 'Queue URL' },
    region: { type: 'string', label: 'AWS Region' },
    messageTemplate: { type: 'textarea', label: 'Message Template', description: 'Supports ${entityName} variables. Empty = full message JSON.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const body = (config.messageTemplate as string) ? resolveTemplate(config.messageTemplate as string, ctx, message) : JSON.stringify(message);
    return { output: 'Success', message: { ...message, _awsSqs: { queueUrl: config.queueUrl, region: config.region, body } } };
  },
});

registerNode({
  type: 'aws-lambda',
  category: 'EXTERNAL',
  name: 'AWS Lambda',
  description: 'Invokes an AWS Lambda function and returns its response.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { functionName: '', region: 'ap-south-1', invocationType: 'RequestResponse' },
  configSchema: {
    functionName: { type: 'string', label: 'Function Name' },
    region: { type: 'string', label: 'AWS Region' },
    invocationType: { type: 'select', label: 'Invocation Type', options: ['RequestResponse', 'Event'] },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _awsLambda: { functionName: config.functionName, region: config.region, invocationType: config.invocationType, payload: message } } };
  },
});

registerNode({
  type: 'kafka',
  category: 'EXTERNAL',
  name: 'Kafka',
  description: 'Publishes a message to a Kafka topic.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { bootstrapServers: '', topic: '', key: '', acks: 'all' },
  configSchema: {
    bootstrapServers: { type: 'string', label: 'Bootstrap Servers', description: 'Comma-separated host:port pairs.' },
    topic: { type: 'string', label: 'Topic' },
    key: { type: 'string', label: 'Message Key', description: 'Partition key (defaults to entityId).' },
    acks: { type: 'select', label: 'Acks', options: ['0', '1', 'all'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _kafkaPublish: { bootstrapServers: config.bootstrapServers, topic: config.topic, key: (config.key as string) || ctx.entityId, acks: config.acks } } };
  },
});

registerNode({
  type: 'rabbitmq',
  category: 'EXTERNAL',
  name: 'RabbitMQ',
  description: 'Publishes a message to a RabbitMQ exchange.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { host: 'localhost', port: 5672, exchange: '', routingKey: '', username: 'guest', password: 'guest', exchangeType: 'direct' },
  configSchema: {
    host: { type: 'string', label: 'Host' },
    port: { type: 'number', label: 'Port' },
    exchange: { type: 'string', label: 'Exchange Name' },
    routingKey: { type: 'string', label: 'Routing Key' },
    username: { type: 'string', label: 'Username' },
    password: { type: 'string', label: 'Password' },
    exchangeType: { type: 'select', label: 'Exchange Type', options: ['direct', 'fanout', 'topic', 'headers'] },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _rabbitmqPublish: { host: config.host, port: config.port, exchange: config.exchange, routingKey: config.routingKey, exchangeType: config.exchangeType } } };
  },
});

registerNode({
  type: 'ai-request',
  category: 'EXTERNAL',
  name: 'AI Request',
  description: 'Sends message data to an AI/LLM API (OpenAI, Claude, etc.) for analysis.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { provider: 'openai', apiUrl: 'https://api.openai.com/v1/chat/completions', apiKey: '', model: 'gpt-3.5-turbo', promptTemplate: 'Analyze this sensor data: ${messageJson}', maxTokens: 200, timeout: 30000 },
  configSchema: {
    provider: { type: 'select', label: 'Provider', options: ['openai', 'anthropic', 'custom'] },
    apiUrl: { type: 'string', label: 'API URL' },
    apiKey: { type: 'string', label: 'API Key' },
    model: { type: 'string', label: 'Model' },
    promptTemplate: { type: 'textarea', label: 'Prompt Template', description: 'Use ${messageJson}, ${entityName} variables.' },
    maxTokens: { type: 'number', label: 'Max Tokens' },
    timeout: { type: 'number', label: 'Timeout (ms)' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const apiUrl = (config.apiUrl as string) ?? '';
      const apiKey = (config.apiKey as string) ?? '';
      if (!apiUrl || !apiKey) return { output: 'Failure', message, log: 'Missing API URL or key' };
      const prompt = resolveTemplate((config.promptTemplate as string) ?? '', ctx, message);
      const provider = (config.provider as string) ?? 'openai';
      const timeout = (config.timeout as number) ?? 30000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      let body: string;
      let headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (provider === 'anthropic') {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        body = JSON.stringify({ model: config.model ?? 'claude-sonnet-4-20250514', max_tokens: config.maxTokens ?? 200, messages: [{ role: 'user', content: prompt }] });
      } else {
        headers['Authorization'] = `Bearer ${apiKey}`;
        body = JSON.stringify({ model: config.model ?? 'gpt-3.5-turbo', max_tokens: config.maxTokens ?? 200, messages: [{ role: 'user', content: prompt }] });
      }
      const response = await fetch(apiUrl, { method: 'POST', headers, body, signal: controller.signal });
      clearTimeout(timer);
      if (!response.ok) return { output: 'Failure', message, log: `AI API: ${response.status}` };
      const data = await response.json();
      const aiText = provider === 'anthropic' ? data?.content?.[0]?.text : data?.choices?.[0]?.message?.content;
      return { output: 'Success', message: { ...message, _aiResponse: aiText ?? '' } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

// ═══════════════════════════════════════════════════════
// FLOW NODES
// ═══════════════════════════════════════════════════════

registerNode({
  type: 'rule-chain-input',
  category: 'FLOW',
  name: 'Rule Chain Input',
  description: 'Enter another rule chain (increments depth counter).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { targetChainId: '' },
  configSchema: {
    targetChainId: {
      type: 'rule-chain-select',
      label: 'Target Rule Chain',
      description: 'Select the rule chain to delegate execution to.',
    },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    const targetChainId = config.targetChainId as string;
    if (!targetChainId) return { output: 'Failure', message, log: 'No target chain ID configured' };
    if (ctx.chainDepth >= ctx.maxChainDepth) return { output: 'Failure', message, log: 'Max chain depth exceeded' };
    return { output: 'Success', message: { ...message, _delegateChain: targetChainId, _chainDepth: ctx.chainDepth + 1 } };
  },
});

registerNode({
  type: 'checkpoint',
  category: 'FLOW',
  name: 'Checkpoint',
  description: 'Force-save current state before continuing.',
  outputs: ['Success', 'Failure'],
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _checkpoint: true } };
  },
});

registerNode({
  type: 'delay',
  category: 'FLOW',
  name: 'Delay',
  description: 'Wait N milliseconds then continue.',
  outputs: ['Success'],
  defaultConfig: { delayMs: 1000, maxDelayMs: 10000 },
  configSchema: {
    delayMs: { type: 'number', label: 'Delay (ms)', description: 'Delay duration in milliseconds.' },
    maxDelayMs: { type: 'number', label: 'Max Delay (ms)', description: 'Maximum delay cap in milliseconds.' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    const delayMs = Math.min((config.delayMs as number) ?? 1000, (config.maxDelayMs as number) ?? 10000);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return { output: 'Success', message };
  },
});

registerNode({
  type: 'acknowledge',
  category: 'FLOW',
  name: 'Acknowledge',
  description: 'Mark message as acknowledged (stop further processing on this branch).',
  outputs: [],
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _acknowledged: true } };
  },
});

// --- NEW FLOW NODE ---

registerNode({
  type: 'output',
  category: 'FLOW',
  name: 'Output',
  description: 'Terminal node that marks the end of a sub-chain and returns the message to the parent chain.',
  outputs: [],
  defaultConfig: { outputName: 'default' },
  configSchema: {
    outputName: { type: 'string', label: 'Output Name', description: 'Name for this output point (used by parent chain to route).' },
  },
  async execute(message, config, _ctx): Promise<NodeResult> {
    return { output: 'Success', message: { ...message, _subChainOutput: config.outputName ?? 'default' } };
  },
});

// ═══════════════════════════════════════════════════════
// ANALYTICS NODES
// ═══════════════════════════════════════════════════════

registerNode({
  type: 'aggregate-latest',
  category: 'ANALYTICS',
  name: 'Aggregate Latest',
  description: 'Aggregates latest telemetry values from related entities (MIN, MAX, AVG, SUM, COUNT).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { relationType: 'CONTAINS', direction: 'source', telemetryKey: '', aggregation: 'AVG', outputKey: '' },
  configSchema: {
    relationType: { type: 'select', label: 'Relation Type', options: ['CONTAINS', 'CONTAINED_IN', 'FEEDS', 'DEPENDS_ON', 'MONITORS', 'CONNECTED_TO'] },
    direction: { type: 'select', label: 'Direction', options: ['source', 'target'] },
    telemetryKey: { type: 'string', label: 'Telemetry Key', description: 'Key to aggregate from related entities.' },
    aggregation: { type: 'select', label: 'Aggregation', options: ['MIN', 'MAX', 'AVG', 'SUM', 'COUNT'] },
    outputKey: { type: 'string', label: 'Output Key', description: 'Key to store the aggregated value.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const relationType = (config.relationType as string) ?? 'CONTAINS';
      const direction = (config.direction as string) ?? 'source';
      const telemetryKey = (config.telemetryKey as string) ?? '';
      const aggregation = (config.aggregation as string) ?? 'AVG';
      const outputKey = (config.outputKey as string) || `_agg_${telemetryKey}`;
      if (!telemetryKey) return { output: 'Failure', message, log: 'No telemetry key specified' };
      const where = direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType }
        : { targetAssetId: ctx.entityId, relationshipType: relationType };
      const rels = await prisma.assetRelationship.findMany({
        where,
        select: direction === 'source' ? { targetAssetId: true } : { sourceAssetId: true },
        take: 100,
      });
      const entityIds = rels.map((r: any) => direction === 'source' ? r.targetAssetId : r.sourceAssetId);
      if (entityIds.length === 0) return { output: 'Success', message: { ...message, [outputKey]: null } };
      const telemetry = await prisma.latestTelemetry.findMany({ where: { entityId: { in: entityIds }, key: telemetryKey } });
      const values = telemetry.map((t) => Number(t.valueNum ?? t.valueStr)).filter((v) => !isNaN(v));
      let result: number | null = null;
      if (values.length > 0) {
        if (aggregation === 'MIN') result = Math.min(...values);
        else if (aggregation === 'MAX') result = Math.max(...values);
        else if (aggregation === 'SUM') result = values.reduce((a, b) => a + b, 0);
        else if (aggregation === 'AVG') result = values.reduce((a, b) => a + b, 0) / values.length;
        else if (aggregation === 'COUNT') result = values.length;
      }
      return { output: 'Success', message: { ...message, [outputKey]: result } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'aggregate-stream',
  category: 'ANALYTICS',
  name: 'Aggregate Stream',
  description: 'Sliding window aggregation over incoming telemetry values (MIN, MAX, AVG, SUM, COUNT, STDDEV).',
  outputs: ['Success', 'Failure'],
  defaultConfig: { keys: '', windowMs: 300000, aggregation: 'AVG' },
  configSchema: {
    keys: { type: 'textarea', label: 'Telemetry Keys', description: 'Comma-separated keys to aggregate.' },
    windowMs: { type: 'number', label: 'Window (ms)', description: 'Sliding window size in milliseconds.' },
    aggregation: { type: 'select', label: 'Aggregation', options: ['MIN', 'MAX', 'AVG', 'SUM', 'COUNT', 'STDDEV'] },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const keys = parseCommaSeparated(config.keys);
      const windowMs = (config.windowMs as number) ?? 300000;
      const aggregation = (config.aggregation as string) ?? 'AVG';
      const now = Date.now();
      const result = { ...message };
      for (const key of keys) {
        const val = Number(message[key]);
        if (isNaN(val)) continue;
        const cacheKey = `${ctx.entityId}:${key}:stream`;
        const buffer = aggregateStreamCache.get(cacheKey) ?? [];
        buffer.push({ value: val, ts: now });
        const filtered = buffer.filter((e) => now - e.ts < windowMs);
        aggregateStreamCache.set(cacheKey, filtered);
        const values = filtered.map((e) => e.value);
        if (values.length > 0) {
          if (aggregation === 'MIN') result[`_agg_${key}`] = Math.min(...values);
          else if (aggregation === 'MAX') result[`_agg_${key}`] = Math.max(...values);
          else if (aggregation === 'SUM') result[`_agg_${key}`] = values.reduce((a, b) => a + b, 0);
          else if (aggregation === 'COUNT') result[`_agg_${key}`] = values.length;
          else if (aggregation === 'STDDEV') {
            const avg = values.reduce((a, b) => a + b, 0) / values.length;
            result[`_agg_${key}`] = Math.sqrt(values.reduce((a, b) => a + (b - avg) ** 2, 0) / values.length);
          } else { // AVG
            result[`_agg_${key}`] = values.reduce((a, b) => a + b, 0) / values.length;
          }
        }
      }
      return { output: 'Success', message: result };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'alarms-count',
  category: 'ANALYTICS',
  name: 'Alarms Count',
  description: 'Counts active alarms for the originating entity, grouped by severity.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { includeAcknowledged: false },
  configSchema: {
    includeAcknowledged: { type: 'boolean', label: 'Include Acknowledged', description: 'Count ACKNOWLEDGED alarms in addition to ACTIVE.' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const statuses = ['ACTIVE'];
      if (config.includeAcknowledged) statuses.push('ACKNOWLEDGED');
      const alarms = await prisma.alarm.findMany({
        where: { entityId: ctx.entityId, status: { in: statuses } },
        select: { severity: true },
      });
      const counts: Record<string, number> = { total: alarms.length, CRITICAL: 0, WARNING: 0, ALARM: 0 };
      for (const a of alarms) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
      return { output: 'Success', message: { ...message, _alarmCount: counts.total, _alarmCount_CRITICAL: counts.CRITICAL, _alarmCount_WARNING: counts.WARNING, _alarmCount_ALARM: counts.ALARM } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

registerNode({
  type: 'entity-count',
  category: 'ANALYTICS',
  name: 'Entity Count',
  description: 'Counts child entities or related entities of the originator, optionally filtered by template or status.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { countType: 'children', templateFilter: '', statusFilter: '' },
  configSchema: {
    countType: { type: 'select', label: 'Count Type', options: ['children', 'related'] },
    templateFilter: { type: 'string', label: 'Template Filter', description: 'Only count entities of this template name (empty = all).' },
    statusFilter: { type: 'string', label: 'Status Filter', description: 'Only count entities with this status (empty = all).' },
  },
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const countType = (config.countType as string) ?? 'children';
      const templateFilter = (config.templateFilter as string) ?? '';
      const statusFilter = (config.statusFilter as string) ?? '';
      let count = 0;
      if (countType === 'children') {
        const where: Record<string, unknown> = { parentId: ctx.entityId, isActive: true };
        if (statusFilter) where.status = statusFilter;
        if (templateFilter) {
          const template = await prisma.assetTemplate.findFirst({ where: { name: templateFilter }, select: { id: true } });
          if (template) where.templateId = template.id;
        }
        count = await prisma.assetInstance.count({ where: where as any });
      } else {
        const where: Record<string, unknown> = { sourceAssetId: ctx.entityId };
        const rels = await prisma.assetRelationship.findMany({
          where: where as any,
          select: { targetAssetId: true },
          take: 1000,
        });
        const entityIds = rels.map((r) => r.targetAssetId);
        if (entityIds.length > 0) {
          const entityWhere: Record<string, unknown> = { id: { in: entityIds }, isActive: true };
          if (statusFilter) entityWhere.status = statusFilter;
          if (templateFilter) {
            const template = await prisma.assetTemplate.findFirst({ where: { name: templateFilter }, select: { id: true } });
            if (template) entityWhere.templateId = template.id;
          }
          count = await prisma.assetInstance.count({ where: entityWhere as any });
        }
      }
      return { output: 'Success', message: { ...message, _entityCount: count } };
    } catch (err) {
      return { output: 'Failure', message, log: String(err) };
    }
  },
});

// Export for explicit initialization
// Email & SMS Notification Nodes
import './email-notification-node.js';
import './sms-notification-node.js';

export function initializeNodes(): void {
  // All nodes are registered on import via registerNode() calls above
}
