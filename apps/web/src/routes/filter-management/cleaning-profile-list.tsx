import { useState } from 'react';
import useSWR from 'swr';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';


export function CleaningProfileListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useSWR(`/api/filter-cleaning-profiles?page=${page}&limit=20${status ? `&status=${status}` : ''}`);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Cleaning Profiles</h1>
        <button onClick={() => navigate('/filter-cleaning-profiles/new/edit')} className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors">
          Create Profile
        </button>
      </div>

      <div className="flex gap-2">
        {['', 'ACTIVE', 'DRAFT', 'ARCHIVED'].map(s => (
          <button key={s} onClick={() => { setStatus(s); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${status === s ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(data?.data ?? []).map((p: any) => (
            <div key={p.id} className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-cyan-600 transition-colors cursor-pointer"
              onClick={() => navigate(`/filter-cleaning-profiles/${p.id}/edit`)}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-gray-100">{p.name}</h3>
                <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${p.status === 'ACTIVE' ? 'bg-green-900 text-green-300' : p.status === 'DRAFT' ? 'bg-yellow-900 text-yellow-300' : 'bg-gray-700 text-gray-400'}`}>
                  {p.status}
                </span>
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-400">
                <span>v{p.version}</span>
                <span>{p.stageCount} stages</span>
                <span>{p.connectionCount} connections</span>
              </div>
            </div>
          ))}
          {(data?.data ?? []).length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-500">No cleaning profiles found</div>
          )}
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
