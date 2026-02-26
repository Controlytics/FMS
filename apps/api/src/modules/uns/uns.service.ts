/**
 * UNS Service — manages UNS mappings, auto-provisioning, cascade moves, and search.
 */

import { prisma } from '../../lib/prisma.js';
import { Prisma } from '@prisma/client';
import { buildUnsPath, getDescendantIds, matchWildcard } from './uns-path-builder.js';

// ─── Types ─────────────────────────────────────────────────────────

export type ImpactReport = Array<{
  entityId: string;
  entityName: string;
  oldPath: string;
  newPath: string;
}>;

export type UnsTreeNode = {
  name: string;
  level: string;
  path: string;
  entityId?: string;
  childCount: number;
  children: UnsTreeNode[];
};

// ─── Provisioning ──────────────────────────────────────────────────

/**
 * Build and persist UNS mapping for an entity.
 * Upserts the UnsMapping row (entityId is unique),
 * updates the entity's unsPath on AssetInstance,
 * and syncs DeviceCredential allowedTopics when applicable.
 */
export async function provisionUnsMapping(entityId: string): Promise<void> {
  const { unsPath, pathSegments, topics } = await buildUnsPath(entityId);

  // Upsert UnsMapping (entityId is unique constraint)
  await prisma.unsMapping.upsert({
    where: { entityId },
    create: {
      entityId,
      unsPath,
      pathSegments: pathSegments as Prisma.InputJsonValue,
      isOverridden: false,
    },
    update: {
      unsPath,
      pathSegments: pathSegments as Prisma.InputJsonValue,
    },
  });

  // Update the entity's cached unsPath
  await prisma.assetInstance.update({
    where: { id: entityId },
    data: { unsPath },
  });

  // If the entity's template has dataIngestionEnabled, update DeviceCredential allowedTopics
  const entity = await prisma.assetInstance.findUnique({
    where: { id: entityId },
    select: { template: { select: { dataIngestionEnabled: true } } },
  });

  if (entity?.template.dataIngestionEnabled) {
    const allTopics = [...topics.publish, ...topics.subscribe];
    await prisma.deviceCredential.updateMany({
      where: { entityId },
      data: {
        credentialData: { allowedTopics: allTopics } as Prisma.InputJsonValue,
      },
    });
  }
}

/**
 * Remove UNS mapping for an entity and clear its cached unsPath.
 */
export async function removeUnsMapping(entityId: string): Promise<void> {
  await prisma.unsMapping.deleteMany({
    where: { entityId },
  });

  await prisma.assetInstance.update({
    where: { id: entityId },
    data: { unsPath: null },
  });
}

// ─── Cascade Move ──────────────────────────────────────────────────

/**
 * Calculate the impact of moving an entity to a new parent.
 * Returns a preview of old/new paths for the entity and all descendants.
 */
export async function generateMoveImpact(
  entityId: string,
  newParentId: string | null,
): Promise<ImpactReport> {
  const report: ImpactReport = [];

  // Get the entity itself
  const entity = await prisma.assetInstance.findUnique({
    where: { id: entityId },
    select: { id: true, name: true, unsPath: true },
  });
  if (!entity) {
    throw new Error(`Entity ${entityId} not found`);
  }

  // Build ancestors list for the new parent to compute what new prefix would be
  const newParentAncestors = await getAncestorSegments(newParentId);

  // Compute new path for the entity itself
  const entityData = await buildEntityPathData(entityId);
  const newEntityPath = buildPathFromAncestors(newParentAncestors, entityData.name, entityData.category);

  report.push({
    entityId: entity.id,
    entityName: entity.name,
    oldPath: entity.unsPath ?? '',
    newPath: newEntityPath,
  });

  // Get all descendants and calculate their new paths
  const descendantIds = await getDescendantIds(entityId);

  for (const descId of descendantIds) {
    const descendant = await prisma.assetInstance.findUnique({
      where: { id: descId },
      select: { id: true, name: true, unsPath: true },
    });
    if (!descendant) continue;

    // The descendant's new path = replace the old entity prefix with the new entity prefix
    const oldPrefix = entity.unsPath ?? '';
    const descOldPath = descendant.unsPath ?? '';
    const newDescPath = descOldPath.replace(oldPrefix, newEntityPath);

    report.push({
      entityId: descendant.id,
      entityName: descendant.name,
      oldPath: descOldPath,
      newPath: newDescPath,
    });
  }

  return report;
}

