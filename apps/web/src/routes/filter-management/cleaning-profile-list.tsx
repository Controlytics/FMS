import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import type { CleaningProfile, PaginatedResponse } from '../../types/filter';

const FLOW_COLORS: Record<string, { bg: string; text: string }> = {
  STRICT: { bg: 'bg-red-50', text: 'text-red-700' },
  FLEXIBLE: { bg: 'bg-amber-50', text: 'text-amber-700' },
  LINEAR: { bg: 'bg-blue-50', text: 'text-blue-700' },
};

export function CleaningProfileListPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const canCreate = isSuperAdmin || perms.includes('CP_PAGE_CREATE');
  const canUpdate = isSuperAdmin || perms.includes('CP_PAGE_EDIT');
  const canDelete = isSuperAdmin || perms.includes('CP_PAGE_DELETE');
  const canToggle = isSuperAdmin || perms.includes('CP_TOGGLE');
  const reauth = useReauth();
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const swrKey = `/api/filter-cleaning-profiles?page=${page}&limit=20&status=${status}`;
  const { data, isLoading } = useSWR<PaginatedResponse<CleaningProfile>>(swrKey);

  const toggleStatus = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    reauth.execute('UPDATE_CLEANING_PROFILE', async (password?: string) => {
      try {
        if (password) await apiClient.patchWithReauth(`/api/filter-cleaning-profiles/${id}/toggle-status`, { toggle: true }, password);
        else await apiClient.patch(`/api/filter-cleaning-profiles/${id}/toggle-status`, { toggle: true });
        mutate(swrKey);
      } catch (err: any) {
        toast.error('Error', err.message || 'Failed to toggle status');
        throw err;
      }
    });
  };

  const profiles = (data?.data ?? []).filter(p =>
    !search || p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Cleaning Profiles</h1>
          <p className="text-sm text-slate-500 mt-1">Pipeline cleaning configurations for filter management</p>
        </div>
        {canCreate && (
          <button onClick={() => navigate('/filter-cleaning-profiles/new/edit')}
            className="px-5 py-2.5 text-white rounded-xl transition-all text-sm font-semibold shadow-lg flex items-center gap-2"
            style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Create Profile
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="rounded-2xl p-4 text-white shadow-lg" style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
          <div className="text-2xl font-bold">{data?.total ?? 0}</div>
          <div className="text-white/80 text-sm font-medium">
            {status === 'ACTIVE' ? 'Active Profiles' : 'Inactive Profiles'}
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">{profiles.reduce((s, p) => s + p.stageCount, 0)}</div>
              <div className="text-xs text-slate-400">Total Stages</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">{profiles.reduce((s, p) => s + p.connectionCount, 0)}</div>
              <div className="text-xs text-slate-400">Connections</div>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10" /></svg>
            </div>
            <div>
              <div className="text-lg font-bold text-slate-800">{data?.totalPages ?? 1}</div>
              <div className="text-xs text-slate-400">Pages</div>
            </div>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 outline-none focus:ring-2"
            style={{ '--tw-ring-color': 'color-mix(in srgb, var(--theme-primary) 20%, transparent)' } as React.CSSProperties}
            onFocus={e => e.currentTarget.style.borderColor = 'var(--theme-primary-light)'}
            onBlur={e => e.currentTarget.style.borderColor = ''}
            placeholder="Search profiles..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1 bg-slate-100 rounded-xl p-1">
          {[
            { key: 'ACTIVE', label: 'Active' },
            { key: 'INACTIVE', label: 'Inactive' },
          ].map(s => (
            <button key={s.key} onClick={() => { setStatus(s.key); setPage(1); }}
              className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${status === s.key
                ? 'bg-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700'}`}
              style={status === s.key ? { color: 'var(--theme-primary)' } : undefined}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {profiles.map((p) => {
            const flowColor = FLOW_COLORS[p.flowMode] ?? { bg: 'bg-slate-50', text: 'text-slate-600' };
            return (
              <div key={p.id}
                className={`bg-white border border-slate-200 rounded-2xl overflow-hidden transition-all duration-300 group ${canUpdate ? 'hover:shadow-xl cursor-pointer' : ''}`}
                onMouseEnter={e => canUpdate && (e.currentTarget.style.borderColor = 'var(--theme-primary-light)')}
                onMouseLeave={e => canUpdate && (e.currentTarget.style.borderColor = '')}
                onClick={() => canUpdate && navigate(`/filter-cleaning-profiles/${p.id}/edit`)}>
                <div className={`h-1.5 ${p.status === 'ACTIVE' ? '' : 'bg-gradient-to-r from-slate-300 to-slate-400'}`}
                  style={p.status === 'ACTIVE' ? { background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' } : undefined} />
                <div className="p-5">
                  <div className="flex items-start gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${p.status === 'ACTIVE' ? '' : 'bg-slate-100'}`}
                      style={p.status === 'ACTIVE' ? { background: 'color-mix(in srgb, var(--theme-primary) 15%, white)' } : undefined}>
                      <svg className={`w-5 h-5 ${p.status === 'ACTIVE' ? '' : 'text-slate-400'}`} style={p.status === 'ACTIVE' ? { color: 'var(--theme-primary)' } : undefined} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-800 truncate">{p.name}</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-slate-400">v{p.version}</span>
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${flowColor.bg} ${flowColor.text}`}>{p.flowMode}</span>
                      </div>
                    </div>
                  </div>

                  {/* Metrics */}
                  <div className="flex gap-3 mb-4">
                    <div className="flex-1 bg-blue-50 rounded-xl p-2.5 text-center">
                      <div className="text-lg font-bold text-blue-700">{p.stageCount}</div>
                      <div className="text-[10px] text-blue-500 font-medium">Stages</div>
                    </div>
                    <div className="flex-1 bg-teal-50 rounded-xl p-2.5 text-center">
                      <div className="text-lg font-bold text-teal-700">{p.connectionCount}</div>
                      <div className="text-[10px] text-teal-500 font-medium">Connections</div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold rounded-full ${
                      p.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : p.status === 'DRAFT' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${p.status === 'ACTIVE' ? 'bg-emerald-500' : p.status === 'DRAFT' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                      {p.status === 'ACTIVE' ? 'Active' : p.status === 'DRAFT' ? 'Draft' : 'Inactive'}
                    </span>
                    {canToggle && p.status !== 'DRAFT' && (
                      <button onClick={(e) => toggleStatus(p.id, e)}
                        className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${p.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-slate-300'}`}>
                        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform duration-200 ${p.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {profiles.length === 0 && (
            <div className="col-span-full text-center py-20">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-slate-100 flex items-center justify-center">
                <svg className="w-8 h-8 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
              </div>
              <p className="text-slate-500 font-medium">{search ? 'No profiles match your search' : `No ${status.toLowerCase()} profiles`}</p>
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {(data?.totalPages ?? 0) > 1 && (
        <div className="flex justify-center items-center gap-3">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            Previous
          </button>
          <div className="flex items-center gap-1">
            {Array.from({ length: Math.min(data?.totalPages ?? 1, 5) }, (_, i) => i + 1).map(p => (
              <button key={p} onClick={() => setPage(p)}
                className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${page === p ? 'text-white shadow-md' : 'text-slate-500 hover:bg-slate-100'}`}
                style={page === p ? { backgroundColor: 'var(--theme-primary)' } : undefined}>
                {p}
              </button>
            ))}
          </div>
          <button onClick={() => setPage(p => Math.min(data?.totalPages ?? 1, p + 1))} disabled={page === (data?.totalPages ?? 1)}
            className="px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-600 disabled:opacity-40 hover:bg-slate-50 transition-colors">
            Next
          </button>
        </div>
      )}
      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} />
    </div>
  );
}
