import { useMemo } from 'react';
import useSWR from 'swr';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';

export function ReplacementListPage() {
  const { formatDate } = useDatetimeFormat();
  const { data, isLoading } = useSWR('/api/filters/replacements', { refreshInterval: 30000 });

  const replacements = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data;
  }, [data]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-700 shadow-lg shadow-blue-600/20">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Replacement List</h1>
          <p className="text-sm text-slate-500">{replacements.length} replacement(s)</p>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400">Loading replacements...</p>
        </div>
      ) : replacements.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
          <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
          </svg>
          <p className="text-slate-500 font-medium">No replacements yet</p>
          <p className="text-sm text-slate-400 mt-1">Filter replacements will appear here</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">S.No</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Old Filter ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">New Filter ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Replacement Date/Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Performed By</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {replacements.map((r: any, idx: number) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-500">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-red-600 line-through">{r.oldFilterName ?? '-'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-emerald-600">{r.newFilterName ?? '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{r.replacedAt ? formatDate(r.replacedAt) : '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-600">{r.performedBy ?? '-'}</td>
                    <td className="px-4 py-3 text-sm text-slate-500 max-w-xs truncate" title={r.remarks ?? ''}>{r.remarks ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-400">Showing {replacements.length} replacement(s)</p>
          </div>
        </div>
      )}
    </div>
  );
}