/**
 * Execute the cascade move: update parentId first (committed),
 * then rebuild UNS paths for entity and all descendants.
 * Split into two phases so buildUnsPath() can see the new parent.
 */
export async function confirmCascadeMove(
  entityId: string,
  newParentId: string | null,
): Promise<{ updated: number }> {
  // Phase 1: Update the entity's parentId (committed immediately)
  await prisma.assetInstance.update({
    where: { id: entityId },
    data: { parentId: newParentId },
  });

  // Phase 2: Collect entity + all descendants
  const allIds = [entityId];
  const descendantIds = await getDescendantIds(entityId);
  allIds.push(...descendantIds);

  // Phase 3: Rebuild UNS paths in a single transaction (reads see committed parent)
  await prisma.$transaction(async (tx) => {
    for (const id of allIds) {
      // Skip entities whose UNS mapping is manually overridden
      const existing = await tx.unsMapping.findUnique({ where: { entityId: id } });
      if (existing?.isOverridden) continue;

      const { unsPath, pathSegments } = await buildUnsPath(id);

      await tx.unsMapping.upsert({
        where: { entityId: id },
        create: {
          entityId: id,
          unsPath,
          pathSegments: pathSegments as Prisma.InputJsonValue,
          isOverridden: false,
        },
        update: {
          unsPath,
          pathSegments: pathSegments as Prisma.InputJsonValue,
        },
      });

      await tx.assetInstance.update({
        where: { id },
        data: { unsPath },
      });
    }
  });

  return { updated: allIds.length };
}

// ─── Search ────────────────────────────────────────────────────────

/**
 * Search UNS mappings by wildcard pattern (supports MQTT-style + and #)
 * or exact path match.
 */
export async function searchByWildcard(
  pattern: string,
): Promise<Array<{ entityId: string; unsPath: string; entityName: string }>> {
  const hasWildcard = pattern.includes('+') || pattern.includes('#');

  if (hasWildcard) {
    // Fetch all mappings and filter in-memory with matchWildcard
    const allMappings = await prisma.unsMapping.findMany({
      select: { entityId: true, unsPath: true },
    });

    const matchingEntityIds: string[] = [];
    const pathMap = new Map<string, string>();

    for (const mapping of allMappings) {
      if (matchWildcard(pattern, mapping.unsPath)) {
        matchingEntityIds.push(mapping.entityId);
        pathMap.set(mapping.entityId, mapping.unsPath);
      }
    }

    if (matchingEntityIds.length === 0) return [];

    // Fetch entity names for matched IDs
    const entities = await prisma.assetInstance.findMany({
      where: { id: { in: matchingEntityIds } },
      select: { id: true, name: true },
    });

    return entities.map((e) => ({
      entityId: e.id,
      unsPath: pathMap.get(e.id) ?? '',
      entityName: e.name,
    }));
  }

  // Exact match
  const mapping = await prisma.unsMapping.findUnique({
    where: { unsPath: pattern },
    select: { entityId: true, unsPath: true },
  });

  if (!mapping) return [];

  const entity = await prisma.assetInstance.findUnique({
    where: { id: mapping.entityId },
    select: { name: true },
  });

  return [
    {
      entityId: mapping.entityId,
      unsPath: mapping.unsPath,
      entityName: entity?.name ?? '',
    },
  ];
}

// ─── Tree Builder ──────────────────────────────────────────────────

/**
 * Build a hierarchical UNS tree from all UnsMapping rows.
 * Splits each unsPath by "/" and nests nodes accordingly.
 */
