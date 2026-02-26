/**
 * Node Registry — Maps node type strings to their implementations.
 */

import type { NodeDefinition } from './types.js';

const registry = new Map<string, NodeDefinition>();

export function registerNode(node: NodeDefinition): void {
  registry.set(node.type, node);
}

export function getNode(type: string): NodeDefinition | undefined {
  return registry.get(type);
}

export function getAllNodes(): NodeDefinition[] {
  return Array.from(registry.values());
}

export function getNodesByCategory(category: string): NodeDefinition[] {
  return Array.from(registry.values()).filter((n) => n.category === category);
}
