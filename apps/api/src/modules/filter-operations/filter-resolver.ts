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
  // Super-admin toggle: when cross-block approval is disabled, allow freely.
  if (!(await blockChangeService.isEnforcementEnabled())) return;
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
  // Super-admin toggle off → cross-block allowed freely; nothing to consume.
  if (!(await blockChangeService.isEnforcementEnabled())) return;
  const hasApproval = await blockChangeService.hasApprovalTx(tx, filterId, cleaningAreaId);
  if (!hasApproval) {
    throw new AppError(409, 'BLOCK_CHANGE_RACE',
      'A concurrent start consumed the block-change approval. Refresh and retry.',
      { filterId, requestedBlockId: cleaningAreaId },
    );
  }
  await blockChangeService.consumeApprovalTx(tx, filterId, cleaningAreaId);
}

/**
 * Advance-time block guard (2026-06-06 fix). The cycle's block is frozen at
 * start (cleaning_cycles.cleaning_area_id). A stage submitted for a DIFFERENT
 * block must be rejected — pre-fix advance() destructured cleaningAreaId,
 * recorded it on the event, but NEVER validated it, so an operator could run
 * a later stage (e.g. DRY_IN) in another block with no block-change request.
 * Config-gated by the same super-admin toggle as start (isEnforcementEnabled).
 *
 * This is a pre-write gate ONLY: it throws before advance() mutates any cycle
 * state and does not change cycle mechanics, stage flow, or cycle codes.
 * Distinct code BLOCK_MISMATCH (not BLOCK_CHANGE_REQUIRED) so the FE surfaces
 * a plain rejection rather than the request-approval popup — a frozen cycle
 * can't be moved to another block, so requesting approval would be a dead end.
 */
