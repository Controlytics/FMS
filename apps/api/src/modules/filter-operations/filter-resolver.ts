/**
 * Filter Operations — filter / profile / pipeline resolution helpers.
 *
 * Extracted from filter-operations.service.ts. These are leaf I/O helpers
 * the orchestrator class composes. Pure moves — no behavioral changes.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { AppError } from '../../lib/errors.js';

export type ResolvedFilter = {
  id: string;
  name: string | null;
  parentId: string | null;
  filterProfileId: string | null;
  currentLifecycleState: string | null;
  currentCycleId: string | null;
  filterSet: string | null;
};

export async function getFilter(filterId: string, _ctx: RequestContext): Promise<ResolvedFilter> {
  // parentId is required by retire() to snapshot the original tree position
  // into customAttributes._preRetireParentId so unretire can restore it.
  // Filter cycle state lives on FilterDetails (Step 6) — include + flatten so
  // the rest of this service keeps reading filter.{filterProfileId, currentLifecycleState, currentCycleId, filterSet} unchanged.
  const inst = await prisma.assetInstance.findFirst({
    where: { id: filterId },
    select: {
      id: true, name: true, parentId: true,
      filterDetails: { select: { filterProfileId: true, currentLifecycleState: true, currentCycleId: true, filterSet: true } },
    },
  });
  if (!inst) throw new AppError(404, 'NOT_FOUND', 'Filter not found');
  return {
    id: inst.id,
    name: inst.name ?? null,
    parentId: inst.parentId ?? null,
    filterProfileId: inst.filterDetails?.filterProfileId ?? null,
    currentLifecycleState: inst.filterDetails?.currentLifecycleState ?? null,
    currentCycleId: inst.filterDetails?.currentCycleId ?? null,
    filterSet: (inst.filterDetails?.filterSet ?? null) as string | null,
  };
}

export async function getFilterHomeBlock(filterId: string): Promise<{ blockId: string; blockName: string } | null> {
  let currentId: string | null = filterId;
  const visited = new Set<string>();
  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const inst: { id: string; name: string; parentId: string | null; template: { templateKind: string } | null } | null = await prisma.assetInstance.findUnique({
      where: { id: currentId },
      select: { id: true, name: true, parentId: true, template: { select: { templateKind: true } } },
    });
    if (!inst) break;
    if (inst.template?.templateKind === 'BLOCK') {
      return { blockId: inst.id, blockName: inst.name };
    }
    currentId = inst.parentId;
  }
  return null;
}

export async function validateBlockChange(filterId: string, cleaningAreaId: string | undefined, _ctx: RequestContext) {
  if (!cleaningAreaId) return;
  const homeBlock = await getFilterHomeBlock(filterId);
  if (!homeBlock) return;
  if (homeBlock.blockId === cleaningAreaId) return;

  const { blockChangeService } = await import('../block-change-requests/block-change.service.js');
  const hasApproval = await blockChangeService.hasApproval(filterId, cleaningAreaId);
  if (!hasApproval) {
    const targetBlock = await prisma.assetInstance.findUnique({
      where: { id: cleaningAreaId },
      select: { name: true },
    });
    throw new AppError(409, 'BLOCK_CHANGE_REQUIRED',
      `Filter belongs to ${homeBlock.blockName}. Request approval to clean in ${targetBlock?.name ?? 'another block'}.`,
      {
        filterId,
        homeBlockId: homeBlock.blockId,
        homeBlockName: homeBlock.blockName,
        requestedBlockId: cleaningAreaId,
        requestedBlockName: targetBlock?.name ?? '',
      }
    );
  }
  // Audit 2026-05-05 fix #7: do NOT consume here. The consumption now
  // happens inside the start-cycle transaction (start-cycle.ts) under the
  // FOR UPDATE row lock so two concurrent starts can't both consume the
  // same approval. This pre-flight check is kept as a cheap UX gate that
  // gives the operator a clean 409 BLOCK_CHANGE_REQUIRED before the more
  // expensive cycle-creation path runs.
}

/**
 * Audit 2026-05-05 fix #7: tx-internal recheck-and-consume.
 *
 * Called from start-cycle.ts inside the row-locked transaction. Re-reads
 * the approval under the lock and consumes it atomically. If the approval
 * was already consumed by a concurrent start (race), throws 409
 * BLOCK_CHANGE_RACE so the operator knows to refresh and retry.
 *
 * No-op when no cleaningAreaId, no homeBlock, or filter is at home.
 */
