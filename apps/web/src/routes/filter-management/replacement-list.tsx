import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';

const PAGE_SIZE = 20;

export function ReplacementListPage() {
  const { formatDate } = useDatetimeFormat();
  const { data, isLoading } = useSWR('/api/filters/replacements', { refreshInterval: 30000 });

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const replacements = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data;
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return replacements;
    return replacements.filter((r: any) =>
      (r.oldFilterName ?? '').toLowerCase().includes(q) ||
      (r.newFilterName ?? '').toLowerCase().includes(q) ||
      (r.performedBy ?? '').toLowerCase().includes(q) ||
      (r.remarks ?? '').toLowerCase().includes(q)
    );
  }, [replacements, search]);

  const stats = useMemo(() => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfWeek = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let today = 0, week = 0, month = 0;
    for (const r of replacements) {
      const t = r.replacedAt ? new Date(r.replacedAt).getTime() : 0;
      if (!t) continue;
      if (t >= startOfToday) today++;
      if (t >= startOfWeek) week++;
      if (t >= startOfMonth) month++;
    }
    return { total: replacements.length, today, week, month };
  }, [replacements]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div className="p-6 space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-cyan-500/25">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Replacement List</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            History of filters swapped out and replaced with new assets
          </p>
        </div>
      </div>

      {/* ─── Stat Cards ─── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-teal-500 to-cyan-600 rounded-2xl p-4 text-white shadow-lg shadow-cyan-500/20">
          <div className="text-2xl font-bold">{stats.total}</div>
          <div className="text-cyan-100 text-sm font-medium mt-0.5">Total Replacements</div>
        </div>
        <StatCard label="This Month" value={stats.month} iconBg="bg-amber-50" iconColor="text-amber-600" icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        } />
        <StatCard label="This Week" value={stats.week} iconBg="bg-indigo-50" iconColor="text-indigo-600" icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        } />
        <StatCard label="Today" value={stats.today} iconBg="bg-emerald-50" iconColor="text-emerald-600" icon={
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        } />
      </div>

      {/* ─── Search ─── */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-md">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by filter, performer, or remarks..."
            className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 outline-none transition-all"
          />
        </div>
      </div>

      {/* ─── Table / States ─── */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1.5 bg-gradient-to-r from-teal-400 to-cyan-500" />
          <div className="p-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-12 bg-slate-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1.5 bg-gradient-to-r from-teal-400 to-cyan-500" />
          <div className="p-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-50 to-cyan-50 flex items-center justify-center">
              <svg className="w-8 h-8 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <p className="text-slate-700 font-semibold">{search ? 'No matching replacements' : 'No replacements yet'}</p>
            <p className="text-sm text-slate-400 mt-1">
              {search ? 'Try a different search term' : 'Filter replacements will appear here'}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1.5 bg-gradient-to-r from-teal-400 to-cyan-500" />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200">
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider w-16">#</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Old Filter ID</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">New Filter ID</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Replaced On</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Performed By</th>
                  <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-500 uppercase tracking-wider">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {pageItems.map((r: any, idx: number) => (
                  <tr key={r.id} className="hover:bg-cyan-50/40 transition-colors">
                    <td className="px-5 py-3.5 text-sm text-slate-400 font-medium">
                      {(safePage - 1) * PAGE_SIZE + idx + 1}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-100 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                        {r.oldFilterName ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-100 font-semibold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        {r.newFilterName ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-600">
                      {r.replacedAt ? formatDate(r.replacedAt) : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      {r.performedBy ? (
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-100 to-teal-100 flex items-center justify-center text-xs font-bold text-cyan-700 shrink-0">
                            {getInitials(r.performedBy)}
                          </div>
                          <span className="text-sm text-slate-700 font-medium">{r.performedBy}</span>
                        </div>
                      ) : <span className="text-xs text-slate-300">—</span>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-500 max-w-xs">
                      <span className="block truncate" title={r.remarks ?? ''}>{r.remarks ?? '—'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Footer with pagination */}
          <div className="px-5 py-4 border-t border-slate-200 bg-slate-50/50 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-slate-500">
              Showing <span className="font-semibold text-slate-700">{(safePage - 1) * PAGE_SIZE + 1}</span>–
              <span className="font-semibold text-slate-700">{Math.min(safePage * PAGE_SIZE, filtered.length)}</span> of{' '}
              <span className="font-semibold text-slate-700">{filtered.length}</span>
            </p>
            {totalPages > 1 && (
              <Pagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Local Helpers ────────────────────────────────────────

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map(p => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function StatCard({ label, value, iconBg, iconColor, icon }: {
  label: string; value: number; iconBg: string; iconColor: string; icon: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-xl ${iconBg} flex items-center justify-center shrink-0`}>
          <svg className={`w-5 h-5 ${iconColor}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icon}
          </svg>
        </div>
        <div className="min-w-0">
          <div className="text-xl font-bold text-slate-800 leading-tight">{value}</div>
          <div className="text-xs text-slate-400 font-medium truncate">{label}</div>
        </div>
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, onPageChange }: {
  page: number; totalPages: number; onPageChange: (p: number) => void;
}) {
  const pages: (number | 'ellipsis')[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= page - 1 && i <= page + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== 'ellipsis') {
      pages.push('ellipsis');
    }
  }
  return (
    <div className="flex items-center gap-1">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page === 1}
        className="w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center transition-colors"
        aria-label="Previous page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      {pages.map((p, i) =>
        p === 'ellipsis' ? (
          <span key={`e-${i}`} className="w-9 h-9 flex items-center justify-center text-slate-400">…</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`w-9 h-9 rounded-lg text-sm font-semibold transition-colors ${
              p === page
                ? 'bg-gradient-to-br from-teal-500 to-cyan-600 text-white shadow-md shadow-cyan-500/25'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page === totalPages}
        className="w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent flex items-center justify-center transition-colors"
        aria-label="Next page"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
