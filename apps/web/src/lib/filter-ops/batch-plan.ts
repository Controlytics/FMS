/**
 * A batch is decided PER FILTER, not on the first one (2026-10-22).
 *
 * The desktop batch read the FIRST scanned filter's state and sent every filter
 * a call shaped for it. Two filters in one batch can differ, and each
 * difference sent a wrong call:
 *  - readings: the chosen equipment group went to a filter whose cycle is bound
 *    to ANOTHER group (readings checked and recorded against a group the cycle
 *    does not use; the server now refuses this, 409 EQUIPMENT_GROUP_MISMATCH),
 *    or a filter that takes readings here was advanced without them;
 *  - the last stage with a checklist after it (A-01): one profile needs
 *    advance-with-checklist, another a bare advance, a third another checklist;
 *  - a pending checklist: one filter's answers sent against another's checklist;
 *  - a cycle START sent to a filter already in a cycle, or whose cleaning does
 *    not start at this stage (the start is written, the advance refused).
 *
 * Each filter is now read on its OWN state. The filters that share the call
 * this submit makes go together; every other one stays in the scan queue with
 * a note saying why, for a separate submit (like the tablet: one dialog for the
 * largest same-checklist group, the rest stay queued). A filter whose state
 * cannot be read (offline, nothing cached) is never given another's shape.
 *
 * Pure: the page fetches and caches the states, these decide.
 */
import {
  advanceMustCarryChecklist,
  checklistNodeProfileId,
  collectChecklistsAfterStage,
  enabledChecklistNodes,
} from '@digilog/shared';
import { equipmentGroupChoice, groupHasStageInstruments } from './equipment-group-choice';
import type { PendingChecklist } from './types';

export interface BatchItem {
  filterId: string;
  filterName: string;
}

/** A filter left out of this submit, and why (shown to the operator). */
export interface LeftItem<T extends BatchItem = BatchItem> {
  item: T;
  note: string;
}

export type StateOf = (filterId: string) => any | null | undefined;

const UNKNOWN = 'its current state could not be read (offline data not cached)';

/**
 * The readings call a filter needs at this stage: `'none'`, `'group:<id>'` or
 * `'choice:<ids>'` (the operator picks among those groups). `null` = unknown.
 *
 * `stageKey` null means "any group takes readings" (the Dry In temperature, the
 * Wash In readings asked by block) — the same condition the page uses to open
 * its readings dialog there; otherwise a group takes readings when it has an
 * instrument for the stage.
 */
export function readingsCallKey(state: any, stageKey: string | null, fallbackBlockGroups: any[] = []): string | null {
  if (!state) return null;
  const choice = equipmentGroupChoice(state, fallbackBlockGroups);
  const takesReadings = stageKey === null
    ? choice.groups.length > 0
    : choice.groups.some((g: any) => groupHasStageInstruments(g, stageKey));
  if (!takesReadings) return 'none';
  if (choice.needsChoice) return `choice:${choice.groups.map((g: any) => g.id).sort().join(',')}`;
  return `group:${choice.group?.id ?? ''}`;
}

function readingsNote(state: any, key: string | null, fallbackBlockGroups: any[]): string {
  if (key === null) return UNKNOWN;
  if (key === 'none') return 'takes no readings here';
  if (key.startsWith('choice:')) return 'its equipment group must be chosen on its own';
  const name = equipmentGroupChoice(state, fallbackBlockGroups).group?.name ?? 'another equipment group';
  return state?.currentCycle?.equipmentGroupId
    ? `its cleaning cycle records readings with ${name}`
    : `records readings with ${name}`;
}

/**
 * Split a batch by the readings call each filter needs. The FIRST filter's call
 * is the one this submit makes (its dialog is the one shown); a filter needing
 * any other call — another bound group, its own choice, readings when the first
 * takes none, or none when the first takes some — stays out.
 */
export function splitByReadings<T extends BatchItem>(
  batch: T[],
  stateOf: StateOf,
  stageKey: string | null,
  fallbackBlockGroups: any[] = [],
): { ride: T[]; left: LeftItem<T>[] } {
  if (batch.length === 0) return { ride: [], left: [] };
  const keyOf = (b: T) => readingsCallKey(stateOf(b.filterId), stageKey, fallbackBlockGroups);
  const first = keyOf(batch[0]);
  const ride: T[] = [];
  const left: LeftItem<T>[] = [];
  for (const b of batch) {
    const k = keyOf(b);
    if (k !== null && k === first) ride.push(b);
    else left.push({ item: b, note: readingsNote(stateOf(b.filterId), k, fallbackBlockGroups) });
  }
  return { ride, left };
}

