import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';

export function CleaningCycleHistoryPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [reasonKey, setReasonKey] = useState('');
  const { data, isLoading } = useSWR(`/api/filter/cycles?page=${page}&limit=20${status ? `&status=${status}` : ''}${reasonKey ? `&cleaningReasonKey=${reasonKey}` : ''}`);

  const REASON_COLORS: Record<string, string> = {
    PM: 'bg-blue-900 text-blue-300', TYPE_A: 'bg-purple-900 text-purple-300', TYPE_B: 'bg-indigo-900 text-indigo-300',
    TYPE_C: 'bg-sky-900 text-sky-300', ON_REQUEST: 'bg-amber-900 text-amber-300', CONTAMINATION: 'bg-red-900 text-red-300',
    FAILURE: 'bg-red-900 text-red-300', CUSTOM: 'bg-gray-700 text-gray-300',
  };

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold text-gray-100">Cleaning Cycle History</h1>

      <div className="flex gap-2 flex-wrap">
        {['', 'IN_PROGRESS', 'COMPLETED', 'TERMINATED'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm ${status === s ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-700 text-gray-400 text-sm">
                <th className="py-3 px-4">Cycle Code</th>
                <th className="py-3 px-4">Reason</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Started</th>
                <th className="py-3 px-4">Completed</th>
                <th className="py-3 px-4">Sequence</th>
              </tr>
            </thead>
            <tbody>
              {(data?.data ?? []).map((c: any) => (
                <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/cleaning-cycles/${c.id}`)}>
                  <td className="py-3 px-4 font-mono text-cyan-400 text-sm">{c.cycleCode}</td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${REASON_COLORS[c.cleaningReasonKey] ?? 'bg-gray-700 text-gray-300'}`}>
                      {c.cleaningReasonLabel}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <span className={`px-2 py-0.5 text-xs rounded-full ${c.status === 'COMPLETED' ? 'bg-green-900 text-green-300' : c.status === 'IN_PROGRESS' ? 'bg-blue-900 text-blue-300' : 'bg-red-900 text-red-300'}`}>
                      {c.status}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-gray-400 text-sm">{new Date(c.startedAt).toLocaleString()}</td>
                  <td className="py-3 px-4 text-gray-400 text-sm">{c.completedAt ? new Date(c.completedAt).toLocaleString() : '-'}</td>
                  <td className="py-3 px-4 text-gray-400">#{c.sequenceNumber}</td>
                </tr>
              ))}
              {(data?.data ?? []).length === 0 && (
                <tr><td colSpan={6} className="py-12 text-center text-gray-500">No cleaning cycles found</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {data?.totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50 text-gray-300">Prev</button>
          <span className="px-3 py-1 text-gray-400">{page} / {data.totalPages}</span>
          <button onClick={() => setPage(p => Math.min(data.totalPages, p + 1))} disabled={page === data.totalPages} className="px-3 py-1 bg-gray-700 rounded disabled:opacity-50 text-gray-300">Next</button>
        </div>
      )}
    </div>
  );
}
