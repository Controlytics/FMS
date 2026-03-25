import { useParams } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';


const STATE_COLORS: Record<string, string> = {
  INSTALLED: 'bg-blue-600', TO_BE_CLEANED: 'bg-red-500', WASH_IN: 'bg-sky-500', WASH_OUT: 'bg-sky-500',
  DRY_IN: 'bg-amber-500', DRY_OUT: 'bg-amber-500', STORAGE_IN: 'bg-gray-500', STORAGE_OUT: 'bg-gray-500',
  READY_FOR_USE: 'bg-green-500', IN_USE: 'bg-emerald-500', RETIRED: 'bg-red-800',
};

function FilterSetCard({ label, filters, status }: { label: string; filters: any[]; status: string }) {
  return (
    <div className={`bg-gray-800 border rounded-xl p-5 flex-1 ${status === 'IN_USE' ? 'border-green-600' : 'border-gray-600'}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-100">Set {label}</h3>
        <span className={`px-3 py-1 text-xs rounded-full font-medium ${status === 'IN_USE' ? 'bg-green-900 text-green-300' : 'bg-gray-700 text-gray-400'}`}>
          {status === 'IN_USE' ? 'In Use' : 'Spare'}
        </span>
      </div>
      <div className="space-y-2">
        {filters.length === 0 ? (
          <p className="text-gray-500 text-sm py-4 text-center">No filters assigned</p>
        ) : filters.map((f: any) => (
          <div key={f.id} className="bg-gray-900 rounded-lg p-3 flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${STATE_COLORS[f.currentState] ?? 'bg-gray-500'}`} />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-200">{f.name}</div>
              <div className="text-xs text-gray-500">{f.currentState?.replace(/_/g, ' ') ?? 'No state'}</div>
            </div>
            {f.totalCycles !== undefined && <span className="text-xs text-gray-500">{f.totalCycles} cycles</span>}
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-gray-500 text-center">{filters.length} filter(s)</div>
    </div>
  );
}

export function AhuDashboardPage() {
  const { id } = useParams<{ id: string }>();
  const { data: asset } = useSWR(id ? `/api/assets/instances/${id}` : null);
  const { data: events } = useSWR(id ? `/api/filter/events?filterId=${id}&limit=10` : null);

  // For now, show asset info with placeholder filter sets
  const setA = { status: 'IN_USE', filters: [] };
  const setB = { status: 'SPARE', filters: [] };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <h1 className="text-2xl font-bold text-gray-100">{asset?.name ?? 'AHU Dashboard'}</h1>
        {asset?.organizationId && <span className="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded">Org: {asset.organizationId}</span>}
      </div>

      {/* Filter Set Cards */}
      <div className="flex gap-4 flex-col md:flex-row">
        <FilterSetCard label="A" filters={setA.filters} status={setA.status} />
        <div className="flex items-center justify-center">
          <button className="px-4 py-2 bg-amber-700 text-white rounded-lg text-sm hover:bg-amber-600 transition-colors whitespace-nowrap">
            Swap Sets
          </button>
        </div>
        <FilterSetCard label="B" filters={setB.filters} status={setB.status} />
      </div>

      {/* Recent Activity */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-gray-100 mb-4">Recent Activity</h3>
        <div className="space-y-2">
          {(events?.data ?? []).length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-4">No recent events</p>
          ) : (events?.data ?? []).map((e: any) => (
            <div key={e.id} className="flex items-center gap-3 py-2 border-b border-gray-700 last:border-0">
              <div className={`w-2 h-2 rounded-full ${e.eventType === 'BYPASS_DEVIATION' ? 'bg-red-500' : 'bg-cyan-500'}`} />
              <span className="text-sm text-gray-300 flex-1">{e.eventType.replace(/_/g, ' ')}</span>
              {e.toState && <span className="text-xs text-cyan-400">{e.toState.replace(/_/g, ' ')}</span>}
              <span className="text-xs text-gray-500">{new Date(e.performedAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