/** Same grouping key as the tablet: `${checklistProfileId}@${profileVersion ?? 0}`, sorted. */
export function checklistSignature(rows: Array<{ checklistProfileId: string; profileVersion?: number | null }>): string {
  return rows.map((r) => `${r.checklistProfileId}@${r.profileVersion ?? 0}`).sort().join('|');
}

/** The largest group by key; on a tie the group seen first. */
export function largestGroup<T>(entries: Array<{ key: string; item: T }>): { key: string; items: T[] } | null {
  const groups = new Map<string, T[]>();
  for (const e of entries) {
    const arr = groups.get(e.key) ?? [];
    arr.push(e.item);
    groups.set(e.key, arr);
  }
  let best: { key: string; items: T[] } | null = null;
  for (const [key, items] of groups) {
    if (!best || items.length > best.items.length) best = { key, items };
  }
  return best;
}

export interface FinalStagePlan<T extends BatchItem> {
  /** A bare advance is right for these (their profile has no enabled checklist after the stage, or more stages follow). */
  plain: T[];
  /** Enter the stage AND answer `checklists` in one call (advance-with-checklist). */
  carry: T[];
  checklists: PendingChecklist[];
  left: LeftItem<T>[];
}

/**
 * The last stage with a checklist after it (A-01), decided per filter with the
 * server's own rule (`advanceMustCarryChecklist` over that filter's
 * stageLookup). One checklist dialog per submit: the largest group sharing the
 * same checklist(s) carries it; a filter needing a different one stays out.
 *
 * A filter that must carry a checklist whose questions cannot be resolved goes
 * PLAIN: the server refuses that bare advance and the refusal is shown — never
 * a silent skip, never another filter's checklist.
 *
 * `dryerAction` is the call's: the checklist after a FINAL Dry In rides on the
 * readings (SUBMIT_READINGS) that finish its work, never on the entry
 * (SET_DURATION) — the server's rule, callCompletesStageWork (2026-10-22).
 */
export async function planFinalStageBatch<T extends BatchItem>(
  batch: T[],
  targetState: string,
  stateOf: StateOf,
  resolveChecklists: (filterId: string) => Promise<PendingChecklist[]>,
  call: { dryerAction?: string | null } = {},
): Promise<FinalStagePlan<T>> {
  const plain: T[] = [];
  const left: LeftItem<T>[] = [];
  const carrying: Array<{ key: string; item: { b: T; checklists: PendingChecklist[] } }> = [];
  for (const b of batch) {
    const st = stateOf(b.filterId);
    if (!st) { left.push({ item: b, note: UNKNOWN }); continue; }
    if (!advanceMustCarryChecklist(st.stageLookup?.[targetState], st.disabledChecklistProfileIds, { targetState, dryerAction: call.dryerAction ?? null })) {
      plain.push(b);
      continue;
    }
    const checklists = await resolveChecklists(b.filterId);
    if (checklists.length === 0) { plain.push(b); continue; }
    carrying.push({ key: checklistSignature(checklists), item: { b, checklists } });
  }
  const chosen = largestGroup(carrying);
  const carry = chosen ? chosen.items.map((x) => x.b) : [];
  for (const c of carrying) {
    if (chosen && c.key !== chosen.key) left.push({ item: c.item.b, note: 'its profile asks a different checklist' });
  }
  return { plain, carry, checklists: chosen ? chosen.items[0].checklists : [], left };
}

/**
 * A checklist already waiting (the filter entered the stage, the checklist
 * after it is unanswered): one dialog for the largest group waiting on the SAME
 * checklist(s). A filter with another checklist, or none, stays out.
 */
export async function planPendingChecklistBatch<T extends BatchItem>(
  batch: T[],
  stateOf: StateOf,
  resolvePending: (filterId: string) => Promise<PendingChecklist[] | null>,
): Promise<{ ride: T[]; checklists: PendingChecklist[]; left: LeftItem<T>[] }> {
  const left: LeftItem<T>[] = [];
  const waiting: Array<{ key: string; item: { b: T; checklists: PendingChecklist[] } }> = [];
  for (const b of batch) {
    if (!stateOf(b.filterId)) { left.push({ item: b, note: UNKNOWN }); continue; }
    const checklists = await resolvePending(b.filterId);
    if (!checklists || checklists.length === 0) { left.push({ item: b, note: 'has no checklist waiting' }); continue; }
    waiting.push({ key: checklistSignature(checklists), item: { b, checklists } });
  }
  const chosen = largestGroup(waiting);
  for (const w of waiting) {
    if (chosen && w.key !== chosen.key) left.push({ item: w.item.b, note: 'is waiting on a different checklist' });
  }
  return {
    ride: chosen ? chosen.items.map((x) => x.b) : [],
    checklists: chosen ? chosen.items[0].checklists : [],
    left,
  };
}

