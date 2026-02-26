/**
 * Entity Resolver — Token → DeviceCredential → Entity + Template + UnsMapping
 * Caches results in-memory with a 30-second TTL.
 */

import { prisma } from '../../lib/prisma.js';

export interface ResolvedEntity {
  credentialId: string;
  entityId: string;
  entityName: string;
  templateId: string;
  templateName: string;
  unsPath: string;
  ruleChainId: string | null;
  isActive: boolean;
}

interface CacheEntry {
  data: ResolvedEntity;
  expiresAt: number;
}

const CACHE_TTL_MS = 30_000; // 30 seconds
const cache = new Map<string, CacheEntry>();

/**
 * Resolve a device access token to its entity, template, and UNS mapping.
 * Returns null if the token is invalid, entity is inactive, or template is missing.
 */
export async function resolveEntityByToken(accessToken: string): Promise<ResolvedEntity | null> {
  // Check cache first
  const now = Date.now();
  const cached = cache.get(accessToken);
  if (cached && cached.expiresAt > now) {
    return cached.data;
  }

  // Lookup credential
  const credential = await prisma.deviceCredential.findUnique({
    where: { accessToken },
  });

  if (!credential || credential.status !== 'ACTIVE' || !credential.isActive) {
    return null;
  }

  // Lookup entity instance
  const entity = await prisma.assetInstance.findUnique({
    where: { id: credential.entityId },
    include: { template: true },
  });

  if (!entity || !entity.isActive) {
    return null;
  }

  if (!entity.template) {
    return null;
  }

  // Lookup UNS mapping
  const unsMapping = await prisma.unsMapping.findUnique({
    where: { entityId: entity.id },
  });

  const resolved: ResolvedEntity = {
    credentialId: credential.id,
    entityId: entity.id,
    entityName: entity.name,
    templateId: entity.template.id,
    templateName: entity.template.name,
    unsPath: unsMapping?.unsPath ?? entity.unsPath ?? '',
    ruleChainId: entity.template.defaultRuleChainId,
    isActive: entity.isActive,
  };

  // Cache result
  cache.set(accessToken, {
    data: resolved,
    expiresAt: now + CACHE_TTL_MS,
  });

  return resolved;
}

/**
 * Resolve a credential ID to its entity details (used by MQTT handler).
 */
export async function resolveEntityByCredentialId(credentialId: string): Promise<ResolvedEntity | null> {
  const credential = await prisma.deviceCredential.findUnique({
    where: { id: credentialId },
  });

  if (!credential || !credential.accessToken) {
    return null;
  }

  return resolveEntityByToken(credential.accessToken);
}

/**
 * Invalidate a specific cache entry by token.
 */
export function invalidateEntityCache(accessToken: string): void {
  cache.delete(accessToken);
}

/**
 * Clear the entire entity resolver cache.
 */
export function clearEntityCache(): void {
  cache.clear();
}