export async function validateAdvanceBlock(
  cycle: { filterId?: string; cleaningAreaId?: string | null } | null,
  cleaningAreaId: string | undefined,
): Promise<void> {
  if (!cleaningAreaId) return; // FE sent no block on this advance — nothing to check
  const cycleBlockId = cycle?.cleaningAreaId ?? null;
  // Same block, or a legacy cycle started with no block bound → allow.
  if (!cycleBlockId || cleaningAreaId === cycleBlockId) return;

  const { blockChangeService } = await import('../block-change-requests/block-change.service.js');
  if (!(await blockChangeService.isEnforcementEnabled())) return;

  const [cycleBlock, reqBlock] = await Promise.all([
    prisma.assetInstance.findUnique({ where: { id: cycleBlockId }, select: { name: true } }),
    prisma.assetInstance.findUnique({ where: { id: cleaningAreaId }, select: { name: true } }),
  ]);
  throw new AppError(409, 'BLOCK_MISMATCH',
    `This cleaning cycle is running in ${cycleBlock?.name ?? 'its starting block'}. Perform this stage in ${cycleBlock?.name ?? 'that block'}, not ${reqBlock?.name ?? 'a different block'}.`,
    {
      filterId: cycle?.filterId,
      cycleBlockId,
      cycleBlockName: cycleBlock?.name ?? '',
      requestedBlockId: cleaningAreaId,
      requestedBlockName: reqBlock?.name ?? '',
    },
  );
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

/**
 * Configurable / convention-based fallback. Reads two sources in order:
 *   1. `system_config['default-cleaning-profile'].profileId` — admin-set default
 *   2. First `FilterCleaningProfile` with status=ACTIVE, oldest first
 *
 * Used as the FINAL fallback in resolveFilterProfile() — when neither the
 * filter's direct filterProfileId nor any cleaning-profile-assignment rule
 * matches. Pre-fix, the absence of either threw NO_PROFILE at start-cycle
 * and operators on the tablet saw "no cleaning profile assigned" even when
 * a perfectly usable pipeline existed in the system. Per 2026-05-25 user
 * request: filter_profile_id should not be required for a cycle to start.
 */
async function getDefaultCleaningProfileId(): Promise<string | null> {
  const cfg = await prisma.systemConfig.findUnique({ where: { configKey: 'default-cleaning-profile' } });
  const configured = (cfg?.configValue as { profileId?: string } | null)?.profileId;
  if (configured) {
    const exists = await prisma.filterCleaningProfile.findFirst({ where: { id: configured, status: 'ACTIVE' } });
    if (exists) return exists.id;
  }
  const firstActive = await prisma.filterCleaningProfile.findFirst({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return firstActive?.id ?? null;
}

export async function resolveFilterProfile(filter: { id: string; filterProfileId: string | null; filterSet: string | null; name: string | null }): Promise<string | null> {
  // 1. Direct assignment takes priority
  if (filter.filterProfileId) return filter.filterProfileId;

  // 2. Check config-based assignment
  const configRow = await prisma.systemConfig.findUnique({ where: { configKey: 'cleaning-profile-assignment' } });
  const config = configRow?.configValue as { mode: string; rules: Array<{ matchValue: string; profileId: string }> } | null;
  if (!config || !config.rules || config.rules.length === 0) {
    // No rules at all — go straight to default fallback.
    return getDefaultCleaningProfileId();
  }

  // 3. Get filter's attributes and ancestors for matching
  const instance = await prisma.assetInstance.findUnique({
    where: { id: filter.id },
    select: { attributes: true, parentId: true },
  });
  const attrs = (instance?.attributes as Record<string, any>) ?? {};

  switch (config.mode) {
    case 'BY_FILTER_SIZE': {
      // 2026-05-29 bug fix #2: historically the only UI that wrote filter-size
      // data stored it under the `micronSize` key, so this matched micronSize.
      // 2026-06-02: `filterSize` is now a real, distinct field-option. We still
      // prefer `micronSize` here for BACKWARD-COMPAT — existing BY_FILTER_SIZE
      // rules have their matchValue configured against micron values, and no
      // existing filter carries a real `filterSize` yet. Flip the precedence to
      // `filterSize ?? micronSize` only after deciding how legacy rules migrate.
      const filterSize = String(attrs.micronSize ?? attrs.filterSize ?? '');
      const rule = config.rules.find(r => String(r.matchValue) === filterSize);
      if (rule?.profileId) return rule.profileId;
      return getDefaultCleaningProfileId();
    }
    case 'BY_FILTER_SET': {
      // 2026-05-29 bug fix #1: filter_details.filter_set stores the prefixed
      // enum value 'SET_A' / 'SET_B'; FE previously seeded rule matchValue as
      // 'A' / 'B' (unprefixed). 'B' !== 'SET_B' → no match → fell through to
      // the default profile. Normalise BOTH sides by stripping the SET_
      // prefix so new (canonical) and legacy (unprefixed) configs both work.
      // Uppercase FIRST then strip — guarantees lower-case inputs like
      // 'set_b' also normalize correctly. (Production filter_set is always
      // 'SET_A'/'SET_B' but defence in depth costs nothing here.)
      const normalize = (v: string | null | undefined) => (v ?? '').toUpperCase().replace(/^SET_/, '');
      const target = normalize(filter.filterSet);
      const rule = config.rules.find(r => normalize(r.matchValue) === target);
      if (rule?.profileId) return rule.profileId;
      return getDefaultCleaningProfileId();
    }
    case 'BY_AHU': {
      // Filter's parent is typically AHU
      if (instance?.parentId) {
        const rule = config.rules.find(r => r.matchValue === instance.parentId);
        if (rule?.profileId) return rule.profileId;
      }
      return getDefaultCleaningProfileId();
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
      return getDefaultCleaningProfileId();
    }
    case 'BY_ENTITY': {
      const rule = config.rules.find(r => r.matchValue === filter.id);
      if (rule?.profileId) return rule.profileId;
      return getDefaultCleaningProfileId();
    }
    default:
      return getDefaultCleaningProfileId();
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
