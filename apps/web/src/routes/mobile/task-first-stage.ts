/**
 * Which scan station does a My Tasks "Perform" open? (OQ-05, 2026-10-19)
 *
 * The tablet hard-coded Wash In. The live profiles do not all start there —
 * "CWH/RDU/01" begins with Dry In — so Perform dropped the operator on a
 * station the server then refuses for every filter of that AHU.
 *
 * The answer is the FIRST STAGE of the cleaning profile the server would
 * assign to the task's filters. The resolution here mirrors
 * `resolveFilterProfile` (api filter-resolver.ts) for the two modes a TASK can
 * answer — the task names an AHU, its area and its block, not a filter:
 *   - BY_AHU   : the rule whose matchValue is the AHU id
 *   - BY_BLOCK : walk AHU → area → block, first rule that matches wins
 * BY_ENTITY / BY_FILTER_SIZE / BY_FILTER_SET are per-filter, and an unmatched
 * rule falls back to the server's `default-cleaning-profile`, which the tablet
 * does not cache. In all of those cases — and whenever the profile or its
 * graph is not available, or the profile has more than one possible first
 * stage — this returns null and the caller shows the station picker. It never
 * guesses.
 */
import { firstStagesFromGraph } from '@/lib/filter-ops';

export interface AssignmentConfigLike {
  mode?: string;
  rules?: Array<{ matchValue?: string | null; profileId?: string | null }>;
}

export interface TaskLocation {
  ahuId?: string | null;
  areaId?: string | null;
  blockId?: string | null;
}

export interface ProfileGraphLike {
  stages?: any[];
  connections?: any[];
}

/** Profile id the server would resolve for any filter of this task's AHU, or null if it cannot be told from the task. */
export function profileIdForTask(task: TaskLocation, assignment: AssignmentConfigLike | null | undefined): string | null {
  const rules = Array.isArray(assignment?.rules) ? assignment!.rules! : [];
  if (rules.length === 0) return null;
  const find = (id: string | null | undefined) => (id ? rules.find((r) => r.matchValue === id) : undefined);
  if (assignment?.mode === 'BY_AHU') {
    return find(task.ahuId)?.profileId ?? null;
  }
  if (assignment?.mode === 'BY_BLOCK') {
    for (const id of [task.ahuId, task.areaId, task.blockId]) {
      const rule = find(id);
      if (rule) return rule.profileId ?? null;
    }
    return null;
  }
  return null;
}

/** The single first STAGE of a profile graph, or null when absent / ambiguous. */
export function singleFirstStage(graph: ProfileGraphLike | null | undefined, stationKeys: ReadonlySet<string>): string | null {
  if (!graph?.stages || !graph?.connections) return null;
  const first = [...new Set(firstStagesFromGraph(graph))];
  if (first.length !== 1) return null;
  return stationKeys.has(first[0]) ? first[0] : null;
}

export interface FirstStageDeps {
  assignment: AssignmentConfigLike | null | undefined;
  /** A profile with `stages` + `connections` — live or from the offline cache. */
  getProfile: (profileId: string) => Promise<ProfileGraphLike | null | undefined>;
}

export async function resolveTaskFirstStage(
  task: TaskLocation,
  stationKeys: ReadonlySet<string>,
  deps: FirstStageDeps,
): Promise<string | null> {
  const profileId = profileIdForTask(task, deps.assignment);
  if (!profileId) return null;
  let profile: ProfileGraphLike | null | undefined = null;
  try { profile = await deps.getProfile(profileId); } catch { return null; }
  return singleFirstStage(profile, stationKeys);
}
