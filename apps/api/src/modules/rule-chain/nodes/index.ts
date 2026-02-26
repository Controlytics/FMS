/**
 * Node Implementations — All rule chain node types.
 * Auto-registered when imported.
 */

import { registerNode } from '../node-registry.js';
import { prisma } from '../../../lib/prisma.js';
import type { NodeDefinition, RuleNodeConfig, NodeContext, NodeResult } from '../types.js';

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
      const fn = new Function('msg', 'metadata', 'msgType', script);
      const result = fn(message, ctx.metadata, message._messageType ?? '');
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
  async execute(message, config, ctx): Promise<NodeResult> {
    try {
      const templateNames = (config.templateNames as string[]) ?? [];
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
    const meta = { ...ctx.metadata, tenantId: 'default' };
    return { output: 'Success', message, metadata: meta };
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
      const fn = new Function('msg', 'metadata', 'msgType', script);
      const result = fn({ ...message }, ctx.metadata, message._messageType ?? '');
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
      }
      return { output: 'Failure', message, log: 'No parent entity found' };
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
  defaultConfig: { subject: 'Alert: ${entityName}', body: 'Data received from ${entityName}', to: '' },
  async execute(message, config, ctx): Promise<NodeResult> {
    const subject = (config.subject as string ?? '').replace('${entityName}', ctx.entityName);
    const body = (config.body as string ?? '').replace('${entityName}', ctx.entityName);
    const emailMsg = {
      ...message,
      _email: { to: config.to, subject, body, entityId: ctx.entityId },
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
          const fn = new Function('x', `return ${conv.formula};`);
          result[conv.key] = fn(val);
        }
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
  defaultConfig: {},
  async execute(message, _config, _ctx): Promise<NodeResult> {
    // Actual save happens in Stage 9 — this node signals the pipeline to save as telemetry
    return { output: 'Success', message: { ...message, _saveAs: 'telemetry' } };
  },
});

registerNode({
  type: 'save-attributes',
  category: 'ACTION',
  name: 'Save Attributes',
  description: 'Save data to entity attributes.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { scope: 'server' },
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
  defaultConfig: { alarmType: 'THRESHOLD', severity: 'WARNING', detailsScript: '' },
  async execute(message, config, ctx): Promise<NodeResult> {
    const alarm = {
      entityId: ctx.entityId,
      alarmType: (config.alarmType as string) ?? 'THRESHOLD',
      severity: (config.severity as string) ?? 'WARNING',
      details: message,
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
  async execute(message, config, ctx): Promise<NodeResult> {
    const alarm = {
      entityId: ctx.entityId,
      alarmType: (config.alarmType as string) ?? 'THRESHOLD',
      severity: 'INFO',
      clear: true,
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
  async execute(message, config, ctx): Promise<NodeResult> {
    const title = (config.title as string ?? '').replace('${entityName}', ctx.entityName);
    const msg = (config.messageTemplate as string ?? '').replace('${entityName}', ctx.entityName);
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
  async execute(message, config, ctx): Promise<NodeResult> {
    const meta = { ...ctx.metadata, assignedTo: (config.userId as string) ?? '' };
    return { output: 'Success', message, metadata: meta };
  },
});

registerNode({
  type: 'log',
  category: 'ACTION',
  name: 'Log',
  description: 'Write to server log (debug only).',
  outputs: ['Success'],
  defaultConfig: { level: 'info', template: 'Rule chain log: ${entityName}' },
  async execute(message, config, ctx): Promise<NodeResult> {
    const template = (config.template as string ?? '').replace('${entityName}', ctx.entityName);
    console.log(`[RuleChain:Log] ${template}`, JSON.stringify(message).slice(0, 200));
    return { output: 'Success', message, log: template };
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
    // RPC reply is handled by the transport layer — this just marks the message
    return { output: 'Success', message: { ...message, _rpcReply: true } };
  },
});

// ═══════════════════════════════════════════════════════
// EXTERNAL NODES
// ═══════════════════════════════════════════════════════

registerNode({
  type: 'rest-api-call',
  category: 'EXTERNAL',
  name: 'REST API Call',
  description: 'HTTP request to an external service.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { url: '', method: 'POST', headers: {}, timeout: 5000 },
  async execute(message, config, _ctx): Promise<NodeResult> {
    try {
      const url = config.url as string;
      if (!url) return { output: 'Failure', message, log: 'No URL configured' };
      const method = (config.method as string) ?? 'POST';
      const headers = (config.headers as Record<string, string>) ?? {};
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

      if (!response.ok) {
        return { output: 'Failure', message, log: `HTTP ${response.status}: ${response.statusText}` };
      }

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
  async execute(message, config, _ctx): Promise<NodeResult> {
    // MQTT publish is deferred — mark for the pipeline to handle
    const topic = (config.topic as string) ?? '';
    return {
      output: 'Success',
      message: { ...message, _mqttPublish: { topic, qos: config.qos ?? 0, retain: config.retain ?? false } },
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
  async execute(message, config, ctx): Promise<NodeResult> {
    const unsPath = (config.unsPath as string) || ctx.unsPath;
    return {
      output: 'Success',
      message: { ...message, _unsPublish: { path: unsPath } },
    };
  },
});

registerNode({
  type: 'send-email',
  category: 'EXTERNAL',
  name: 'Send Email',
  description: 'Format and enqueue email notification.',
  outputs: ['Success', 'Failure'],
  defaultConfig: { to: '', subject: '', body: '' },
  async execute(message, config, ctx): Promise<NodeResult> {
    const notification = {
      type: 'EMAIL',
      title: ((config.subject as string) ?? '').replace('${entityName}', ctx.entityName),
      message: ((config.body as string) ?? '').replace('${entityName}', ctx.entityName),
      metadata: { to: config.to, entityId: ctx.entityId },
    };
    return { output: 'Success', message, notifications: [notification] };
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
  async execute(message, config, ctx): Promise<NodeResult> {
    const targetChainId = config.targetChainId as string;
    if (!targetChainId) {
      return { output: 'Failure', message, log: 'No target chain ID configured' };
    }
    if (ctx.chainDepth >= ctx.maxChainDepth) {
      return { output: 'Failure', message, log: 'Max chain depth exceeded' };
    }
    // The actual sub-chain execution is handled by rule-engine.ts
    // This node just marks the message for delegation
    return {
      output: 'Success',
      message: { ...message, _delegateChain: targetChainId, _chainDepth: ctx.chainDepth + 1 },
    };
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
  async execute(message, config, _ctx): Promise<NodeResult> {
    const delayMs = Math.min(
      (config.delayMs as number) ?? 1000,
      (config.maxDelayMs as number) ?? 10000,
    );
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

// Export for explicit initialization
export function initializeNodes(): void {
  // All nodes are registered on import via registerNode() calls above
}
