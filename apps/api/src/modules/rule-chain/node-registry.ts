/**
 * Node Registry — Maps node type strings to their implementations.
 */

import type { NodeDefinition } from './types.js';

const registry = new Map<string, NodeDefinition>();

/**
 * Backward-compat aliases for node-type strings that existed in pre-rename
 * `rule_nodes` rows. The kebab-case naming convention was adopted between
 * 2026-05-04 and 2026-05-12; any rule_node rows authored before then carry
 * snake_case `type` values that don't match the current registry keys.
 *
 * Without these aliases, `getNode('log_action')` returns undefined and the
 * rule engine emits `ERR_NODE_TYPE_UNKNOWN` for every legacy chain — see
 * rule-engine.ts:170. The chain then follows the Failure edge and the node
 * effectively becomes a no-op.
 *
 * Each entry maps `legacy snake_case` → `current kebab-case` registry key.
 * Keep this list intentionally short; the goal is "old fixtures keep
 * working," not "permit indefinite stylistic drift." When a row known to
 * use a legacy type is migrated or deleted, drop its entry here.
 *
 * Verified 2026-05-13: only `log_action` and `msg_type_filter` ever appear
 * in DB rows authored against pre-rename code (see deep review).
 */
const LEGACY_TYPE_ALIASES: Record<string, string> = {
  log_action: 'log',
  msg_type_filter: 'msg-type-filter',
};

export function registerNode(node: NodeDefinition): void {
  registry.set(node.type, node);
}

export function getNode(type: string): NodeDefinition | undefined {
  // Try the type as-given first (current registry keys).
  const direct = registry.get(type);
  if (direct) return direct;
  // Fall back to the legacy alias map for pre-rename `rule_nodes` rows.
  const aliased = LEGACY_TYPE_ALIASES[type];
  if (aliased) return registry.get(aliased);
  return undefined;
}

export function getAllNodes(): NodeDefinition[] {
  return Array.from(registry.values());
}

export function getNodesByCategory(category: string): NodeDefinition[] {
  return Array.from(registry.values()).filter((n) => n.category === category);
}
