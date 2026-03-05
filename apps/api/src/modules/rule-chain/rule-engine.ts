/**
 * Rule Engine — Executes a rule chain graph against an ingestion message.
 * Loads chain from cache/DB, traverses nodes via connections, handles errors.
 */

import { prisma } from '../../lib/prisma.js';
import { getConfigOrDefault } from '../data-ingestion/ingestion-config.service.js';
import { getNode } from './node-registry.js';
import { recordDebug } from './debug-recorder.js';
import type {
  RuleEngineResult,
  NodeContext,
  NodeOutput,
  AlarmAction,
  NotificationAction,
  RuleNodeConfig,
} from './types.js';

// ─── Chain Cache ────────────────────────────────────────

interface CachedChain {
  chainId: string;
  firstNodeId: string | null;
  nodes: Map<string, {
    id: string;
    type: string;
    name: string;
    config: RuleNodeConfig;
    debugEnabled: boolean;
  }>;
  connections: Map<string, Array<{ toNodeId: string; label: string }>>;
  expiresAt: number;
}

const CHAIN_CACHE_TTL = 30_000; // 30 seconds
const chainCache = new Map<string, CachedChain>();

async function loadChain(chainId: string): Promise<CachedChain | null> {
  const now = Date.now();
  const cached = chainCache.get(chainId);
  if (cached && cached.expiresAt > now) return cached;

  const chain = await prisma.ruleChain.findUnique({
    where: { id: chainId },
    include: {
      nodes: true,
      connections: true,
    },
  });

  if (!chain || !chain.isActive) return null;

  const nodes = new Map<string, { id: string; type: string; name: string; config: RuleNodeConfig; debugEnabled: boolean }>();
  for (const node of chain.nodes) {
    nodes.set(node.id, {
      id: node.id,
      type: node.type,
      name: node.name,
      config: (node.configuration as RuleNodeConfig) ?? {},
      debugEnabled: node.debugEnabled,
    });
  }

  const connections = new Map<string, Array<{ toNodeId: string; label: string }>>();
  for (const conn of chain.connections) {
    const existing = connections.get(conn.fromNodeId) ?? [];
    existing.push({ toNodeId: conn.toNodeId, label: conn.label });
    connections.set(conn.fromNodeId, existing);
  }

  const entry: CachedChain = {
    chainId,
    firstNodeId: chain.firstRuleNodeId,
    nodes,
    connections,
    expiresAt: now + CHAIN_CACHE_TTL,
  };

  chainCache.set(chainId, entry);
  return entry;
}

// ─── Engine Execution ───────────────────────────────────

