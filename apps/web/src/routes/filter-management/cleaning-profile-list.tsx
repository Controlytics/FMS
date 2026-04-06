import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { useToast } from '@/hooks/use-toast';
import type { CleaningProfile, PaginatedResponse } from '../../types/filter';

export function CleaningProfileListPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const swrKey = `/api/filter-cleaning-profiles?page=${page}&limit=20${status ? `&status=${status}` : ''}`;
  const { data, isLoading } = useSWR<PaginatedResponse<CleaningProfile>>(swrKey);

  const toggleStatus = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiClient.patch(`/api/filter-cleaning-profiles/${id}/toggle-status`, { toggle: true });
      mutate(swrKey);
    } catch (err: any) {
      toast.error('Error', err.message || 'Failed to toggle status');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Cleaning Profiles</h1>
        <button onClick={() => navigate('/filter-cleaning-profiles/new/edit')} className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors text-sm font-medium">
          Create Profile
        </button>
      </div>

      <div className="flex gap-2">
        {[
          { key: '', label: 'All' },
          { key: 'ACTIVE', label: 'Active' },
          { key: 'INACTIVE', label: 'Inactive' },
        ].map(s => (
          <button key={s.key} onClick={() => { setStatus(s.key); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${status === s.key ? 'bg-cyan-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {s.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(data?.data ?? []).map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-5 hover:border-cyan-400 transition-colors cursor-pointer shadow-sm"
              onClick={() => navigate(`/filter-cleaning-profiles/${p.id}/edit`)}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-slate-800">{p.name}</h3>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-500 mb-3">
                <span>v{p.version}</span>
                <span>{p.stageCount} stages</span>
                <span>{p.connectionCount} connections</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-slate-200">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium ${p.status === 'ACTIVE' ? 'text-green-600' : 'text-slate-400'}`}>
                    {p.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    onClick={(e) => toggleStatus(p.id, e)}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${p.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-300'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${p.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {(data?.data ?? []).length === 0 && (
            <div className="col-span-full text-center py-12 text-slate-400">No cleaning profiles found</div>
          )}
        </div>
      )}

      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex justify-center gap-2">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 bg-slate-100 rounded disabled:opacity-50 text-slate-600">Prev</button>
          <span className="px-3 py-1 text-slate-500">{page} / {data?.totalPages}</span>
          <button onClick={() => setPage(p => Math.min(data?.totalPages ?? 1, p + 1))} disabled={page === (data?.totalPages ?? 1)} className="px-3 py-1 bg-slate-100 rounded disabled:opacity-50 text-slate-600">Next</button>
        </div>
      )}
    </div>
  );
}
