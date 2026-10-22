/**
 * PM Schedules — per-AHU `pmFilterSetMode` configuration.
 *
 * Backed by `AssetInstance.customAttributes.pmFilterSetMode`. Values:
 * BOTH (default) / SET_A / SET_B / DISABLED. Used by the AHU config table
 * on the PM Schedules page and consumed by `getDueTasks` to narrow which
 * child filters count toward PM completion.
 */
import type { RequestContext } from '../../types/context.js';
import { prisma } from '../../lib/prisma.js';
import { auditLog } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { COUNTED_FILTER_WHERE } from '../assets/filter-workflow.js';
import { checkPmEnabled } from './pm-shared.js';

export async function listAhuFilterSetConfigs(_ctx: RequestContext) {
  await checkPmEnabled();

  // Filter by stable templateKind code, not by editable template.name (Step 1).
  const ahus = await prisma.assetInstance.findMany({
    where: {
      template: { templateKind: 'AHU' },
      isActive: true,
    },
    select: { id: true, name: true, customAttributes: true },
    orderBy: { name: 'asc' },
  });

  // Bulk-count child filters per AHU grouped by filterSet (one query)
  const ahuIds = ahus.map(a => a.id);
  const childFilters = ahuIds.length
    ? await prisma.assetInstance.findMany({
        // The filters PM counts (filter-workflow.ts COUNTED_FILTER_WHERE), so the
        // per-set counts describe what the chosen mode will count.
        where: { parentId: { in: ahuIds }, ...COUNTED_FILTER_WHERE },
        select: { parentId: true, filterDetails: { select: { filterSet: true } } },
      })
    : [];

  const countsByAhu = new Map<string, { setA: number; setB: number; noSet: number }>();
  for (const f of childFilters) {
    if (!f.parentId) continue;
    if (!countsByAhu.has(f.parentId)) countsByAhu.set(f.parentId, { setA: 0, setB: 0, noSet: 0 });
    const c = countsByAhu.get(f.parentId)!;
    const fSet = f.filterDetails?.filterSet ?? null;
    if (fSet === 'SET_A') c.setA++;
    else if (fSet === 'SET_B') c.setB++;
    else c.noSet++;
  }

  // Which AHUs have an active PM schedule right now? Convenience flag
  // so the UI can surface "no schedule yet" rows distinctly if it wants.
  const scheduledAhuRows = await prisma.pmSchedule.findMany({
    where: { entityId: { in: ahuIds }, status: 'ACTIVE' },
    select: { entityId: true },
    distinct: ['entityId'],
  });
  const scheduledAhus = new Set(scheduledAhuRows.map(r => r.entityId));

  return {
    ahus: ahus.map(a => {
      const attrs = (a.customAttributes as any) ?? {};
      const mode = (attrs.pmFilterSetMode === 'SET_A' || attrs.pmFilterSetMode === 'SET_B' || attrs.pmFilterSetMode === 'DISABLED')
        ? attrs.pmFilterSetMode
        : 'BOTH';
      const counts = countsByAhu.get(a.id) ?? { setA: 0, setB: 0, noSet: 0 };
      return {
        ahuId: a.id,
        ahuName: a.name,
        mode: mode as 'BOTH' | 'SET_A' | 'SET_B' | 'DISABLED',
        setACount: counts.setA,
        setBCount: counts.setB,
        noSetCount: counts.noSet,
        totalFilters: counts.setA + counts.setB + counts.noSet,
        hasActiveSchedule: scheduledAhus.has(a.id),
      };
    }),
  };
}

/**
 * Update the pmFilterSetMode on an AHU's customAttributes. Uses a read +
 * merge + write to preserve other keys inside customAttributes.
 */
// D03-09 / F-42 (2026-10-22): the route runs this BEFORE the re-auth gate (a
// refused request costs no password and leaves no REAUTH_* row); the write
// runs it again.
export async function assertCanUpdateAhuFilterSetMode(ahuId: string) {
  await checkPmEnabled();

  const ahu = await prisma.assetInstance.findFirst({
    where: { id: ahuId },
    select: { id: true, name: true, customAttributes: true },
  });
  if (!ahu) throw new AppError(404, 'NOT_FOUND', 'AHU not found');
  return ahu;
}

export async function updateAhuFilterSetMode(
  ctx: RequestContext,
  ahuId: string,
  mode: 'BOTH' | 'SET_A' | 'SET_B' | 'DISABLED',
) {
  const ahu = await assertCanUpdateAhuFilterSetMode(ahuId);

  const currentAttrs = (ahu.customAttributes as any) ?? {};
  const newAttrs = { ...currentAttrs, pmFilterSetMode: mode };

  await prisma.assetInstance.update({
    where: { id: ahuId },
    data: { customAttributes: newAttrs },
  });

  await auditLog({
    userId: ctx.userId, userRole: ctx.userRole, action: 'AHU_PM_FILTER_SET_MODE_UPDATED',
    targetType: 'asset_instance', targetId: ahuId,
    beforeValue: { pmFilterSetMode: currentAttrs.pmFilterSetMode ?? 'BOTH' },
    afterValue: { pmFilterSetMode: mode, ahuName: ahu.name },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  });

  return { ahuId, ahuName: ahu.name, mode };
}