export async function buildUnsTree(): Promise<UnsTreeNode[]> {
  const allMappings = await prisma.unsMapping.findMany({
    select: { entityId: true, unsPath: true, pathSegments: true },
  });

  const root: UnsTreeNode[] = [];

  for (const mapping of allMappings) {
    const segments = mapping.unsPath.split('/');
    let currentLevel = root;

    for (let i = 0; i < segments.length; i++) {
      const segmentName = segments[i];
      const partialPath = segments.slice(0, i + 1).join('/');
      const isLeaf = i === segments.length - 1;

      let existing = currentLevel.find((n) => n.name === segmentName && n.path === partialPath);

      if (!existing) {
        const level = inferLevel(i, segments.length);
        existing = {
          name: segmentName,
          level,
          path: partialPath,
          entityId: isLeaf ? mapping.entityId : undefined,
          childCount: 0,
          children: [],
        };
        currentLevel.push(existing);
      } else if (isLeaf && !existing.entityId) {
        // Assign entityId if this node was created as an intermediate node earlier
        existing.entityId = mapping.entityId;
      }

      currentLevel = existing.children;
    }
  }

  // Calculate childCount for all nodes
  computeChildCounts(root);

  return root;
}

// ─── Private Helpers ───────────────────────────────────────────────

/**
 * Walk up the parent chain and collect ancestor name/category pairs.
 */
async function getAncestorSegments(
  parentId: string | null,
): Promise<Array<{ name: string; category: string }>> {
  const ancestors: Array<{ name: string; category: string }> = [];
  let currentId = parentId;

  while (currentId) {
    const entity = await prisma.assetInstance.findUnique({
      where: { id: currentId },
      select: {
        name: true,
        parentId: true,
        template: { select: { category: true } },
      },
    });
    if (!entity) break;

    ancestors.unshift({ name: entity.name, category: entity.template.category });
    currentId = entity.parentId;
  }

  return ancestors;
}

/**
 * Fetch name and category for a single entity.
 */
async function buildEntityPathData(entityId: string): Promise<{ name: string; category: string }> {
  const entity = await prisma.assetInstance.findUnique({
    where: { id: entityId },
    select: {
      name: true,
      template: { select: { category: true } },
    },
  });

  if (!entity) {
    throw new Error(`Entity ${entityId} not found`);
  }

  return { name: entity.name, category: entity.template.category };
}

/**
 * Build a UNS path string from ancestor segments and an entity's own name.
 * Mirrors the logic in uns-path-builder's buildUnsPathFromSegments.
 */
function buildPathFromAncestors(
  ancestors: Array<{ name: string; category: string }>,
  entityName: string,
  _entityCategory: string,
): string {
  const sanitize = (n: string) =>
    n
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9\-_]/g, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

  const parts = ['digilog/v1'];
  for (const ancestor of ancestors) {
    parts.push(sanitize(ancestor.name));
  }
  parts.push(sanitize(entityName));
  return parts.join('/');
}

/**
 * Infer an ISA-95 level label from a segment's position in the path.
 */
function inferLevel(index: number, totalSegments: number): string {
  // digilog/v1/Enterprise/Site/Area/Line/Cell/Entity
  // index 0 = "digilog", index 1 = "v1"
  const levelMap: Record<number, string> = {
    0: 'namespace',
    1: 'version',
    2: 'Enterprise',
    3: 'Site',
    4: 'Area',
    5: 'Line',
    6: 'Cell',
  };

  if (index in levelMap) return levelMap[index];
  if (index === totalSegments - 1) return 'Entity';
  return 'SubLevel';
}

/**
 * Recursively compute childCount for each node in the tree.
 */
function computeChildCounts(nodes: UnsTreeNode[]): number {
  let total = 0;
  for (const node of nodes) {
    const childTotal = computeChildCounts(node.children);
    node.childCount = node.children.length;
    total += 1;
  }
  return total;
}
