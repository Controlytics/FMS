/**
 * Which station may answer a checklist pending at a cycle's CURRENT stage
 * (2026-10-22). ONE rule for the tablet queue (online and offline) and the
 * desktop page.
 *
 * Why: a filter whose cycle sat at Storage Out with its final checklist pending,
 * scanned at the Wash In station, was handed that checklist — and submitting it
 * completed the old cycle (CC-MUPS/RDU/0-005, 2026-05-25). Neither the server
 * nor the offline replay knows which station scanned the filter, so the client
 * is the only place this can be decided.
 *
 * Allowed: the station of the stage the checklist belongs to, or one of that
 * stage's NEXT stages (the tablet lets the next station answer the previous
 * stage's checklist and then advance — "answer, then move on"). Anything else
 * is refused with the station to go to. When the next stages cannot be told
 * (no stageLookup row and no pipeline graph), only the current station is
 * allowed — fail closed.
 *
 * START is a position (2026-10-22): a started cycle that has not entered a
 * stage (current state null) has its checklist before the first stage pending.
 * It is answered at a FIRST stage's station only (firstStagesFromGraph) — at
 * any other, the advance that follows is refused and the filter was never
 * there. With no graph the first stage cannot be told: refused (fail closed).
 * Callers ask only while a checklist is waiting, i.e. inside a running cycle.
 */
import { findReachable as sharedFindReachable } from '@digilog/shared';
import { firstStagesFromGraph } from './validate-offline-gate';

export type ChecklistStationResult =
  | { ok: true }
  | { ok: false; stage: string; reason: string };

/** STORAGE_OUT → "Storage Out" — the station's name as the operator sees it. */
export function stageLabel(stageKey: string): string {
  return stageKey
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function nextStagesOf(
  currentState: string,
  stageLookup: Record<string, { nextStages?: string[] } | undefined> | null | undefined,
  pipelineGraph: { stages?: any[]; connections?: any[] } | null | undefined,
): string[] {
  const row = stageLookup?.[currentState];
  if (row && Array.isArray(row.nextStages)) return row.nextStages;
  if (!pipelineGraph?.stages || !pipelineGraph?.connections) return [];
  const node = pipelineGraph.stages.find((s: any) => s.nodeType === 'STAGE' && s.stateKey === currentState);
  if (!node) return [];
  return sharedFindReachable(node.id, pipelineGraph.stages, pipelineGraph.connections).reachableStages;
}

/**
 * The stage a pending checklist belongs to, read from the tape's
 * SUBMIT_CHECKLIST (`params.afterStage`) — the checklist's own record of it,
 * rather than a filter row that may lag. Null when the tape has none.
 */
export function pendingChecklistStage(actions: ReadonlyArray<{ type: string; params?: unknown }> | null | undefined): string | null {
  const a = actions?.find((x) => x.type === 'SUBMIT_CHECKLIST');
  const stage = (a?.params as { afterStage?: unknown } | undefined)?.afterStage;
  return typeof stage === 'string' && stage ? stage : null;
}

export function checklistMayBeAnsweredAt(
  scannedStage: string,
  currentState: string | null | undefined,
  stageLookup: Record<string, { nextStages?: string[] } | undefined> | null | undefined,
  filterName = 'This filter',
  pipelineGraph?: { stages?: any[]; connections?: any[] } | null,
): ChecklistStationResult {
  if (!currentState) {
    const firsts = firstStagesFromGraph(pipelineGraph);
    if (firsts.includes(scannedStage)) return { ok: true };
    const where = firsts.length > 0 ? firsts.map(stageLabel).join(' or ') : 'its first stage';
    return { ok: false, stage: firsts[0] ?? '', reason: `${filterName} has a pending checklist before its first stage — scan it at ${where}` };
  }
  if (scannedStage === currentState) return { ok: true };
  if (nextStagesOf(currentState, stageLookup, pipelineGraph).includes(scannedStage)) return { ok: true };
  const at = stageLabel(currentState);
  return { ok: false, stage: currentState, reason: `${filterName} has a pending ${at} checklist — scan it at ${at}` };
}
