/**
 * Filter Node Registrations
 */

import { registerNode } from '../node-registry.js';
import type { NodeResult } from '../types.js';
import { prisma } from '../../../lib/prisma.js';
import { safeExecuteScript, parseCommaSeparated, haversineDistance, pointInPolygon } from './index.js';

export function registerFilterNodes(): void {

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

}
