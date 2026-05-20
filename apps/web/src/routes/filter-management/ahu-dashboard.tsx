import { useState } from 'react';
import { useParams } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { BulkUploadFiltersDialog } from './components/bulk-upload-filters-dialog';
import { FILTER_STATE_COLORS } from '../../lib/filter-constants';

function FilterSetCard({ label, filters, status }: { label: string; filters: any[]; status: string }) {
  return (
    <div className={`bg-white border rounded-xl p-5 flex-1 ${status === 'IN_USE' ? 'border-green-600' : 'border-slate-300'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-slate-800">Set {label}</h3>
        <span className={`px-3 py-1 text-xs rounded-full font-medium ${status === 'IN_USE' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
          {status === 'IN_USE' ? 'In Use' : 'Spare'}
        </span>
      </div>
      <div className="space-y-2">
        {filters.length === 0 ? (
          <p className="text-slate-400 text-sm py-4 text-center">No filters assigned</p>
        ) : filters.map((f: any) => (
          <div key={f.id} className="bg-slate-50 rounded-lg p-3 flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${FILTER_STATE_COLORS[f.currentState] ?? 'bg-gray-500'}`} />
            <div className="flex-1">
              <div className="text-sm font-medium text-slate-700">{f.name}</div>
              <div className="text-xs text-slate-400">{f.currentState?.replace(/_/g, ' ') ?? 'No state'}</div>
            </div>
            {f.totalCycles !== undefined && <span className="text-xs text-slate-400">{f.totalCycles} cycles</span>}
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-slate-400 text-center">{filters.length} filter(s)</div>
    </div>
  );
}

export function AhuDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const { formatDateTime, formatDate, formatTime } = useDatetimeFormat();
  const { data: asset } = useSWR(id ? `/api/assets/instances/${id}` : null);
  // Max 1000 filters per AHU; if more exist, a warning banner below alerts the operator.
  // May 16 H19 tuning (2026-05-20): was 10s. With 1000-child AHU pages, this
  // pulled the same large payload 6×/min/operator. 30s halves API load and
  // still feels live for cleanroom workflows that take minutes per stage.
  const { data: childrenData } = useSWR(id ? `/api/assets/instances?parentId=${id}&limit=1000` : null, { refreshInterval: 30000 });
  const truncated = (childrenData?.total ?? 0) > ((childrenData?.data ?? []).length ?? 0);
  const { data: events } = useSWR(id ? `/api/filters/events?filterId=${id}&limit=10` : null);
  const [bulkOpen, setBulkOpen] = useState(false);

  const allChildren = ((childrenData?.data ?? []) as any[]).filter((f: any) => f.isActive !== false && f.status !== 'Retired');
  const setAFilters = allChildren.filter((f: any) => f.filterSet === 'SET_A').map((f: any) => ({
    id: f.id, name: f.name, currentState: f.currentLifecycleState, totalCycles: undefined,
  }));
  const setBFilters = allChildren.filter((f: any) => f.filterSet === 'SET_B').map((f: any) => ({
    id: f.id, name: f.name, currentState: f.currentLifecycleState, totalCycles: undefined,
  }));
  const unassignedFilters = allChildren.filter((f: any) => !f.filterSet).map((f: any) => ({
    id: f.id, name: f.name, currentState: f.currentLifecycleState, totalCycles: undefined,
  }));

  const setAStatus = setAFilters.some((f: any) => f.currentState) ? 'IN_USE' : 'SPARE';
  const setBStatus = setBFilters.some((f: any) => f.currentState) ? 'IN_USE' : 'SPARE';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold text-slate-800">{asset?.name ?? 'AHU Dashboard'}</h1>
          <span className="px-2 py-1 text-xs bg-slate-100 text-slate-500 rounded">{allChildren.length} filter(s)</span>
          {truncated && (
            <span className="px-2 py-1 text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded">
              Showing first {allChildren.length} of {childrenData.total} — contact admin
            </span>
          )}
        </div>
        <button onClick={() => setBulkOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-cyan-700 text-white rounded-lg text-sm hover:bg-cyan-600 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
          Bulk Upload Filters
        </button>
      </div>

      {/* Filter Set Cards */}
      <div className="flex gap-4 flex-col md:flex-row">
        <FilterSetCard label="A" filters={setAFilters} status={setAStatus} />
        <div className="flex items-center justify-center">
          <button disabled className="px-4 py-2 bg-slate-200 text-slate-500 rounded-lg text-sm cursor-not-allowed whitespace-nowrap" title="Coming soon">
            Swap Sets
          </button>
        </div>
        <FilterSetCard label="B" filters={setBFilters} status={setBStatus} />
      </div>

      {/* Unassigned filters */}
      {unassignedFilters.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-slate-800 mb-3">Unassigned Filters</h3>
          <div className="space-y-2">
            {unassignedFilters.map((f: any) => (
              <div key={f.id} className="bg-slate-50 rounded-lg p-3 flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${FILTER_STATE_COLORS[f.currentState] ?? 'bg-gray-500'}`} />
                <span className="text-sm text-slate-700">{f.name}</span>
                <span className="text-xs text-slate-400">{f.currentState?.replace(/_/g, ' ') ?? 'No state'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Activity */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-slate-800 mb-4">Recent Activity</h3>
        <div className="space-y-2">
          {(events?.data ?? []).length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No recent events</p>
          ) : (events?.data ?? []).map((e: any) => (
            <div key={e.id} className="flex items-center gap-3 py-2 border-b border-slate-200 last:border-0">
              <div className={`w-2 h-2 rounded-full ${e.eventType === 'BYPASS_DEVIATION' ? 'bg-red-500' : 'bg-cyan-500'}`} />
              <span className="text-sm text-slate-600 flex-1">{e.eventType.replace(/_/g, ' ')}</span>
              {e.toState && <span className="text-xs text-cyan-600">{e.toState.replace(/_/g, ' ')}</span>}
              <span className="text-xs text-slate-400">{formatDateTime(e.performedAt)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bulk Upload Dialog */}
      <BulkUploadFiltersDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        ahuId={id ?? ''}
        ahuName={asset?.name ?? 'AHU'}
        onSuccess={() => {
          mutate(id ? `/api/assets/instances?parentId=${id}&limit=200` : null);
        }}
      />
    </div>
  );
}
