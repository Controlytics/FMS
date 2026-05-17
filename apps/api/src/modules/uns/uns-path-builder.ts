/**
 * UNS Path Builder — Generates ISA-95 hierarchical paths for entities.
 * Path format: digilog/v1/{Enterprise}/{Site}/{Area}/{Line}/{Cell}/{EntityName}
 * Handles gaps: if levels are skipped, they're omitted from the path.
 */

import { prisma } from '../../lib/prisma.js';

/** ISA-95 levels in order */
const ISA95_LEVELS = ['Enterprise', 'Site', 'Area', 'Line', 'Cell'] as const;

/** UNS path prefix */
const UNS_PREFIX = 'digilog/v1';

/** Topic suffixes for publish/subscribe */
const TOPIC_SUFFIXES = {
  telemetry: '/telemetry',
  attributes: '/attributes',
  rpc: '/rpc',
  events: '/events',
  binary: '/binary',
} as const;

/** Sanitize a name for use in a UNS path segment */
export function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')       // spaces → hyphens
    .replace(/[^a-z0-9\-_]/g, '') // strip special chars
    .replace(/-+/g, '-')         // collapse multiple hyphens
    .replace(/^-|-$/g, '');      // trim leading/trailing hyphens
}

/** Build the UNS path for an entity by walking up the hierarchy */
export async function buildUnsPath(entityId: string): Promise<{
  unsPath: string;
  pathSegments: Record<string, string>;
  topics: { publish: string[]; subscribe: string[] };
}> {
  // Walk up the parent chain collecting segments
  const segments: Array<{ name: string; category: string }> = [];
  let currentId: string | null = entityId;

  while (currentId) {
    const entity: { name: string; parentId: string | null; template: { category: string } } | null =
      await prisma.assetInstance.findUnique({
        where: { id: currentId },
        select: {
          name: true,
          parentId: true,
          template: { select: { category: true } },
        },
      });

    if (!entity) break;

    segments.unshift({
      name: entity.name,
      category: entity.template.category,
    });

    currentId = entity.parentId;
  }

  if (segments.length === 0) {
    throw new Error(`Entity ${entityId} not found`);
  }

  // Map segments to ISA-95 levels based on template category or position
  const pathSegments: Record<string, string> = {};
  const pathParts: string[] = [UNS_PREFIX];

  for (const seg of segments) {
    const sanitized = sanitizeName(seg.name);
    const level = mapCategoryToLevel(seg.category);
    if (level) {
      pathSegments[level] = sanitized;
    }
    pathParts.push(sanitized);
  }

  const unsPath = pathParts.join('/');

  // Build topic sets
  const topics = {
    publish: Object.values(TOPIC_SUFFIXES).map((suffix) => `${unsPath}${suffix}`),
    subscribe: [
      `${unsPath}/#`,        // Subscribe to all sub-topics
      ...Object.values(TOPIC_SUFFIXES).map((suffix) => `${unsPath}${suffix}`),
    ],
  };

  return { unsPath, pathSegments, topics };
}

/** Build the path for an entity given specific data (without DB lookup) */
export function buildUnsPathFromSegments(
  ancestors: Array<{ name: string; category: string }>,
  entityName: string,
  entityCategory: string,
): string {
  const parts = [UNS_PREFIX];
  for (const ancestor of ancestors) {
    parts.push(sanitizeName(ancestor.name));
  }
  parts.push(sanitizeName(entityName));
  return parts.join('/');
}

/** Map template category to ISA-95 level */
function mapCategoryToLevel(category: string): string | null {
  const normalized = category.toLowerCase();
  for (const level of ISA95_LEVELS) {
    if (normalized.includes(level.toLowerCase())) {
      return level;
    }
  }
  // Fallback: generic entity level
  return null;
}

/** Check if an MQTT topic matches a wildcard pattern */
export function matchWildcard(pattern: string, topic: string): boolean {
  const patternParts = pattern.split('/');
  const topicParts = topic.split('/');

  for (let i = 0; i < patternParts.length; i++) {
    const pat = patternParts[i];

    if (pat === '#') {
      // Multi-level wildcard — matches everything from here
      return true;
    }

    if (pat === '+') {
      // Single-level wildcard — matches exactly one level
      if (i >= topicParts.length) return false;
      continue;
    }

    // Exact match required
    if (i >= topicParts.length || pat !== topicParts[i]) {
      return false;
    }
  }

  // Pattern exhausted — topic must be same length
  return patternParts.length === topicParts.length;
}

/** Get all descendant entity IDs for an entity */
export async function getDescendantIds(entityId: string): Promise<string[]> {
  const descendants: string[] = [];
  const queue = [entityId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const children = await prisma.assetInstance.findMany({
      where: { parentId: currentId, isActive: true },
      select: { id: true },
    });

    for (const child of children) {
      descendants.push(child.id);
      queue.push(child.id);
    }
  }

  return descendants;
}
