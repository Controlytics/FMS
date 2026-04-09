/**
 * Node Implementations — Helper utilities and initialization entry point.
 * Category-specific node registrations are in separate files.
 */

import vm from 'node:vm';
import type { NodeContext } from '../types.js';

import { registerInputNodes } from './input-nodes.js';
import { registerFilterNodes } from './filter-nodes.js';
import { registerEnrichmentNodes } from './enrichment-nodes.js';
import { registerTransformationNodes } from './transformation-nodes.js';
import { registerActionNodes } from './action-nodes.js';
import { registerExternalNodes } from './external-nodes.js';
import { registerFlowNodes } from './flow-nodes.js';
import { registerAnalyticsNodes } from './analytics-nodes.js';

// Email & SMS Notification Nodes
import './email-notification-node.js';
import './sms-notification-node.js';

// ═══════════════════════════════════════════════════════
// HELPER UTILITIES
// ═══════════════════════════════════════════════════════

/**
 * Execute user-supplied script in a sandboxed vm context.
 * WARNING: Node.js vm is not a true security boundary. Rule-chain script editing
 * MUST be restricted to SUPER_ADMIN role only. For full isolation, migrate to isolated-vm.
 * Mitigations applied: frozen prototype chain, no constructor access, timeout.
 */
export function safeExecuteScript(code: string, sandbox: Record<string, unknown>, timeout = 1000): unknown {
  // Block common prototype-chain escape patterns
  const blockedPatterns = ['constructor', 'prototype', '__proto__', 'process', 'require', 'mainModule', 'globalThis', 'global'];
  for (const pattern of blockedPatterns) {
    if (code.includes(pattern)) {
      throw new Error(`Blocked: script contains forbidden keyword "${pattern}"`);
    }
  }
  const safeSandbox = Object.create(null);
  Object.assign(safeSandbox, sandbox);
  // Freeze to prevent prototype traversal
  Object.freeze(Object.getPrototypeOf(safeSandbox) ?? {});
  const ctx = vm.createContext(safeSandbox);
  const script = new vm.Script(`'use strict'; (function(){ ${code} })()`, { filename: 'user-script.js' });
  return script.runInContext(ctx, { timeout });
}

/** Template variable resolution: replaces ${entityName}, ${metadata.key}, ${messageJson} */
export function resolveTemplate(template: string, ctx: NodeContext, message: Record<string, unknown>): string {
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
export function parseCommaSeparated(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Haversine distance between two GPS points in meters */
export function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Point-in-polygon using ray casting algorithm */
export function pointInPolygon(lat: number, lng: number, polygon: [number, number][]): boolean {
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
export function resolvePath(obj: Record<string, unknown>, path: string): unknown {
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
export const dedupCache = new LRUCache<string, number>(10000, 300000);
export const messageCountCache = new Map<string, number[]>();
export const geofenceStateCache = new Map<string, boolean>();
export const aggregateStreamCache = new Map<string, Array<{ value: number; ts: number }>>();


// ============================================================
// INITIALIZATION
// ============================================================

export function initializeNodes(): void {
  registerInputNodes();
  registerFilterNodes();
  registerEnrichmentNodes();
  registerTransformationNodes();
  registerActionNodes();
  registerExternalNodes();
  registerFlowNodes();
  registerAnalyticsNodes();
}