export async function executeRuleChain(
  message: Record<string, unknown>,
  metadata: Record<string, string>,
  ruleChainId: string,
  entityContext: {
    entityId: string;
    entityName: string;
    templateId: string;
    unsPath: string;
  },
  chainDepth: number = 0,
): Promise<RuleEngineResult> {
  const startTime = Date.now();
  const alarms: AlarmAction[] = [];
  const notifications: NotificationAction[] = [];
  const errors: string[] = [];
  let nodesExecuted = 0;
  let currentMsg = { ...message };
  let currentMeta = { ...metadata };

  const maxChainDepth = await getConfigOrDefault<number>('rule_engine.max_chain_depth', 10);

  if (chainDepth >= maxChainDepth) {
    return {
      success: false,
      message: currentMsg,
      metadata: currentMeta,
      alarms,
      notifications,
      errors: [`ERR_MAX_CHAIN_DEPTH: Exceeded maximum chain depth of ${maxChainDepth}`],
      nodesExecuted,
      durationMs: Date.now() - startTime,
    };
  }

  const chain = await loadChain(ruleChainId);
  if (!chain || !chain.firstNodeId) {
    // No chain or no first node — pass through (fail-safe)
    return {
      success: true,
      message: currentMsg,
      metadata: currentMeta,
      alarms,
      notifications,
      errors: [],
      nodesExecuted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const ctx: NodeContext = {
    entityId: entityContext.entityId,
    entityName: entityContext.entityName,
    templateId: entityContext.templateId,
    unsPath: entityContext.unsPath,
    metadata: currentMeta,
    chainDepth,
    maxChainDepth,
    debugEnabled: false,
  };

  // Traverse the graph starting from firstNodeId
  const visited = new Set<string>();
  const queue: Array<{ nodeId: string; msg: Record<string, unknown> }> = [
    { nodeId: chain.firstNodeId, msg: currentMsg },
  ];

  while (queue.length > 0) {
    const { nodeId, msg } = queue.shift()!;

    // Prevent infinite loops
    const visitKey = `${nodeId}-${nodesExecuted}`;
    if (visited.has(visitKey) && nodesExecuted > 100) {
      errors.push('ERR_LOOP_DETECTED: Too many node executions');
      break;
    }
    visited.add(visitKey);

    const nodeDef = chain.nodes.get(nodeId);
    if (!nodeDef) {
      errors.push(`ERR_NODE_NOT_FOUND: Node ${nodeId} not in chain`);
      continue;
    }

    const nodeImpl = getNode(nodeDef.type);
    if (!nodeImpl) {
      errors.push(`ERR_NODE_TYPE_UNKNOWN: Unknown node type ${nodeDef.type}`);
      // Follow Failure output
      const failConns = (chain.connections.get(nodeId) ?? []).filter((c) => c.label === 'Failure');
      for (const conn of failConns) {
        queue.push({ nodeId: conn.toNodeId, msg });
      }
      continue;
    }

    ctx.debugEnabled = nodeDef.debugEnabled;
    const nodeStart = Date.now();

    try {
      const result = await nodeImpl.execute(msg, nodeDef.config, ctx);
      nodesExecuted++;

      currentMsg = result.message as Record<string, unknown>;
      if (result.metadata) {
        currentMeta = { ...currentMeta, ...result.metadata };
        ctx.metadata = currentMeta;
      }
      if (result.alarms) alarms.push(...result.alarms);
      if (result.notifications) notifications.push(...result.notifications);

      // Handle sub-chain delegation
      if (currentMsg._delegateChain) {
        const targetChainId = currentMsg._delegateChain as string;
        const subDepth = (currentMsg._chainDepth as number) ?? chainDepth + 1;
        // Clean delegation markers before passing to sub-chain
        const { _delegateChain, _chainDepth, ...cleanMsg } = currentMsg;
        currentMsg = cleanMsg;

        const subResult = await executeRuleChain(
          cleanMsg,
          currentMeta,
          targetChainId,
          entityContext,
          subDepth,
        );
        // Merge sub-chain results
        currentMsg = subResult.message;
        currentMeta = { ...currentMeta, ...subResult.metadata };
        ctx.metadata = currentMeta;
        alarms.push(...subResult.alarms);
        notifications.push(...subResult.notifications);
        errors.push(...subResult.errors);
        nodesExecuted += subResult.nodesExecuted;
      }

      // Debug recording
      if (nodeDef.debugEnabled) {
        recordDebug(ruleChainId, {
          nodeId,
          nodeType: nodeDef.type,
          nodeName: nodeDef.name,
          inputMsg: msg,
          outputMsg: currentMsg,
          output: result.output,
          durationMs: Date.now() - nodeStart,
          timestamp: new Date().toISOString(),
        });
      }

      // Follow the matching output connections
      const outConns = (chain.connections.get(nodeId) ?? []).filter((c) => c.label === result.output);
      for (const conn of outConns) {
        queue.push({ nodeId: conn.toNodeId, msg: currentMsg });
      }
    } catch (err) {
      nodesExecuted++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      errors.push(`ERR_NODE_${nodeDef.type}: ${errorMsg}`);

      if (nodeDef.debugEnabled) {
        recordDebug(ruleChainId, {
          nodeId,
          nodeType: nodeDef.type,
          nodeName: nodeDef.name,
          inputMsg: msg,
          outputMsg: msg,
          output: 'Failure',
          durationMs: Date.now() - nodeStart,
          timestamp: new Date().toISOString(),
          error: errorMsg,
        });
      }

      // Route to Failure output
      const failConns = (chain.connections.get(nodeId) ?? []).filter((c) => c.label === 'Failure');
      if (failConns.length > 0) {
        for (const conn of failConns) {
          queue.push({ nodeId: conn.toNodeId, msg });
        }
      }
      // If no Failure connection, the error is recorded but processing stops for this branch
    }
  }

  return {
    success: errors.length === 0,
    message: currentMsg,
    metadata: currentMeta,
    alarms,
    notifications,
    errors,
    nodesExecuted,
    durationMs: Date.now() - startTime,
  };
}

/** Clear the chain cache (used when chains are updated). */
export function invalidateChainCache(chainId?: string): void {
  if (chainId) {
    chainCache.delete(chainId);
  } else {
    chainCache.clear();
  }
}