export async function consumeBlockChangeApprovalTx(
  tx: any,
  filterId: string,
  cleaningAreaId: string | undefined,
): Promise<void> {
  if (!cleaningAreaId) return;
  const homeBlock = await getFilterHomeBlock(filterId);
  if (!homeBlock) return;
  if (homeBlock.blockId === cleaningAreaId) return;

  const { blockChangeService } = await import('../block-change-requests/block-change.service.js');
  const hasApproval = await blockChangeService.hasApprovalTx(tx, filterId, cleaningAreaId);
  if (!hasApproval) {
    throw new AppError(409, 'BLOCK_CHANGE_RACE',
      'A concurrent start consumed the block-change approval. Refresh and retry.',
      { filterId, requestedBlockId: cleaningAreaId },
    );
  }
  await blockChangeService.consumeApprovalTx(tx, filterId, cleaningAreaId);
}

export function getNextStageKeys(fromNodeId: string, stages: any[], connections: any[]): string[] {
  const outConns = connections.filter((c: any) => c.fromStageId === fromNodeId);
  const nextStageIds = outConns.map((c: any) => c.toStageId);
  const nextStages = stages.filter((s: any) => nextStageIds.includes(s.id));
  return nextStages.filter((s: any) => s.nodeType === 'STAGE').map((s: any) => s.stateKey!).filter(Boolean);
}

export function extractBlocks(stages: any[]): { nodeType: string; configuration: any }[] {
  return stages.filter((s: any) => !['STAGE', 'END', 'START', 'CHECKLIST'].includes(s.nodeType))
    .map((s: any) => ({ nodeType: s.nodeType, configuration: s.configuration }));
}

export async function resolveFilterProfile(filter: { id: string; filterProfileId: string | null; filterSet: string | null; name: string | null }): Promise<string | null> {
  // 1. Direct assignment takes priority
  if (filter.filterProfileId) return filter.filterProfileId;

  // 2. Check config-based assignment
  const configRow = await prisma.systemConfig.findUnique({ where: { configKey: 'cleaning-profile-assignment' } });
  const config = configRow?.configValue as { mode: string; rules: Array<{ matchValue: string; profileId: string }> } | null;
  if (!config || !config.rules || config.rules.length === 0) return null;

  // 3. Get filter's attributes and ancestors for matching
  const instance = await prisma.assetInstance.findUnique({
    where: { id: filter.id },
    select: { attributes: true, parentId: true },
  });
  const attrs = (instance?.attributes as Record<string, any>) ?? {};

  switch (config.mode) {
    case 'BY_FILTER_SIZE': {
      const filterSize = attrs.filterSize ?? '';
      const rule = config.rules.find(r => r.matchValue === filterSize);
      return rule?.profileId ?? null;
    }
    case 'BY_FILTER_SET': {
      const rule = config.rules.find(r => r.matchValue === filter.filterSet);
      return rule?.profileId ?? null;
    }
    case 'BY_AHU': {
      // Filter's parent is typically AHU
      if (instance?.parentId) {
        const rule = config.rules.find(r => r.matchValue === instance.parentId);
        return rule?.profileId ?? null;
      }
      return null;
    }
    case 'BY_BLOCK': {
      // Walk up: Filter -> AHU -> ... -> Block
      let currentId = instance?.parentId;
      const visited = new Set<string>();
      while (currentId && !visited.has(currentId)) {
        visited.add(currentId);
        const rule = config.rules.find(r => r.matchValue === currentId);
        if (rule) return rule.profileId;
        const parent = await prisma.assetInstance.findUnique({ where: { id: currentId }, select: { parentId: true } });
        currentId = parent?.parentId ?? null;
      }
      return null;
    }
    case 'BY_ENTITY': {
      const rule = config.rules.find(r => r.matchValue === filter.id);
      return rule?.profileId ?? null;
    }
    default:
      return null;
  }
}

export async function getProfilePipeline(profileId: string, requireActive: boolean = false) {
  // Try as FilterProfile first (has cleaningProfileId reference)
  const fp = await prisma.filterProfile.findUnique({ where: { id: profileId } });
  const cleaningProfileId = fp ? fp.cleaningProfileId : profileId;

  // Try as CleaningProfile directly (from config-based assignment)
  const cp = await prisma.filterCleaningProfile.findUnique({
    where: { id: cleaningProfileId },
    include: { stages: { orderBy: { sortOrder: 'asc' } }, connections: true },
  });

  // If profile is disabled (not ACTIVE), block operations that require it
  if (cp && requireActive && cp.status !== 'ACTIVE') {
    return null;
  }

  return cp;
}

export async function getCleaningReasons(profileId?: string) {
  if (profileId) {
    // Try as FilterProfile first, then as CleaningProfile directly
    const fp = await prisma.filterProfile.findUnique({ where: { id: profileId } });
    const cpId = fp ? fp.cleaningProfileId : profileId;
    const cp = await prisma.filterCleaningProfile.findUnique({ where: { id: cpId } });
    if (cp?.cleaningReasons) return cp.cleaningReasons as any[];
  }
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'filter-cleaning-reasons' } });
  const val = cfg?.configValue as any;
  return Array.isArray(val) ? val : (val?.value ?? []);
}
