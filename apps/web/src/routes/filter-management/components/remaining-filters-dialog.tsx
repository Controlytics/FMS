/** Remaining Filters Dialog — AHU completion pre-flight (Task 7).
 *
 * Shown before a filter's checklist is submitted when sibling filters in the
 * same AHU have not yet reached their final cleaning stage.
 *
 * POPUP mode  → informational; operator can Continue or Cancel.
 * INTERLOCK mode → hard block; operator sees the pending list and must close.
 *                  The server also enforces the interlock on submit-checklist
 *                  (422 AHU_INTERLOCK_PENDING) so the client block is UX-only.
 */

function prettyStageLabel(stage: string): string {
  if (!stage || stage === 'Not started') return stage || 'Not started';
  return stage
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

export interface RemainingFiltersDialogProps {
  mode: 'POPUP' | 'INTERLOCK';
  pending: { id: string; name: string; stage: string }[];
  onContinue?: () => void;
  onCancel: () => void;
  loading?: boolean;
  error?: string;
}

export function RemainingFiltersDialog({
  mode,
  pending,
  onContinue,
  onCancel,
  loading,
  error,
}: RemainingFiltersDialogProps) {
  const isInterlock = mode === 'INTERLOCK';

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
          <div>
            <h2 className="text-lg font-bold text-white">Remaining Filters</h2>
            <p className={`text-sm ${isInterlock ? 'text-rose-100' : 'text-amber-100'}`}>
              {isInterlock
                ? 'AHU interlock — cleaning blocked'
                : 'AHU — other filters still in progress'}
            </p>
          </div>
        </div>

        {/* Body */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <p className="text-sm text-slate-700">
            {isInterlock
              ? 'All filters in this AHU must reach their final cleaning stage before any can be completed. The following filters are still in progress:'
              : 'The following filters in this AHU have not yet reached their final cleaning stage. You may continue or wait for them to complete first.'}
          </p>

          {pending.length > 0 && (
            <ul className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {pending.map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between px-4 py-2.5 bg-white text-sm"
                >
                  <span className="font-medium text-slate-800 truncate pr-4">{f.name}</span>
                  <span
                    className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full ${
                      isInterlock
                        ? 'bg-rose-50 text-rose-700'
                        : 'bg-amber-50 text-amber-700'
                    }`}
                  >
                    {prettyStageLabel(f.stage)}
                  </span>
                </li>
              ))}
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
              disabled={loading}
              className="flex-1 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-40"
            >
              Close
            </button>
          ) : (
            /* POPUP: Cancel stays, Continue proceeds */
            <>
              <button
                onClick={onCancel}
                disabled={loading}
                className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={onContinue}
                disabled={loading}
                className="flex-1 py-3 bg-amber-500 text-white rounded-xl font-bold hover:bg-amber-400 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                    </svg>
                    Continue
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
