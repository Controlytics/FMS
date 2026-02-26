/**
 * Default Chain Builder — Auto-creates a default rule chain when an
 * AssetTemplate is created or updated with alarm rules.
 *
 * Generates: input -> (script-filter -> create-alarm) per rule -> save-timeseries
 */

import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';

// ─── Types ──────────────────────────────────────────────

interface AlarmRule {
  name: string;
  type: string;
  severity?: string;
  sourceField?: string;
  condition?: string;
  threshold?: number;
  deadband?: number;
  message?: string;
  notifyRoles?: string[];
  enabled?: boolean;
}

function parseAlarmRules(raw: unknown[]): AlarmRule[] {
  return raw.filter((r): r is AlarmRule => {
    if (typeof r !== 'object' || r === null) return false;
    const obj = r as Record<string, unknown>;
    return typeof obj.name === 'string' && typeof obj.type === 'string';
  });
}

// ─── Node Builder Helpers ───────────────────────────────

/** Build script-filter configuration for an alarm threshold check. */
function buildFilterConfig(rule: AlarmRule): Record<string, unknown> {
  // Build a JS expression that evaluates the alarm condition against the message
  const field = rule.sourceField ?? 'value';
  const condition = rule.condition ?? '>';
  const threshold = rule.threshold ?? 0;

  return {
    scriptBody: `return msg['${field}'] ${condition} ${threshold};`,
    sourceField: field,
    condition,
    threshold,
    alarmType: rule.type,
    alarmName: rule.name,
  };
}

/** Build create-alarm action configuration. */
function buildAlarmConfig(rule: AlarmRule): Record<string, unknown> {
  return {
    alarmType: rule.name,
    severity: rule.severity ?? 'ALARM',
    ruleType: rule.type,
    sourceField: rule.sourceField ?? 'value',
    condition: rule.condition ?? '>',
    threshold: rule.threshold ?? 0,
    deadband: rule.deadband ?? 0,
    message: rule.message ?? `Alarm: ${rule.name}`,
    notifyRoles: rule.notifyRoles ?? [],
    enabled: rule.enabled !== false,
  };
}

// ─── Layout Constants ───────────────────────────────────

const NODE_SPACING_X = 250;
const NODE_SPACING_Y = 150;

// ─── Build Nodes & Connections ──────────────────────────

interface BuiltGraph {
  nodes: Array<{
    type: string;
    name: string;
    configuration: Prisma.InputJsonValue;
    positionX: number;
    positionY: number;
  }>;
  /** Connections expressed as [fromIndex, toIndex, label] */
  connections: Array<[number, number, string]>;
  firstNodeIndex: number;
}

function buildGraph(alarmRules: AlarmRule[]): BuiltGraph {
  const nodes: BuiltGraph['nodes'] = [];
  const connections: BuiltGraph['connections'] = [];

  // 0: Input node
  const inputIdx = 0;
  nodes.push({
    type: 'input',
    name: 'Input',
    configuration: {} as Prisma.InputJsonValue,
    positionX: 0,
    positionY: 0,
  });

  // For each alarm rule: script-filter + create-alarm
  let col = 1;
  for (let i = 0; i < alarmRules.length; i++) {
    const rule = alarmRules[i];
    const yOffset = i * NODE_SPACING_Y;

    // Filter node
    const filterIdx = nodes.length;
    nodes.push({
      type: 'script-filter',
      name: `Filter: ${rule.name}`,
      configuration: buildFilterConfig(rule) as Prisma.InputJsonValue,
      positionX: col * NODE_SPACING_X,
      positionY: yOffset,
    });

    // Alarm action node
    const alarmIdx = nodes.length;
    nodes.push({
      type: 'create-alarm',
      name: `Alarm: ${rule.name}`,
      configuration: buildAlarmConfig(rule) as Prisma.InputJsonValue,
      positionX: (col + 1) * NODE_SPACING_X,
      positionY: yOffset,
    });

    // Input -> Filter (Success)
    connections.push([inputIdx, filterIdx, 'Success']);

    // Filter -> Create Alarm (True — condition matched)
    connections.push([filterIdx, alarmIdx, 'True']);
  }

  // Save-timeseries node at the end
  const saveIdx = nodes.length;
  const saveCol = alarmRules.length > 0 ? 3 : 1;
  nodes.push({
    type: 'save-timeseries',
    name: 'Save Timeseries',
    configuration: { defaultTTL: 0 } as unknown as Prisma.InputJsonValue,
    positionX: saveCol * NODE_SPACING_X,
    positionY: Math.floor(((alarmRules.length - 1) * NODE_SPACING_Y) / 2),
  });

  // Input -> Save Timeseries (Success) — always save regardless of alarms
  connections.push([inputIdx, saveIdx, 'Success']);

  // Each create-alarm -> Save Timeseries (Success) — continue pipeline
  for (let i = 0; i < alarmRules.length; i++) {
    const alarmIdx = 1 + i * 2 + 1; // filter is at 1+i*2, alarm at 1+i*2+1
    connections.push([alarmIdx, saveIdx, 'Success']);
  }

  return { nodes, connections, firstNodeIndex: inputIdx };
}

