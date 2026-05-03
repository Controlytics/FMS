/**
 * Pending-checklist dialog resolution — Phase 8.7 Wave-5 split.
 *
 * The pattern below appears 8x in `routes/filter-management/filter-operations.tsx`
 * (desktop) and 6x in `routes/mobile/mobile-operations.tsx` (tablet):
 *
 *   const tape = await getCurrentActions(filterId, serverActions);
 *   if (hasActionKind(tape, 'SUBMIT_CHECKLIST')) {
 *     let rows = dialogChecklistsFromActions(tape);
 *     if (rows.length === 0 || rows.every(c => (c.questions?.length ?? 0) === 0)) {
 *       rows = await getCachedPendingChecklists(filterId);
 *     }
 *     if (rows.length > 0) { setChecklistDialog({ ... }); }
 *   }
 *
 * `resolvePendingChecklistDialog` consolidates the resolution. The caller
 * still owns the `setChecklistDialog(...)` wiring because the dialog state
 * shape differs between desktop and mobile (desktop carries
 * `PendingChecklist[]` typed; mobile uses `any[]`).
 *
 * Returns:
 *   - `null` when the tape has no SUBMIT_CHECKLIST actions OR neither the
 *     tape nor the cache produced any rows. Caller does NOT pop a dialog.
 *   - `PendingChecklist[]` (always non-empty) when a dialog should be shown.
 *
 * Tier-1 (server actions): when `serverActions` is non-empty,
 * `getCurrentActions` returns it verbatim; we derive rows from those.
 * Tier-2 (local executor): `getCurrentActions` calls
 * `executor.computeNextActions(loadLocalContextFromCache(filterId))` and we
 * derive rows from that tape.
 * Tier-3 (cached payload): the legacy server response (TAPE_PARALLEL=false)
 * carries `SUBMIT_CHECKLIST` actions WITHOUT inline questions — we fall back
 * to the cached `pendingChecklist[]` shape on the `filter-state-{id}` row,
 * which the dialog renders identically.
 */

import type { Action } from '@digilog/shared';
import {
  getCurrentActions,
  hasActionKind,
} from '@/lib/action-tape';
import {
  dialogChecklistsFromActions,
  getCachedPendingChecklists,
} from '@/lib/offline-cache';
import type { PendingChecklist } from './types';

/**
 * Resolve the dialog payload for a filter's post-stage checklist gate.
 *
 * @param filterId - the filter whose pending-checklist should be resolved
 * @param serverActions - optional `actions[]` carried on the just-received
 *   server response (e.g. an /advance result). When non-empty, the resolver
 *   trusts the server tape; otherwise it computes locally via the executor.
 * @returns `null` when no dialog should be shown; otherwise a non-empty
 *   `PendingChecklist[]` ready to feed `setChecklistDialog({ checklists: ... })`.
 */
export async function resolvePendingChecklistDialog(
  filterId: string,
  serverActions?: Action[] | null,
): Promise<PendingChecklist[] | null> {
  const tape = await getCurrentActions(filterId, serverActions);
  if (!hasActionKind(tape, 'SUBMIT_CHECKLIST')) return null;

  let rows: PendingChecklist[] = dialogChecklistsFromActions(tape) as PendingChecklist[];
  if (rows.length === 0 || rows.every((c) => (c.questions?.length ?? 0) === 0)) {
    rows = (await getCachedPendingChecklists(filterId)) as PendingChecklist[];
  }
  return rows.length > 0 ? rows : null;
}
