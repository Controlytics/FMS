/**
 * Analytics Node Registrations
 */

import { registerNode } from '../node-registry.js';
import type { NodeResult } from '../types.js';
import { prisma } from '../../../lib/prisma.js';
import { parseCommaSeparated, aggregateStreamCache } from './index.js';

export function registerAnalyticsNodes(): void {

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
      const where = (direction === 'source'
        ? { sourceAssetId: ctx.entityId, relationshipType: relationType as any }
        : { targetAssetId: ctx.entityId, relationshipType: relationType as any });
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

}