// ─── Snapshot Builder ───────────────────────────────────

function buildSnapshot(
  chainId: string,
  chainName: string,
  nodeRecords: Array<{ id: string; type: string; name: string; configuration: unknown; positionX: number; positionY: number }>,
  connectionRecords: Array<{ id: string; fromNodeId: string; toNodeId: string; label: string }>,
  firstNodeId: string | null,
  version: number,
): Prisma.InputJsonValue {
  return {
    chainId,
    name: chainName,
    version,
    nodes: nodeRecords.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      configuration: n.configuration,
      positionX: n.positionX,
      positionY: n.positionY,
    })),
    connections: connectionRecords.map((c) => ({
      id: c.id,
      fromNodeId: c.fromNodeId,
      toNodeId: c.toNodeId,
      label: c.label,
    })),
    firstRuleNodeId: firstNodeId,
    exportedAt: new Date().toISOString(),
  } as unknown as Prisma.InputJsonValue;
}

// ─── Public API ─────────────────────────────────────────

/**
 * Create a default rule chain for a template with alarm rules.
 * Returns the chain ID, or null if no alarm rules are provided.
 */
export async function createDefaultRuleChain(
  templateId: string,
  templateName: string,
  alarmRules?: unknown[],
): Promise<string | null> {
  if (!alarmRules || alarmRules.length === 0) return null;

  const parsed = parseAlarmRules(alarmRules);
  if (parsed.length === 0) return null;

  const graph = buildGraph(parsed);
  const chainName = `Default: ${templateName}`;

  return prisma.$transaction(async (tx) => {
    // 1. Create the rule chain (without firstRuleNodeId for now)
    const chain = await tx.ruleChain.create({
      data: {
        name: chainName,
        description: `Auto-generated default rule chain for template "${templateName}"`,
        isRoot: true,
        isSystem: true,
        configuration: { templateId } as unknown as Prisma.InputJsonValue,
        currentVersion: 1,
      },
    });

    // 2. Create all nodes
    const createdNodes: Array<{
      id: string;
      type: string;
      name: string;
      configuration: unknown;
      positionX: number;
      positionY: number;
    }> = [];

    for (const nodeDef of graph.nodes) {
      const node = await tx.ruleNode.create({
        data: {
          ruleChainId: chain.id,
          type: nodeDef.type,
          name: nodeDef.name,
          configuration: nodeDef.configuration,
          positionX: nodeDef.positionX,
          positionY: nodeDef.positionY,
        },
      });
      createdNodes.push({
        id: node.id,
        type: node.type,
        name: node.name,
        configuration: node.configuration,
        positionX: node.positionX,
        positionY: node.positionY,
      });
    }

    // 3. Set firstRuleNodeId to the input node
    const firstNodeId = createdNodes[graph.firstNodeIndex].id;
    await tx.ruleChain.update({
      where: { id: chain.id },
      data: { firstRuleNodeId: firstNodeId },
    });

    // 4. Create connections
    const createdConnections: Array<{
      id: string;
      fromNodeId: string;
      toNodeId: string;
      label: string;
    }> = [];

    for (const [fromIdx, toIdx, label] of graph.connections) {
      const conn = await tx.ruleNodeConnection.create({
        data: {
          ruleChainId: chain.id,
          fromNodeId: createdNodes[fromIdx].id,
          toNodeId: createdNodes[toIdx].id,
          label,
        },
      });
      createdConnections.push({
        id: conn.id,
        fromNodeId: conn.fromNodeId,
        toNodeId: conn.toNodeId,
        label: conn.label,
      });
    }

    // 5. Create initial version snapshot
    const snapshot = buildSnapshot(
      chain.id,
      chainName,
      createdNodes,
      createdConnections,
      firstNodeId,
      1,
    );

    await tx.ruleChainVersion.create({
      data: {
        ruleChainId: chain.id,
        version: 1,
        snapshot: snapshot as Prisma.InputJsonValue,
        status: 'ACTIVE',
        createdBy: 'SYSTEM',
        changeNotes: 'Auto-generated from template alarm rules',
      },
    });

    return chain.id;
  });
}

