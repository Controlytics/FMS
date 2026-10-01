import { useEffect, useState } from 'react';

/**
 * "A previous scheduled PM was not carried out" (2026-08-27).
 *
 * Shown when a PM cleaning is started on an AHU that still owes an earlier PM.
 * The operator gives a reason **per outstanding visit** — a January miss and a
 * March miss have different explanations, and an auditor asks about a specific
 * date, not about the AHU in general.
 *
 * One component for web AND tablet: the situation is identical on both, and the
 * tablet is where it happens most. Sized for touch (large hit areas, no hover-
 * only affordances) so it works on a glove-operated screen.
 *
 * The reasons are NOT a formality. Submitting them writes off the visits as
 * "Not Performed" with who / when / why — a signed statement that scheduled
 * maintenance did not happen. The dialog says so plainly rather than reading
 * like a dismissible warning.
 */

export interface PendingPmTask {
  entryId: string;
  ahuName: string;
  plannedDate: string;
  windowStart: string;
  windowEnd: string;
  overdueDays: number;
}

export interface PmPendingTasksDialogProps {
  tasks: PendingPmTask[];
  /** Minimum reason length the server will accept. */
  minReasonLength?: number;
  busy?: boolean;
  formatDate: (d: string) => string;
  onCancel: () => void;
  onConfirm: (skips: Array<{ entryId: string; reason: string }>) => void;
}

export function PmPendingTasksDialog({
  tasks,
  minReasonLength = 5,
  busy = false,
  formatDate,
  onCancel,
  onConfirm,
}: PmPendingTasksDialogProps) {
  const [reasons, setReasons] = useState<Record<string, string>>({});

  // Reset when a different set of tasks arrives, so a reason typed for one AHU
  // can never be submitted against another.
  useEffect(() => {
    setReasons({});
  }, [tasks.map((t) => t.entryId).join('|')]);

  const ok = (v: string | undefined) => (v ?? '').trim().length >= minReasonLength;
  const allAnswered = tasks.every((t) => ok(reasons[t.entryId]));

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="h-1.5 bg-gradient-to-r from-amber-500 to-orange-500" />

        <div className="px-6 pt-5 pb-3">
          <div className="mb-2 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50">
              <svg className="h-5 w-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="min-w-0">
              <h3 className="text-[15px] font-bold text-slate-800">
                Previous scheduled PM not carried out
              </h3>
              <p className="mt-0.5 text-[12px] text-slate-500">
                {tasks[0]?.ahuName} has {tasks.length} earlier scheduled visit
                {tasks.length === 1 ? '' : 's'} that {tasks.length === 1 ? 'was' : 'were'} never done.
                Say why before starting this cleaning.
              </p>
            </div>
          </div>
        </div>

        <div className="space-y-3 overflow-y-auto px-6 pb-4">
          {tasks.map((t) => {
            const value = reasons[t.entryId] ?? '';
            const short = minReasonLength - value.trim().length;
            return (
              <div key={t.entryId} className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-slate-800">
                    {formatDate(t.plannedDate)}
                  </span>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700">
                    {t.overdueDays} day{t.overdueDays === 1 ? '' : 's'} overdue
                  </span>
                  <span className="text-[11px] text-slate-400">
                    window {formatDate(t.windowStart)} – {formatDate(t.windowEnd)}
                  </span>
                </div>
                <textarea
                  value={value}
                  onChange={(e) => setReasons((p) => ({ ...p, [t.entryId]: e.target.value }))}
                  rows={2}
                  placeholder="Why was this scheduled cleaning not done?"
                  aria-label={`Reason the ${formatDate(t.plannedDate)} PM was not performed`}
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 outline-none transition-all focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  {short > 0
                    ? `${short} more character${short === 1 ? '' : 's'} required`
                    : 'Recorded against this visit in the audit trail.'}
                </p>
              </div>
            );
          })}

          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
            These visits will be recorded as <strong>Not Performed</strong> with your reason —
            they are not marked as completed, because the maintenance did not happen.
          </p>
        </div>

        <div className="flex items-center gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onConfirm(tasks.map((t) => ({ entryId: t.entryId, reason: (reasons[t.entryId] ?? '').trim() })))
            }
            disabled={busy || !allAnswered}
            title={allAnswered ? undefined : 'Give a reason for every outstanding visit'}
            className="flex-1 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 py-2.5 text-sm font-semibold text-white hover:from-amber-500 hover:to-orange-500 disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save reasons & start cleaning'}
          </button>
        </div>
      </div>
    </div>
  );
}
