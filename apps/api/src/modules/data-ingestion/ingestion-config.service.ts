/**
 * Ingestion Config Service — Reads from IngestionSystemConfig table.
 * 10-second in-memory cache TTL. Used throughout the pipeline for operational limits.
 * Separate from the main config.service.ts which handles SystemConfig (UI configs).
 */

import { prisma } from '../../lib/prisma.js';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const CACHE_TTL_MS = 10_000; // 10 seconds
const cache = new Map<string, CacheEntry>();

/** Get a typed config value. Throws if key not found. */
export async function getConfig<T = unknown>(key: string): Promise<T> {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.value as T;
  }

  const config = await prisma.ingestionSystemConfig.findUnique({ where: { key } });
  if (!config) {
    throw new Error(`Config key not found: ${key}`);
  }

  const parsed = parseConfigValue(config.value, config.dataType);
  cache.set(key, { value: parsed, expiresAt: now + CACHE_TTL_MS });
  return parsed as T;
}

/** Get a config value with a default fallback (no throw). */
export async function getConfigOrDefault<T = unknown>(key: string, defaultValue: T): Promise<T> {
  try {
    return await getConfig<T>(key);
  } catch {
    return defaultValue;
  }
}

/** Set a config value. Validates min/max if applicable. */
export async function setConfig(key: string, value: unknown, userId: string): Promise<void> {
  const config = await prisma.ingestionSystemConfig.findUnique({ where: { key } });
  if (!config) {
    throw new Error(`Config key not found: ${key}`);
  }

  const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

  // Validate min/max for numeric types
  if (config.dataType === 'INTEGER' || config.dataType === 'FLOAT') {
    const numVal = Number(value);
    if (isNaN(numVal)) throw new Error(`Config ${key}: expected numeric value`);
    if (config.minValue !== null) {
      const min = Number(config.minValue);
      if (numVal < min) throw new Error(`Config ${key}: value ${numVal} below minimum ${min}`);
    }
    if (config.maxValue !== null) {
      const max = Number(config.maxValue);
      if (numVal > max) throw new Error(`Config ${key}: value ${numVal} above maximum ${max}`);
    }
  }

  await prisma.ingestionSystemConfig.update({
    where: { key },
    data: { value: stringValue, updatedBy: userId },
  });

  // Invalidate cache
  cache.delete(key);
}

/** Invalidate a specific cache entry. */
export function invalidateConfigCache(key: string): void {
  cache.delete(key);
}

/** Clear the entire config cache. */
export function clearConfigCache(): void {
  cache.clear();
}

function parseConfigValue(value: string, dataType: string): unknown {
  switch (dataType) {
    case 'INTEGER': return parseInt(value, 10);
    case 'FLOAT': return parseFloat(value);
    case 'BOOLEAN': return value === 'true' || value === '1';
    case 'JSON': {
      try { return JSON.parse(value); } catch { return value; }
    }
    case 'STRING':
    default:
      try { return JSON.parse(value); } catch { return value; }
  }
}
