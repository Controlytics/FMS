/**
 * Deep-review scaffolding (2026-05-17) — D1 / D2 / D4.
 *
 * The defects:
 *   D1 — Six independent "should I open the checklist dialog?" call sites
 *        (three per page × two pages). Each calls `resolvePendingChecklistDialog`
 *        independently with different inputs (server actions vs local cache),
 *        no enforced invariant tying dialog visibility to the action tape.
 *   D2 — Cache row holds THREE storage shapes for "what comes next":
 *        `pendingChecklist[]`, `nextAllowedStages[]`, AND `actions[]`. They
 *        can disagree because writes update them separately.
 *   D4 — ~30 useState hooks per page, no state machine. Each dialog has its
 *        own open flag + form data + clear logic scattered across the file.
 *        Race between setChecklistDialog / setEquipDialog / close effects.
 *
 * The proper fix is a `useFilterOperationsCore()` hook that owns:
 *   - A tagged union DialogState that is the SOLE source of "which dialog is
 *     open and what data does it carry".
 *   - The action tape as the SOLE source of "what can the operator do next".
 *   - Per-dialog payload typing so the compiler rejects e.g.
 *     `setEquipDialog(...)` while DialogState.kind === 'awaiting_checklist'.
 *
 * This file is the SCAFFOLD. It defines the type contract + a transition
 * function. Migrating the existing 4256 lines of orchestration onto it is
 * deferred — that's a focused 3-5 day refactor that touches both page files
 * and cannot be done mid-session without breaking the running app.
 *
 * The invariant test in __tests__/dialog-state.test.ts asserts the
 * transition function rejects illegal moves; future page-code migration
 * should consume the hook produced from this scaffold so the type system
 * enforces the rule. See `tasks/REMOVE-RULECHAIN-ALARM-PLAN.md` sibling
 * doc for the multi-wave plan if this refactor is greenlit.
 */

import type { Action } from '@digilog/shared';

// ─── Tagged union of legal dialog states ──────────────────────────────────

export type DialogState =
  | { kind: 'none' }
  | {
      kind: 'awaiting_reason';
      filterId: string;
      filterName: string;
      stage: string;
      /** 2026-05-20: batch cycle-start. When the operator queued multiple
       *  filters that ALL need fresh cycles, the reason dialog opens once
       *  for the first filter and stashes the rest here. On completion of
       *  the reason → equipment → start-and-advance chain, the equipment
       *  submit handler iterates this list, applying the SAME reason +
       *  equipment readings to each remaining filter. Single-filter flow
       *  leaves this undefined. */
      remainingBatch?: { filterId: string; filterName: string }[];
    }
  | {
      kind: 'awaiting_equipment';
      filterId: string;
      filterName: string;
      stage: string;
      groups: unknown[];
      cycleGroup?: unknown;
      /** Batch continuation carried over from awaiting_reason. */
      remainingBatch?: { filterId: string; filterName: string }[];
    }
  | {
      kind: 'awaiting_dryer';
      filterId: string;
      filterName: string;
    }
  | {
      kind: 'awaiting_checklist';
      filterId: string;
      filterName: string;
      checklists: unknown[];
      /** Batch continuation queue — filters whose checklists must be shown next. */
      remainingBatch?: { filterId: string; filterName: string }[];
    }
  | {
      kind: 'awaiting_block_change';
      filterId: string;
      filterName: string;
      homeBlockId: string;
      homeBlockName: string;
      requestedBlockId: string;
      requestedBlockName: string;
    };

// ─── Events that drive transitions ────────────────────────────────────────

export type DialogEvent =
  | { type: 'close' }
  | { type: 'open_reason'; filterId: string; filterName: string; stage: string; remainingBatch?: { filterId: string; filterName: string }[] }
  | { type: 'open_equipment'; filterId: string; filterName: string; stage: string; groups: unknown[]; cycleGroup?: unknown; remainingBatch?: { filterId: string; filterName: string }[] }
  | { type: 'open_dryer'; filterId: string; filterName: string }
  | { type: 'open_checklist'; filterId: string; filterName: string; checklists: unknown[]; remainingBatch?: { filterId: string; filterName: string }[] }
  | { type: 'open_block_change'; filterId: string; filterName: string; homeBlockId: string; homeBlockName: string; requestedBlockId: string; requestedBlockName: string }
  | { type: 'advance_batch'; /** Walk remainingBatch in awaiting_checklist; close if empty. */ };

// ─── Pure transition function (invariant-enforcing) ───────────────────────

