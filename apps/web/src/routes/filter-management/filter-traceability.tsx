import { useState } from 'react';
import { useParams } from 'react-router-dom';
import useSWR from 'swr';

export function FilterTraceabilityPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<'events' | 'cycles' | 'deviations'>('events');
  const [page, setPage] = useState(1);

  const { data: filterState } = useSWR(id ? `/api/filters/${id}/current-state` : null);
  const { data: events } = useSWR(tab === 'events' && id ? `/api/filter/events?filterId=${id}&page=${page}&limit=20` : null);
  const { data: cycles } = useSWR(tab === 'cycles' && id ? `/api/filter/cycles?filterId=${id}&page=${page}&limit=20` : null);
  const { data: deviations } = useSWR(tab === 'deviations' && id ? `/api/filter/events?filterId=${id}&eventType=BYPASS_DEVIATION&page=${page}&limit=20` : null);

  const currentData = tab === 'events' ? events : tab === 'cycles' ? cycles : deviations;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h1 className="text-2xl font-bold text-gray-100 mb-2">{filterState?.filterName ?? 'Filter'} — Traceability</h1>
        <div className="flex gap-4 text-sm text-gray-400">
          {filterState?.currentState && (
            <span>State: <span className="text-cyan-400">{filterState.currentState.replace(/_/g, ' ')}</span></span>
          )}
          {filterState?.filterSet && <span>Set: <span className="text-gray-200">{filterState.filterSet.replace('SET_', '')}</span></span>}
          <span>Total Cycles: <span className="text-gray-200">{filterState?.totalCycles ?? 0}</span></span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 w-fit">
        {(['events', 'cycles', 'deviations'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setPage(1); }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${tab === t ? 'bg-cyan-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
            {t === 'events' ? 'Event Log' : t === 'cycles' ? 'Cycle History' : 'Deviations'}
          </button>
        ))}
      </div>

      {/* Content */}
      {tab === 'events' && (
        <div className="space-y-2">
          {(events?.data ?? []).map((e: any) => (
            <div key={e.id} className={`bg-gray-800 border-l-4 rounded-lg p-4 ${e.eventType === 'BYPASS_DEVIATION' ? 'border-red-500' : 'border-cyan-600'}`}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-gray-100">{e.eventType.replace(/_/g, ' ')}</span>
                <span className="text-xs text-gray-500">{new Date(e.performedAt).toLocaleString()}</span>
              </div>
              {(e.fromState || e.toState) && (
                <div className="text-sm text-gray-300">
                  {e.fromState?.replace(/_/g, ' ')} {e.fromState && e.toState && '→'} <span className="text-cyan-400">{e.toState?.replace(/_/g, ' ')}</span>
                </div>
              )}
              {e.remarks && <div className="text-sm text-gray-500 mt-1 italic">{e.remarks}</div>}
              <div className="text-xs text-gray-600 mt-1 font-mono">Checksum: {e.checksum?.slice(0, 16)}...</div>
            </div>
          ))}
          {(events?.data ?? []).length === 0 && <div className="text-center py-8 text-gray-500">No events recorded</div>}
        </div>
      )}

      {tab === 'cycles' && (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-sm">
                <th className="py-3 px-4">Code</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Started</th>
                <th className="py-3 px-4">Completed</th>
                <th className="py-3 px-4">#</th>
              </tr>
            </thead>
            <tbody>
              {(cycles?.data ?? []).map((c: any) => (
                <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/50">
                  <td className="py-3 px-4 font-mono text-cyan-400 text-sm">{c.cycleCode}</td>
                  <td className="py-3 px-4 text-gray-300 text-sm">{c.cleaningReasonLabel}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${c.status === 'COMPLETED' ? 'bg-green-900 text-green-300' : c.status === 'IN_PROGRESS' ? 'bg-blue-900 text-blue-300' : 'bg-red-900 text-red-300'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">{new Date(c.startedAt).toLocaleDateString()}</td>
                  <td className="py-3 px-4 text-gray-400 text-sm">{c.completedAt ? new Date(c.completedAt).toLocaleDateString() : '-'}</td>
                  <td className="py-3 px-4 text-gray-400">#{c.sequenceNumber}</td>
                </tr>
              ))}
              {(cycles?.data ?? []).length === 0 && <tr><td colSpan={6} className="py-8 text-center text-gray-500">No cycles</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'deviations' && (
        <div className="space-y-2">
          {(deviations?.data ?? []).map((e: any) => (
            <div key={e.id} className="bg-gray-800 border-l-4 border-red-500 rounded-lg p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-semibold text-red-300">BYPASS DEVIATION</span>
                <span className="text-xs text-gray-500">{new Date(e.performedAt).toLocaleString()}</span>
              </div>
              <div className="text-sm text-gray-300">
                {e.fromState?.replace(/_/g, ' ')} → <span className="text-red-400">{e.toState?.replace(/_/g, ' ')}</span>
              </div>
              {e.remarks && <div className="text-sm text-gray-400 mt-1">{e.remarks}</div>}
              {e.deviationDetails && (
                <div className="mt-2 px-3 py-2 bg-red-900/20 rounded text-xs text-red-300">
                  {JSON.stringify(e.deviationDetails)}
                </div>
              )}
            </div>
          ))}
          {(deviations?.data ?? []).length === 0 && <div className="text-center py-8 text-gray-500">No deviations recorded</div>}
        </div>
      )}

      {/* Pagination */}
      {currentData?.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50 text-gray-300">Prev</button>
          <span className="px-3 py-1 text-gray-400">{page} / {currentData.totalPages}</span>
          <button onClick={() => setPage(p => Math.min(currentData.totalPages, p + 1))} disabled={page === currentData.totalPages} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50 text-gray-300">Next</button>
        </div>
      )}
    </div>
  );
}
