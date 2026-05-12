/**
 * Enrichment Node Registrations
 */

import { registerNode } from '../node-registry.js';
import type { NodeResult } from '../types.js';
import { prisma } from '../../../lib/prisma.js';
import { parseCommaSeparated } from './index.js';

export function registerEnrichmentNodes(): void {

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
      const where = (direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType as any }
        : { targetAssetId: ctx.entityId, relationshipType: relationType as any });
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
      const meta: Record<string, string> = { ...ctx.metadata };
      for (const c of configs) meta[`sys_${c.configKey}`] = String(c.configValue).slice(0, 200);
      return { output: 'Success', message, metadata: meta };
    } catch {
      const meta = { ...ctx.metadata };
      return { output: 'Success', message, metadata: meta };
    }
  },
});

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
      const where = (direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType as any }
        : { targetAssetId: ctx.entityId, relationshipType: relationType as any });
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

}
