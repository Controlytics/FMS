/** Remaining Filters Dialog — AHU completion pre-flight (Task 7 + 2026-07-02 redesign).
 *
 * Shown BEFORE a filter's terminal (completing) checklist opens when sibling
 * filters in the same AHU have not all reached their final cleaning stage.
 *
 * POPUP mode  → informational; operator can Continue (open the checklist) or Cancel.
 * INTERLOCK mode → hard block; operator sees the full roster and must Close.
 *                  The server also enforces the interlock on submit-checklist
 *                  (422 AHU_INTERLOCK_PENDING) so the client block is UX-only.
 *
 * The body lists ALL filters under the AHU with their status — completed ones
 * marked with a green ✓, in-progress ones highlighted with their current stage.
 */

export interface AhuFilterRow {
  id: string;
  name: string;
  stage: string;
  done: boolean;
}

function prettyStageLabel(stage: string): string {
  if (!stage || stage === 'Not started') return stage || 'Not started';
  if (stage === 'CLEANING_CYCLE_COMPLETED') return 'Completed';
  return stage
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export interface RemainingFiltersDialogProps {
  mode: 'POPUP' | 'INTERLOCK';
  /** AHU display name shown in the header. */
  ahuName: string;
  /** All filters under the AHU (incl. the one being cleaned), with status. */
  filters: AhuFilterRow[];
  /** The filter currently being completed — tagged "(this filter)". */
  currentFilterId?: string;
  onContinue?: () => void;
  onCancel: () => void;
  error?: string;
}

export function RemainingFiltersDialog({
  mode,
  ahuName,
  filters,
  currentFilterId,
  onContinue,
  onCancel,
  error,
}: RemainingFiltersDialogProps) {
  const isInterlock = mode === 'INTERLOCK';
  const doneCount = filters.filter((f) => f.done).length;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">

        {/* Gradient header — amber for POPUP (warning), rose for INTERLOCK (block) */}
        <div
          className={`px-6 py-4 flex items-center gap-3 shrink-0 ${
            isInterlock
              ? 'bg-gradient-to-r from-rose-600 to-rose-700'
              : 'bg-gradient-to-r from-amber-500 to-orange-600'
          }`}
        >
          {isInterlock ? (
            /* Lock icon for hard block */
            <svg className="w-7 h-7 text-rose-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          ) : (
            /* Warning triangle for informational popup */
            <svg className="w-7 h-7 text-amber-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          )}
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-white truncate">AHU: {ahuName || '—'}</h2>
            <p className={`text-sm ${isInterlock ? 'text-rose-100' : 'text-amber-100'}`}>
              {isInterlock
                ? 'AHU interlock — cleaning completion blocked'
                : 'Other filters in this AHU are still in progress'}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <p className="text-sm text-slate-700">
            {isInterlock
              ? 'All filters in this AHU must reach their final cleaning stage before any filter can be completed. Current status:'
              : 'The following filters in this AHU have not all reached their final cleaning stage. You may continue anyway or wait for them to finish. Current status:'}
          </p>

          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wider">Filters under this AHU</span>
            <span>{doneCount}/{filters.length} completed</span>
          </div>

          {filters.length > 0 && (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {filters.map((f) => {
                const isCurrent = f.id === currentFilterId;
                return (
                  <li
                    key={f.id}
                    className={`flex items-center justify-between px-4 py-2.5 text-sm ${
                      f.done ? 'bg-emerald-50/40' : 'bg-white'
                    }`}
                  >
                    <span className="flex items-center gap-2 min-w-0 pr-4">
                      {f.done ? (
                        <svg className="w-4 h-4 text-emerald-600 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className={`w-2 h-2 rounded-full shrink-0 ${isInterlock ? 'bg-rose-500' : 'bg-amber-500'}`} />
                      )}
                      <span className="font-medium text-slate-800 truncate">{f.name}</span>
                      {isCurrent && (
                        <span className="shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                          this filter
                        </span>
                      )}
                    </span>
                    <span
                      className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
                        f.done
                          ? 'bg-emerald-100 text-emerald-700'
                          : isInterlock
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}
                    >
                      {f.done ? 'Completed' : prettyStageLabel(f.stage)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {error && (
            <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 shrink-0 flex gap-3">
          {isInterlock ? (
            /* INTERLOCK: single Close button — no Continue */
            <button
              onClick={onCancel}
              className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors"
            >
              Close
            </button>
          ) : (
            /* POPUP: Cancel stays, Continue proceeds */
            <>
              <button
                onClick={onCancel}
                className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onContinue}
                className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-400 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                </svg>
                Continue anyway
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
