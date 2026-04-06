import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { FILTER_STATE_COLORS } from '@/lib/filter-constants';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { api } from '@/lib/api-client';

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  INSTALLED: { label: 'Installed', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  WASH_IN: { label: 'Wash In', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  WASH_OUT: { label: 'Wash Out', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  DRY_IN: { label: 'Dry In', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  DRY_OUT: { label: 'Dry Out', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  STORAGE_IN: { label: 'Storage In', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  STORAGE_OUT: { label: 'Storage Out', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  IN_USE: { label: 'In Use', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  RETIRED: { label: 'Retired', color: 'bg-red-50 text-red-700 border-red-200' },
};

const LIFECYCLE_STATE_OPTIONS = [
  { value: 'INSTALLED', label: 'Installed', color: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'WASH_IN', label: 'Wash In', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'WASH_OUT', label: 'Wash Out', color: 'bg-sky-50 text-sky-700 border-sky-200' },
  { value: 'DRY_IN', label: 'Dry In', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'DRY_OUT', label: 'Dry Out', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  { value: 'STORAGE_IN', label: 'Storage In', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  { value: 'STORAGE_OUT', label: 'Storage Out', color: 'bg-slate-50 text-slate-600 border-slate-200' },
  { value: 'IN_USE', label: 'In Use', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
];

export function FilterListPage() {
  const { formatDate } = useDatetimeFormat();
  const { toast } = useToast();
  const reauth = useReauth();
  const [selectedBlock, setSelectedBlock] = useState<string | null>(null);
  const [panelFilter, setPanelFilter] = useState<{ id: string; name: string } | null>(null);
  const [panelAction, setPanelAction] = useState<'retire' | 'replace'>('retire');
  const [panelRemarks, setPanelRemarks] = useState('');
  const [panelSubmitting, setPanelSubmitting] = useState(false);

  // Lifecycle state update panel
  const [statusPanelFilter, setStatusPanelFilter] = useState<{ id: string; name: string; currentState: string | null } | null>(null);
  const [statusPanelState, setStatusPanelState] = useState('');
  const [statusPanelRemarks, setStatusPanelRemarks] = useState('');
  const [statusPanelSubmitting, setStatusPanelSubmitting] = useState(false);

  const { data: templatesData } = useSWR('/api/assets/templates?limit=100');
  const { data: instancesData, isLoading } = useSWR('/api/assets/instances?limit=500', { refreshInterval: 30000 });

  const templates = (templatesData?.data ?? []) as any[];
  const instances = (instancesData?.data ?? []) as any[];

  const blockTemplateId = templates.find((t: any) => t.name === 'Block')?.id;
  const filterTemplateId = templates.find((t: any) => t.name === 'Filter')?.id;
  const ahuTemplateId = templates.find((t: any) => t.name === 'AHU')?.id;

  const blocks = useMemo(() =>
    instances.filter((i: any) => i.templateId === blockTemplateId),
    [instances, blockTemplateId]
  );

  const instanceMap = useMemo(() => {
    const map = new Map<string, any>();
    instances.forEach((i: any) => map.set(i.id, i));
    return map;
  }, [instances]);

  const blockIds = useMemo(() => new Set(blocks.map((b: any) => b.id)), [blocks]);

  const allFilters = useMemo(() =>
    instances.filter((i: any) => i.templateId === filterTemplateId && i.isActive !== false && i.status !== 'Retired'),
    [instances, filterTemplateId]
  );

  // Walk up parent chain to find Block and AHU ancestors
  const resolveAncestors = (filterId: string) => {
    let ahuId: string | null = null;
    let ahuName = '-';
    let blockId: string | null = null;
    let blockName = '-';
    let currentId = instanceMap.get(filterId)?.parentId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const entity = instanceMap.get(currentId);
      if (!entity) break;
      if (entity.templateId === ahuTemplateId && !ahuId) {
        ahuId = entity.id;
        ahuName = entity.name;
      }
      if (blockIds.has(entity.id)) {
        blockId = entity.id;
        blockName = entity.name;
        break;
      }
      currentId = entity.parentId;
    }
    return { ahuId, ahuName, blockId, blockName };
  };

  const enrichedFilters = useMemo(() => {
    return allFilters.map((f: any) => {
      const { ahuId, ahuName, blockId, blockName } = resolveAncestors(f.id);
      return {
        id: f.id, name: f.name, filterSet: f.filterSet,
        currentState: f.currentLifecycleState,
        status: f.status ?? 'Active',
        ahuId, ahuName, blockId, blockName,
        filterType: f.attributes?.filterType ?? '-',
        filterSize: f.attributes?.filterSize ?? '-',
        lastCleaningDate: f.attributes?.lastCleaningDate ?? null,
      };
    });
  }, [allFilters, instanceMap, ahuTemplateId, blockIds]);

  // Count filters per block
  const blockCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    enrichedFilters.forEach(f => {
      if (f.blockId) counts[f.blockId] = (counts[f.blockId] ?? 0) + 1;
    });
    return counts;
  }, [enrichedFilters]);

  // Filters for the selected block
  const blockFilters = useMemo(() => {
    if (!selectedBlock) return [];
    return enrichedFilters.filter(f => f.blockId === selectedBlock);
  }, [enrichedFilters, selectedBlock]);

  const selectedBlockName = selectedBlock ? (instanceMap.get(selectedBlock)?.name ?? 'Block') : '';

  const openStatusPanel = (filter: { id: string; name: string; currentState: string | null }) => {
    closePanel(); // close retire panel if open
    setStatusPanelFilter(filter);
    setStatusPanelState(filter.currentState ?? 'INSTALLED');
    setStatusPanelRemarks('');
  };

  const closeStatusPanel = () => {
    setStatusPanelFilter(null);
    setStatusPanelRemarks('');
    setStatusPanelSubmitting(false);
  };

  const handleStatusSubmit = () => {
    if (!statusPanelFilter || !statusPanelRemarks.trim() || !statusPanelState) return;
    if (statusPanelState === (statusPanelFilter.currentState ?? '')) return;
    setStatusPanelSubmitting(true);

    reauth.execute(
      'UPDATE_ASSET',
      async (password?: string) => {
        const body = { lifecycleState: statusPanelState, remarks: statusPanelRemarks.trim() };
        if (password) {
          await api.patchWithReauth(`/api/assets/instances/${statusPanelFilter.id}/lifecycle-state`, body, password);
        } else {
          await api.patch(`/api/assets/instances/${statusPanelFilter.id}/lifecycle-state`, body);
        }
      },
      {
        onSuccess: () => {
          const label = LIFECYCLE_STATE_OPTIONS.find(o => o.value === statusPanelState)?.label ?? statusPanelState;
          toast.success('Status Updated', `${statusPanelFilter.name} updated to ${label}`);
          closeStatusPanel();
          mutate('/api/assets/instances?limit=500');
        },
        onError: (err: any) => {
          toast.error('Update Failed', err.message ?? 'Something went wrong');
          setStatusPanelSubmitting(false);
        },
      },
    );
  };

  const openPanel = (filter: { id: string; name: string }) => {
    closeStatusPanel(); // close status panel if open
    setPanelFilter(filter);
    setPanelAction('retire');
    setPanelRemarks('');
  };

  const closePanel = () => {
    setPanelFilter(null);
    setPanelRemarks('');
    setPanelSubmitting(false);
  };

  const handlePanelSubmit = async () => {
    if (!panelFilter || !panelRemarks.trim()) return;
    setPanelSubmitting(true);
    try {
      const endpoint = panelAction === 'retire'
        ? `/api/filters/${panelFilter.id}/retire`
        : `/api/filters/${panelFilter.id}/replace`;
      const result = await api.post<any>(endpoint, { remarks: panelRemarks.trim() });
      if (panelAction === 'replace' && result.newFilterName) {
        toast.success('Filter Replaced', `New filter created: ${result.newFilterName}`);
      } else {
        toast.success('Filter Retired', `${panelFilter.name} has been retired`);
      }
      closePanel();
      mutate('/api/assets/instances?limit=500');
    } catch (err: any) {
      toast.error('Action Failed', err.message ?? 'Something went wrong');
    } finally {
      setPanelSubmitting(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-600 to-blue-700 shadow-lg shadow-cyan-600/20">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Filters</h1>
          <p className="text-sm text-slate-500">{enrichedFilters.length} filter(s) across {blocks.length} block(s)</p>
        </div>
      </div>

      {/* Block Cards */}
      {!selectedBlock && (
        <>
          {isLoading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
              <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <p className="text-slate-400">Loading blocks...</p>
            </div>
          ) : blocks.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center">
              <p className="text-slate-500">No blocks found. Create Block entities first.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {blocks.map((block: any) => {
                const count = blockCounts[block.id] ?? 0;
                return (
                  <button
                    key={block.id}
                    onClick={() => setSelectedBlock(block.id)}
                    className="bg-white border border-slate-200 rounded-2xl p-5 text-left hover:border-cyan-600 hover:bg-slate-50 transition-all group shadow-sm"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200 flex items-center justify-center group-hover:from-cyan-100 group-hover:to-blue-100 transition-colors">
                        <svg className="w-5 h-5 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold text-slate-700 truncate">{block.name}</h3>
                      </div>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-2xl font-bold text-cyan-600">{count}</span>
                      <span className="text-xs text-slate-400">filter(s)</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* Selected Block → Filter Table */}
      {selectedBlock && (
        <>
          {/* Back button + block name */}
          <div className="flex items-center gap-3">
            <button onClick={() => setSelectedBlock(null)}
              className="p-2 rounded-xl bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 transition-colors">
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h2 className="text-lg font-bold text-slate-800">{selectedBlockName}</h2>
              <p className="text-xs text-slate-400">{blockFilters.length} filter(s)</p>
            </div>
          </div>

          {/* Filter Table */}
          {blockFilters.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center">
              <svg className="w-10 h-10 text-slate-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              <p className="text-slate-500 font-medium">No filters in this block</p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-50/50 border-b border-slate-200">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Block</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">AHU</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Filter ID</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Set</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Cleaning</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {blockFilters.map(f => {
                      const stateInfo = STATUS_LABELS[f.currentState ?? ''] ?? { label: f.currentState?.replace(/_/g, ' ') ?? 'Idle', color: 'bg-slate-100 text-slate-500 border-slate-300' };
                      return (
                        <tr key={f.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3 text-sm text-slate-600">{f.blockName}</td>
                          <td className="px-4 py-3">
                            {f.ahuId ? (
                              <Link to={`/ahus/${f.ahuId}`} className="text-sm text-cyan-600 hover:text-cyan-700 hover:underline">{f.ahuName}</Link>
                            ) : (
                              <span className="text-sm text-slate-400">-</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className={`w-2 h-2 rounded-full ${FILTER_STATE_COLORS[f.currentState ?? ''] ?? 'bg-gray-500'}`} />
                              <span className="text-sm font-medium text-slate-700">{f.name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-500">{f.filterType}</td>
                          <td className="px-4 py-3">
                            {f.filterSet ? (
                              <span className={`text-xs px-2 py-0.5 rounded border ${f.filterSet === 'SET_A' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-purple-50 text-purple-700 border-purple-200'}`}>
                                {f.filterSet === 'SET_A' ? 'Set A' : 'Set B'}
                              </span>
                            ) : <span className="text-xs text-slate-300">-</span>}
                          </td>
                          <td className="px-4 py-3 text-sm text-slate-500">{f.lastCleaningDate ? formatDate(f.lastCleaningDate) : '-'}</td>
                          <td className="px-4 py-3">
                            <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${stateInfo.color}`}>{stateInfo.label}</span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              <Link to={`/filters/${f.id}/trace`}
                                className="p-1.5 rounded-lg text-slate-400 hover:text-cyan-600 hover:bg-slate-100 transition-colors" title="View History">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                              </Link>
                              {f.currentState !== 'RETIRED' && (
                                <>
                                  <button
                                    onClick={() => openStatusPanel({ id: f.id, name: f.name, currentState: f.currentState })}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                    title="Update Status"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => openPanel({ id: f.id, name: f.name })}
                                    className="p-1.5 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition-colors"
                                    title="Retire / Replace"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0" />
                                    </svg>
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-slate-200 bg-slate-50">
                <p className="text-xs text-slate-400">Showing {blockFilters.length} filter(s) in {selectedBlockName}</p>
              </div>
            </div>
          )}
        </>
      )}
      {/* Update Status Side Panel */}
      {statusPanelFilter && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeStatusPanel} />
          <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">Update Filter Status</h3>
              <button onClick={closeStatusPanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Filter ID</label>
                <input type="text" value={statusPanelFilter.name} readOnly className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Current Status</label>
                <input
                  type="text"
                  value={statusPanelFilter.currentState ? (STATUS_LABELS[statusPanelFilter.currentState]?.label ?? statusPanelFilter.currentState.replace(/_/g, ' ')) : 'Idle'}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  New Status <span className="text-red-500">*</span>
                </label>
                <select
                  value={statusPanelState}
                  onChange={e => setStatusPanelState(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {LIFECYCLE_STATE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
              {statusPanelState === (statusPanelFilter.currentState ?? '') && (
                <div className="rounded-lg p-3 text-xs bg-amber-50 text-amber-700 border border-amber-200">
                  Please select a different status from the current one.
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Remarks <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={statusPanelRemarks}
                  onChange={e => setStatusPanelRemarks(e.target.value)}
                  placeholder="Enter reason for status change..."
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button
                onClick={closeStatusPanel}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleStatusSubmit}
                disabled={!statusPanelRemarks.trim() || statusPanelState === (statusPanelFilter.currentState ?? '') || statusPanelSubmitting}
                className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {statusPanelSubmitting ? 'Processing...' : 'Update Status'}
              </button>
            </div>
          </div>
        </>
      )}

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Update Status"
      />

      {/* Retire / Replace Side Panel */}
      {panelFilter && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closePanel} />
          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-96 bg-white shadow-2xl z-50 flex flex-col border-l border-slate-200 animate-in slide-in-from-right">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-50">
              <h3 className="text-lg font-semibold text-slate-800">Retire / Replace Filter</h3>
              <button onClick={closePanel} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* Filter ID (read-only) */}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Filter ID</label>
                <input
                  type="text"
                  value={panelFilter.name}
                  readOnly
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg bg-slate-50 text-slate-700 text-sm"
                />
              </div>
              {/* Action dropdown */}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Action</label>
                <select
                  value={panelAction}
                  onChange={e => setPanelAction(e.target.value as 'retire' | 'replace')}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                >
                  <option value="retire">Retirement</option>
                  <option value="replace">Replacement</option>
                </select>
              </div>
              {/* Info box */}
              <div className={`rounded-lg p-3 text-xs ${panelAction === 'retire' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                {panelAction === 'retire'
                  ? 'This will permanently retire the filter. It will be removed from the active filter list and cannot perform cleaning operations.'
                  : 'This will retire the current filter and create a new replacement filter with the same details and an incremented suffix number.'}
              </div>
              {/* Remarks */}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Remarks <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={panelRemarks}
                  onChange={e => setPanelRemarks(e.target.value)}
                  placeholder="Enter reason for retirement/replacement..."
                  rows={4}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 resize-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                />
              </div>
            </div>
            {/* Footer */}
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button
                onClick={closePanel}
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePanelSubmit}
                disabled={!panelRemarks.trim() || panelSubmitting}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  panelAction === 'retire'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-cyan-600 hover:bg-cyan-700'
                }`}
              >
                {panelSubmitting ? 'Processing...' : panelAction === 'retire' ? 'Retire Filter' : 'Replace Filter'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
