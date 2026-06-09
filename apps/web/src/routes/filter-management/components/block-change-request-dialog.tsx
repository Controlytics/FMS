interface BlockChangeRequestDialogProps {
  dialog: {
    filterId: string;
    filterName: string;
    homeBlockId: string;
    homeBlockName: string;
    requestedBlockId: string;
    requestedBlockName: string;
  } | null;
  reason: string;
  onReasonChange: (value: string) => void;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * Operator-facing "this filter belongs to a different block" approval prompt.
 *
 * Extracted from filter-operations.tsx where it was inlined twice — once inside
 * the stage-operations render branch and once inside the main page render
 * branch — and the two copies had drifted (placeholder copy + asterisk styling).
 * Now there's one source of truth.
 */
export function BlockChangeRequestDialog({
  dialog,
  reason,
  onReasonChange,
  submitting,
  onSubmit,
  onCancel,
}: BlockChangeRequestDialogProps) {
  if (!dialog) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-amber-500 to-orange-500" />
        <div className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-800">Cleaning in a different block</h3>
              <p className="text-xs text-slate-400">This filter belongs to another block</p>
            </div>
          </div>
          <div className="space-y-3 mb-5">
            <div className="bg-slate-50 rounded-xl p-3 text-sm">
              <div className="text-slate-500">
                Filter: <span className="font-semibold text-slate-800">{dialog.filterName}</span>
              </div>
              <div className="text-slate-500 mt-1">
                Belongs to: <span className="font-semibold text-slate-800">{dialog.homeBlockName}</span>
              </div>
              <div className="text-slate-500 mt-1">
                Cleaning in: <span className="font-semibold text-amber-700">{dialog.requestedBlockName}</span>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              This filter belongs to <span className="font-semibold">{dialog.homeBlockName}</span>. You are cleaning it in{' '}
              <span className="font-semibold text-amber-700">{dialog.requestedBlockName}</span>. Continue with cleaning?
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-xl text-sm font-medium"
            >
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={submitting}
              className="flex-1 py-2.5 bg-gradient-to-r from-cyan-600 to-teal-600 text-white rounded-xl text-sm font-semibold disabled:opacity-50 shadow-lg shadow-cyan-500/25"
            >
              Continue with cleaning
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