/**
 * Update an existing default rule chain when alarm rules change.
 * Deletes all existing nodes/connections and recreates them.
 * Increments the chain version and creates a new snapshot.
 */
export async function updateDefaultRuleChain(
  chainId: string,
  templateName: string,
  alarmRules: unknown[],
): Promise<void> {
  const parsed = parseAlarmRules(alarmRules);
  const graph = buildGraph(parsed);
  const chainName = `Default: ${templateName}`;

  await prisma.$transaction(async (tx) => {
    // 1. Fetch the current chain to get version number
    const existing = await tx.ruleChain.findUniqueOrThrow({
      where: { id: chainId },
    });

    const newVersion = existing.currentVersion + 1;

    // 2. Delete existing connections and nodes (order matters for FK constraints)
    await tx.ruleNodeConnection.deleteMany({
      where: { ruleChainId: chainId },
    });
    await tx.ruleNode.deleteMany({
      where: { ruleChainId: chainId },
    });

    // 3. Clear firstRuleNodeId before recreating nodes
    await tx.ruleChain.update({
      where: { id: chainId },
      data: { firstRuleNodeId: null },
    });

    // 4. Create all new nodes
    const createdNodes: Array<{
      id: string;
      type: string;
      name: string;
      configuration: unknown;
      positionX: number;
      positionY: number;
    }> = [];

    for (const nodeDef of graph.nodes) {
      const node = await tx.ruleNode.create({
        data: {
          ruleChainId: chainId,
          type: nodeDef.type,
          name: nodeDef.name,
          configuration: nodeDef.configuration,
          positionX: nodeDef.positionX,
          positionY: nodeDef.positionY,
        },
      });
      createdNodes.push({
        id: node.id,
        type: node.type,
        name: node.name,
        configuration: node.configuration,
        positionX: node.positionX,
        positionY: node.positionY,
      });
    }

    // 5. Set firstRuleNodeId to input node
    const firstNodeId = createdNodes[graph.firstNodeIndex].id;
    await tx.ruleChain.update({
      where: { id: chainId },
      data: {
        name: chainName,
        firstRuleNodeId: firstNodeId,
        currentVersion: newVersion,
      },
    });

    // 6. Create connections
    const createdConnections: Array<{
      id: string;
      fromNodeId: string;
      toNodeId: string;
      label: string;
    }> = [];

    for (const [fromIdx, toIdx, label] of graph.connections) {
      const conn = await tx.ruleNodeConnection.create({
        data: {
          ruleChainId: chainId,
          fromNodeId: createdNodes[fromIdx].id,
          toNodeId: createdNodes[toIdx].id,
          label,
        },
      });
      createdConnections.push({
        id: conn.id,
        fromNodeId: conn.fromNodeId,
        toNodeId: conn.toNodeId,
        label: conn.label,
      });
    }

    // 7. Mark previous versions as SUPERSEDED
    await tx.ruleChainVersion.updateMany({
      where: { ruleChainId: chainId, status: 'ACTIVE' },
      data: { status: 'SUPERSEDED' },
    });

    // 8. Create new version snapshot
    const snapshot = buildSnapshot(
      chainId,
      chainName,
      createdNodes,
      createdConnections,
      firstNodeId,
      newVersion,
    );

    await tx.ruleChainVersion.create({
      data: {
        ruleChainId: chainId,
        version: newVersion,
        snapshot: snapshot as Prisma.InputJsonValue,
        status: 'ACTIVE',
        createdBy: 'SYSTEM',
        changeNotes: `Updated from template alarm rules (v${newVersion})`,
      },
    });
  });
}
