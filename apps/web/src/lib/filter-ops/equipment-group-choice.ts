/**
 * Which equipment group a cycle's instrument readings belong to — and whether
 * the OPERATOR has to choose it (operator decision 2026-10-22).
 *
 * ONE rule for every readings surface: the web Filter Operations readings
 * dialog, the Dry In "Currently Drying" panel (shared with the tablet) and the
 * tablet operations page. The pages decide only whether a readings step is
 * needed at all (does any offered group have an instrument for this stage?).
 *
 * Input is the `/current-state` shape, which is also what the offline cache
 * keeps per filter (`filter-state-<id>`: equipmentGroup, blockEquipmentGroups,
 * currentCycle — see offline-cache.ts cacheServerStateResponse).
 *
 * Rules, in order:
 *  1. A cycle BOUND to a group (`currentCycle.equipmentGroupId`) uses that
 *     group — never a choice, even if a stale cached row still lists several.
 *     Bound is read from the cycle, never from `equipmentGroup`: since 874aa96
 *     the server fills `equipmentGroup` with the block's OLDEST group for an
 *     unbound cycle, so treating its presence as "bound" is the silent pick
 *     this rule exists to remove.
 *  2. Unbound, the block lists more than one active group → the operator picks.
 *     Nothing is preselected (the server refuses readings without a group then:
 *     MULTIPLE_EQUIPMENT_GROUPS).
 *  3. Unbound, exactly one → that group, as before.
 *  4. Unbound, none listed (a row cached before the server listed the block's
 *     groups, or a state built offline) → the caller's fallback list (e.g. the
 *     cached `equipment-groups` of the block): more than one → the operator
 *     picks; otherwise the state's `equipmentGroup` as before, or the fallback's
 *     only group when the state names none.
 */

export interface EquipmentGroupSource {
  currentCycle?: { equipmentGroupId?: string | null } | null;
  equipmentGroup?: any | null;
  blockEquipmentGroups?: any[] | null;
}

export interface EquipmentGroupChoice {
  /** The operator must pick one of `groups`; `group` is null until they do. */
  needsChoice: boolean;
  /** The group to use without asking, or null (a choice is needed, or there is none). */
  group: any | null;
  /** Every group on offer when a choice is needed; otherwise `[group]` or []. */
  groups: any[];
}

export function equipmentGroupChoice(
  state: EquipmentGroupSource | null | undefined,
  fallbackBlockGroups: any[] = [],
): EquipmentGroupChoice {
  const one = (g: any | null | undefined): EquipmentGroupChoice =>
    ({ needsChoice: false, group: g ?? null, groups: g ? [g] : [] });

  if (state?.currentCycle?.equipmentGroupId) return one(state.equipmentGroup);

  const listed = (state?.blockEquipmentGroups ?? []).filter(Boolean);
  if (listed.length > 1) return { needsChoice: true, group: null, groups: listed };
  if (listed.length === 1) return one(listed[0]);
  const fallback = fallbackBlockGroups.filter(Boolean);
  if (fallback.length > 1) return { needsChoice: true, group: null, groups: fallback };
  return one(state?.equipmentGroup ?? fallback[0]);
}

/** True when the group has at least one instrument read at `stageKey`. */
export function groupHasStageInstruments(group: any | null | undefined, stageKey: string): boolean {
  return (group?.instruments ?? []).some((i: any) => i.stageKey === stageKey);
}