/**
 * The single rule the existing code violates by accident:
 *
 *   "At most one dialog is open at a time. Opening a new dialog while
 *    another is open is a programmer error unless the transition is
 *    explicitly allowed (e.g., reason → equipment chain on cycle-start)."
 *
 * This function throws on illegal transitions instead of silently letting
 * setChecklistDialog clobber setEquipDialog. Callers that want a soft
 * transition (e.g. user dismissed the equipment dialog before checklist
 * fired) must send a `close` event first.
 */
export function reduceDialogState(state: DialogState, event: DialogEvent): DialogState {
  switch (event.type) {
    case 'close':
      return { kind: 'none' };

    case 'open_reason':
      // Reason dialog can open from idle OR from a previous block-change
      // resolution (rare). Anything else is a programmer error.
      assertOpenable(state, ['none', 'awaiting_block_change']);
      return { kind: 'awaiting_reason', filterId: event.filterId, filterName: event.filterName, stage: event.stage, remainingBatch: event.remainingBatch };

    case 'open_equipment':
      // Equipment opens from idle (mid-cycle) OR from awaiting_reason
      // (cycle-start wash-in flow).
      assertOpenable(state, ['none', 'awaiting_reason']);
      return {
        kind: 'awaiting_equipment',
        filterId: event.filterId,
        filterName: event.filterName,
        stage: event.stage,
        groups: event.groups,
        cycleGroup: event.cycleGroup,
        remainingBatch: event.remainingBatch,
      };

    case 'open_dryer':
      // Dryer opens only from idle.
      assertOpenable(state, ['none']);
      return { kind: 'awaiting_dryer', filterId: event.filterId, filterName: event.filterName };

    case 'open_checklist':
      // Checklist opens from idle (pre-advance gate) OR from awaiting_equipment
      // (post-equipment-readings continuation). NEVER from awaiting_dryer or
      // awaiting_reason — the operator hasn't completed the prior gate.
      assertOpenable(state, ['none', 'awaiting_equipment']);
      return {
        kind: 'awaiting_checklist',
        filterId: event.filterId,
        filterName: event.filterName,
        checklists: event.checklists,
        remainingBatch: event.remainingBatch,
      };

    case 'open_block_change':
      // Block-change can interrupt almost anything (operator scanned a filter
      // belonging to a different block). Allowed from idle, awaiting_reason,
      // or awaiting_equipment.
      assertOpenable(state, ['none', 'awaiting_reason', 'awaiting_equipment']);
      return {
        kind: 'awaiting_block_change',
        filterId: event.filterId,
        filterName: event.filterName,
        homeBlockId: event.homeBlockId,
        homeBlockName: event.homeBlockName,
        requestedBlockId: event.requestedBlockId,
        requestedBlockName: event.requestedBlockName,
      };

    case 'advance_batch':
      // Only valid while a checklist dialog is open.
      if (state.kind !== 'awaiting_checklist') {
        throw new Error(`advance_batch invalid from state ${state.kind} — only valid during awaiting_checklist`);
      }
      const remaining = state.remainingBatch ?? [];
      if (remaining.length === 0) return { kind: 'none' };
      // Pop the first remaining filter — caller resolves its checklists and
      // dispatches a fresh open_checklist with the popped item + tail.
      // (We don't carry the checklists payload through the queue because it
      // must be re-resolved from the up-to-date tape per filter.)
      return state; // caller dispatches open_checklist next; this transition is just an "ack".
  }
}

function assertOpenable(state: DialogState, allowed: DialogState['kind'][]) {
  if (!allowed.includes(state.kind)) {
    throw new Error(
      `Cannot open dialog from state "${state.kind}"; allowed: ${allowed.join(', ')}. ` +
        `Dispatch { type: 'close' } first if the transition is intentional.`,
    );
  }
}

// ─── Tape-derived invariant ───────────────────────────────────────────────

/**
 * Future migration target: derive DialogState from the action tape so it
 * cannot drift. Today's pages set DialogState imperatively, which is the
 * D4 root cause. The next refactor wave will replace imperative
 * setChecklistDialog calls with `deriveDialogFromTape(actions)` and the
 * type system will reject illegal sets.
 *
 * Stub: returns 'awaiting_checklist' shape when the head action is
 * SUBMIT_CHECKLIST. Production caller must supply filterId + filterName
 * + the resolved checklist items.
 */
export function deriveDialogKindFromTape(actions: Action[]): DialogState['kind'] {
  const head = actions[0];
  if (!head) return 'none';
  if (head.type === 'SUBMIT_CHECKLIST') return 'awaiting_checklist';
  if (head.type === 'SET_DRYER_DURATION') return 'awaiting_dryer';
  // ADVANCE_TO_STAGE / other action types do not open a dialog — they are
  // operator-triggered. The dialog opens only when the tape is blocked.
  return 'none';
}
