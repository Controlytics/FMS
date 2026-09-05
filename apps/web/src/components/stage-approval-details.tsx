/**
 * The stage-details card on a cleaning-stage approval (2026-09-05, operator
 * request): for a Wash Out request the Wash In done time / readings / cleaning
 * reason / user and the Wash Out done time / user; for a Dry Out request the
 * dryer start, duration, temperature, end, user and the Dry Out done time /
 * user. ONE component for the desktop page and the tablet tab, so both read
 * the same server-derived `stageDetails` the same way.
 *
 * `onEdit` renders a pencil in the header — the desktop page passes it for a
 * SUPER_ADMIN (opens the cycle editor on the events these rows come from).
 */
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { stageDetailGroups, type StageDetails } from '@/lib/stage-approval';
import { PencilIcon } from '@/components/super-admin-record-edit';

export function StageApprovalDetailsCard({ stageKey, details, compact = false, onEdit }: {
  stageKey: string;
  details: StageDetails | null | undefined;
  /** Tablet sizing. */
  compact?: boolean;
  onEdit?: () => void;
}) {
  const { formatDateTime } = useDatetimeFormat();
  const groups = stageDetailGroups(stageKey, details, formatDateTime);
  if (groups.length === 0 && !onEdit) return null;
  const labelCls = compact ? 'text-[10px]' : 'text-[11px]';
  const valueCls = compact ? 'text-[12px]' : 'text-[13px]';
  return (
    <div className="space-y-2" data-testid="stage-details">
      {groups.map((g) => (
        <div key={g.title} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-100">
            <span className={`${labelCls} font-bold uppercase tracking-wider text-slate-500`}>{g.title}</span>
            {onEdit && g === groups[0] && (
              <button type="button" onClick={onEdit} title="Edit stage details (Super Admin)" aria-label="Edit stage details (Super Admin)"
                className="p-1 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors">
                <PencilIcon className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="divide-y divide-slate-100">
            {g.rows.map((row, i) => (
              <div key={`${row.label}-${i}`} className="flex items-center justify-between gap-3 px-3 py-1.5">
                <span className={`${labelCls} uppercase tracking-wider text-slate-400 shrink-0`}>{row.label}</span>
                <span className={`${valueCls} font-medium text-slate-700 text-right`}>{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && (
        <p className="text-[12px] text-slate-400">No stage details recorded for this request.</p>
      )}
    </div>
  );
}
