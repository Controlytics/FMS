import { useState } from 'react';
import useSWR from 'swr';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';

interface DeviationRow {
  id: string;
  deviationNumber: string;
  ahuName: string;
  filterCount: number;
  scheduledDate: string;
  windowEnd: string;
  overdueDaysAtOpen: number;
  liveOverdueDays: number;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'CLOSED';
  acknowledgedByName: string | null;
  acknowledgedAt: string | null;
  passwordVerified: boolean;
  completedByName: string | null;
  completedAt: string | null;
  delayDays: number | null;
  closedAt: string | null;
  createdAt: string;
}

interface DeviationResponse {
  data: DeviationRow[];
  total: number;
  openCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

const STATUS_META: Record<DeviationRow['status'], { label: string; cls: string; dot: string }> = {
  OPEN:         { label: 'Open',         cls: 'bg-rose-50 text-rose-700 border-rose-200',       dot: 'bg-rose-500' },
  ACKNOWLEDGED: { label: 'Acknowledged', cls: 'bg-amber-50 text-amber-700 border-amber-200',    dot: 'bg-amber-500' },
  CLOSED:       { label: 'Closed',       cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
};

const TABS: { key: string; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'ACKNOWLEDGED', label: 'Acknowledged' },
  { key: 'CLOSED', label: 'Closed' },
];

export function DeviationsPage() {
  const { formatDate, formatDateTime } = useDatetimeFormat();
  const [status, setStatus] = useState('ALL');
  const [page, setPage] = useState(1);
  const perPage = 50;

  const params = new URLSearchParams({ page: String(page), limit: String(perPage) });
  if (status !== 'ALL') params.set('status', status);
  const { data, isLoading } = useSWR<DeviationResponse>(`/api/pm-schedules/deviations?${params}`, { refreshInterval: 30000 });

  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 pt-5 pb-4 border-b border-slate-100 bg-white shrink-0">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 shadow-lg shadow-rose-600/10">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 tracking-tight">Deviations</h1>
            <p className="text-[13px] text-slate-400 mt-0.5">
              {total.toLocaleString()} deviation{total === 1 ? '' : 's'}
              {data?.openCount ? ` · ${data.openCount} open` : ''} — overdue AHU filter cleaning audit trail
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {TABS.map(t => (
            <button key={t.key} onClick={() => { setStatus(t.key); setPage(1); }}
              className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all ${status === t.key ? 'bg-rose-600 text-white shadow-sm' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-8 h-8 border-2 border-rose-500 border-t-transparent rounded-full animate-spin" />
            <span className="text-[13px] text-slate-400">Loading deviations...</span>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <svg className="w-14 h-14 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-slate-400 font-medium text-[14px]">No deviations</span>
            <span className="text-[13px] text-slate-300">Overdue AHU cleaning tasks appear here automatically</span>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Deviation #', 'AHU', 'Filters', 'Scheduled', 'Overdue', 'Status', 'Acknowledged By', 'Completed By', 'Completed', 'Delay'].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(d => {
                  const sm = STATUS_META[d.status];
                  return (
                    <tr key={d.id} className="hover:bg-rose-50/20 transition-colors">
                      <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 whitespace-nowrap">{d.deviationNumber}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-700">{d.ahuName}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-600 text-center tabular-nums">{d.filterCount}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{formatDate(d.scheduledDate)}</td>
                      <td className="px-4 py-3 text-[13px] whitespace-nowrap">
                        <span className={d.status === 'CLOSED' ? 'text-slate-500' : 'text-rose-600 font-semibold'}>
                          {d.status === 'CLOSED' ? `${d.delayDays ?? d.overdueDaysAtOpen}d delay` : `${d.liveOverdueDays}d`}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-full border ${sm.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sm.dot}`} />{sm.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[13px] text-slate-700 whitespace-nowrap">
                        {d.acknowledgedByName ?? '—'}
                        {d.passwordVerified && <span className="ml-1 text-emerald-500" title="Password verified">✓</span>}
                      </td>
                      <td className="px-4 py-3 text-[13px] text-slate-700 whitespace-nowrap">{d.completedByName ?? '—'}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap">{d.completedAt ? formatDateTime(d.completedAt) : '—'}</td>
                      <td className="px-4 py-3 text-[13px] text-slate-600 text-center tabular-nums">{d.delayDays != null ? `${d.delayDays}d` : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {rows.length > 0 && totalPages > 1 && (
        <div className="px-6 py-3 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between">
          <span className="text-[13px] text-slate-500">Page {page} of {totalPages} · {total} total</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 h-9 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30">Previous</button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="px-3 h-9 rounded-lg text-[13px] font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}
