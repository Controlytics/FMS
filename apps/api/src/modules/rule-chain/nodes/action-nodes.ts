/**
 * Action Node Registrations
 */

import { registerNode } from '../node-registry.js';
import type { NodeResult } from '../types.js';
import { prisma } from '../../../lib/prisma.js';
import { safeExecuteScript, resolveTemplate, parseCommaSeparated, haversineDistance, pointInPolygon, messageCountCache, geofenceStateCache } from './index.js';

export function registerActionNodes(): void {

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
    const level = (config.level as string) ?? 'info';
    const logFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    logFn(`[RuleChain:Log] ${logMsg}`, JSON.stringify(message).slice(0, 200));
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
      // Security: only allow telemetry/timeseries tables — block access to application tables
      const ALLOWED_TABLE_PREFIXES = ['ts_', 'telemetry_', 'timeseries_', 'custom_'];
      if (!ALLOWED_TABLE_PREFIXES.some(p => tableName.startsWith(p))) {
        return { output: 'Failure', message, log: `Table "${tableName}" not allowed. Only tables starting with: ${ALLOWED_TABLE_PREFIXES.join(', ')}` };
      }
      let mapping: Record<string, string>;
      try { mapping = JSON.parse((config.columnMapping as string) ?? '{}'); } catch { return { output: 'Failure', message, log: 'Invalid column mapping JSON' }; }
      const validEntries = Object.entries(mapping).filter(([, c]) => typeof c === 'string' && /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(c));
      if (validEntries.length === 0) return { output: 'Failure', message, log: 'No valid columns' };
      const columns = validEntries.map(([, c]) => c);
      const values = validEntries.map(([k]) => message[k] ?? null);
      const columnList = columns.map(c => `"${c}"`).join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      await prisma.$executeRawUnsafe(`INSERT INTO "${tableName}" (${columnList}) VALUES (${placeholders})`, ...values);
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

}