/**
 * A cycle START is for filters with no cycle whose cleaning can start at this
 * stage. Sent to another, the start was written and the advance then refused —
 * a cycle started at no stage.
 */
export function splitNewCycleBatch<T extends BatchItem>(
  batch: T[],
  stateOf: StateOf,
  stageKey: string,
  firstStagesOf: (state: any) => string[],
): { ride: T[]; left: LeftItem<T>[] } {
  const ride: T[] = [];
  const left: LeftItem<T>[] = [];
  for (const b of batch) {
    const st = stateOf(b.filterId);
    if (!st) { left.push({ item: b, note: UNKNOWN }); continue; }
    if (st.currentCycle) { left.push({ item: b, note: 'is already in a cleaning cycle' }); continue; }
    const firsts = firstStagesOf(st);
    if (firsts.length > 0 && !firsts.includes(stageKey)) {
      left.push({ item: b, note: `its cleaning starts at ${firsts.map((s) => s.replace(/_/g, ' ')).join(', ')}` });
      continue;
    }
    ride.push(b);
  }
  return { ride, left };
}

/**
 * The ENABLED checklists between START and the first stage (2026-10-22: START is a
 * position; they are answered after start-cycle and gate the first entry). Read
 * from the pipeline graph, which current-state carries before a cycle starts too.
 */
export function startChecklistProfileIds(state: any): string[] {
  const g = state?.pipelineGraph;
  if (!g?.stages || !g?.connections) return [];
  const start = g.stages.find((s: any) => s.nodeType === 'START');
  if (!start) return [];
  const nodes = enabledChecklistNodes(collectChecklistsAfterStage(start, g.stages, g.connections), state?.disabledChecklistProfileIds);
  return [...new Set(nodes.map(checklistNodeProfileId).filter((id): id is string => !!id))];
}

export interface StartChecklistPlan<T extends BatchItem> {
  /** No checklist before the first stage: started and advanced as before. */
  none: T[];
  /** The largest group sharing ONE START checklist: asked first, nothing written until answered. */
  ask: T[];
  checklists: PendingChecklist[];
  left: LeftItem<T>[];
}

/**
 * A cycle START for profiles with a checklist before the first stage (2026-10-22).
 * Dialog first, nothing written: one dialog per distinct START checklist (the
 * largest group now; another stays queued). A filter whose START checklist cannot
 * be loaded stays queued too — started without it, its first entry is refused and
 * the cycle sits started at no stage.
 */
export async function planStartChecklistBatch<T extends BatchItem>(
  batch: T[],
  stateOf: StateOf,
  resolveStart: (filterId: string) => Promise<PendingChecklist[]>,
): Promise<StartChecklistPlan<T>> {
  const none: T[] = [];
  const left: LeftItem<T>[] = [];
  const asking: Array<{ key: string; item: { b: T; checklists: PendingChecklist[] } }> = [];
  for (const b of batch) {
    const st = stateOf(b.filterId);
    if (!st) { left.push({ item: b, note: UNKNOWN }); continue; }
    if (startChecklistProfileIds(st).length === 0) { none.push(b); continue; }
    const checklists = await resolveStart(b.filterId);
    if (checklists.length === 0) { left.push({ item: b, note: 'its first checklist could not be loaded — reconnect, then submit it again' }); continue; }
    asking.push({ key: checklistSignature(checklists), item: { b, checklists } });
  }
  const chosen = largestGroup(asking);
  for (const a of asking) {
    if (chosen && a.key !== chosen.key) left.push({ item: a.item.b, note: 'its profile asks a different first checklist' });
  }
  return { none, ask: chosen ? chosen.items.map((x) => x.b) : [], checklists: chosen ? chosen.items[0].checklists : [], left };
}

/** Where nothing else differs per filter: only a filter whose state could not be read stays out. */
export function splitUnread<T extends BatchItem>(batch: T[], stateOf: StateOf): { ride: T[]; left: LeftItem<T>[] } {
  const ride: T[] = [];
  const left: LeftItem<T>[] = [];
  for (const b of batch) {
    if (stateOf(b.filterId)) ride.push(b);
    else left.push({ item: b, note: UNKNOWN });
  }
  return { ride, left };
}

/** The operator-facing summary of the filters left in the queue. */
export function leftInQueueMessage(left: Array<LeftItem<BatchItem>>): string {
  if (left.length === 0) return '';
  return `Left in the queue — submit separately:\n${left.map((l) => `${l.item.filterName}: ${l.note}`).join('\n')}`;
}
