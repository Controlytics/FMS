import { useMemo } from 'react';
import useSWR from 'swr';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';

export function RetirementListPage() {
  const { formatDate } = useDatetimeFormat();
  const { data, isLoading } = useSWR('/api/filters/retirements', { refreshInterval: 30000 });

  const retirements = useMemo(() => {
    if (!Array.isArray(data)) return [];
    return data;
  }, [data]);


  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-red-500 to-red-700 shadow-lg shadow-red-600/20">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Retirement List</h1>
          <p className="text-sm text-slate-500">{retirements.length} retired filter(s)</p>
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
          <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400">Loading retirements...</p>
        </div>
      ) : retirements.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
          <svg className="w-12 h-12 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
          <p className="text-slate-500 font-medium">No retired filters</p>
          <p className="text-sm text-slate-400 mt-1">Filters that are retired will appear here</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-200">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">S.No</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Filter ID</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Filter Set</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Retired Date/Time</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {retirements.map((r: any, idx: number) => (
                  <tr key={r.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 text-sm text-slate-500">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-medium text-slate-700">{r.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      {r.filterSet ? (
                        <span className={`text-xs px-2 py-0.5 rounded border ${r.filterSet === 'SET_A' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                          {r.filterSet === 'SET_A' ? 'Set A' : 'Set B'}
                        </span>
                      ) : <span className="text-xs text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-500">{r.updatedAt ? formatDate(r.updatedAt) : '-'}</td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2.5 py-1 rounded-full border font-medium bg-red-50 text-red-700 border-red-200">Retired</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
            <p className="text-xs text-slate-400">Showing {retirements.length} retired filter(s)</p>
          </div>
        </div>
      )}
    </div>
  );
}
