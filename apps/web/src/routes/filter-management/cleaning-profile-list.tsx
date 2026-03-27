import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';


export function CleaningProfileListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const swrKey = `/api/filter-cleaning-profiles?page=${page}&limit=20${status ? `&status=${status}` : ''}`;
  const { data, isLoading } = useSWR(swrKey);

  // Assign modal state
  const [assignProfileId, setAssignProfileId] = useState<string | null>(null);
  const [assignProfileName, setAssignProfileName] = useState('');
  const [selectedAssets, setSelectedAssets] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  // Fetch all assets and currently assigned assets when modal opens
  const { data: allAssetsData } = useSWR(assignProfileId ? '/api/assets/instances?limit=500' : null);
  const { data: assignedAssetsData } = useSWR(assignProfileId ? `/api/filter-cleaning-profiles/${assignProfileId}/assigned-assets` : null);

  // Populate selected assets when assigned data loads
  useEffect(() => {
    if (assignedAssetsData && Array.isArray(assignedAssetsData)) {
      setSelectedAssets(new Set(assignedAssetsData.map((a: any) => a.id)));
    }
  }, [assignedAssetsData]);

  const toggleStatus = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiClient.patch(`/api/filter-cleaning-profiles/${id}/toggle-status`, {});
      mutate(swrKey);
    } catch (err: any) {
      alert(err.message || 'Failed to toggle status');
    }
  };

  const openAssignModal = (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setAssignProfileId(id);
    setAssignProfileName(name);
    setSelectedAssets(new Set());
  };

  const closeAssignModal = () => {
    setAssignProfileId(null);
    setAssignProfileName('');
    setSelectedAssets(new Set());
  };

  const toggleAsset = (assetId: string) => {
    setSelectedAssets(prev => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  };

  const saveAssignment = async () => {
    if (!assignProfileId) return;
    setAssigning(true);
    try {
      await apiClient.post(`/api/filter-cleaning-profiles/${assignProfileId}/assign-assets`, {
        assetIds: Array.from(selectedAssets),
      });
      mutate(swrKey);
      closeAssignModal();
    } catch (err: any) {
      alert(err.message || 'Failed to assign assets');
    }
    setAssigning(false);
  };

  const allAssets = allAssetsData?.data ?? [];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Cleaning Profiles</h1>
        <button onClick={() => navigate('/filter-cleaning-profiles/new/edit')} className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors">
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
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${status === s.key ? 'bg-cyan-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
            {s.label}
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
              </div>
              <div className="flex items-center gap-4 text-sm text-gray-400 mb-3">
                <span>v{p.version}</span>
                <span>{p.stageCount} stages</span>
                <span>{p.connectionCount} connections</span>
              </div>
              <div className="flex items-center justify-between pt-3 border-t border-gray-700">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium ${p.status === 'ACTIVE' ? 'text-green-400' : 'text-gray-500'}`}>
                    {p.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </span>
                  <button
                    onClick={(e) => toggleStatus(p.id, e)}
                    className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${p.status === 'ACTIVE' ? 'bg-green-600' : 'bg-gray-600'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${p.status === 'ACTIVE' ? 'translate-x-5' : 'translate-x-0'}`} />
                  </button>
                </div>
                <button
                  onClick={(e) => openAssignModal(p.id, p.name, e)}
                  className="px-3 py-1.5 text-xs font-medium bg-cyan-900 text-cyan-300 rounded-lg hover:bg-cyan-800 transition-colors">
                  Assign Assets
                </button>
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

      {/* Assign Assets Modal */}
      {assignProfileId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={closeAssignModal}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="p-5 border-b border-gray-700">
              <h2 className="text-lg font-bold text-gray-100">Assign Assets</h2>
              <p className="text-sm text-gray-400 mt-1">Select assets to follow <span className="text-cyan-400 font-medium">{assignProfileName}</span> pipeline</p>
            </div>

            {/* Asset List */}
            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {allAssets.length === 0 ? (
                <div className="text-center py-8 text-gray-500">No assets found</div>
              ) : (
                <>
                  {/* Select All */}
                  <label className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-700/50 cursor-pointer border-b border-gray-700 mb-2">
                    <input type="checkbox"
                      checked={allAssets.length > 0 && allAssets.every((a: any) => selectedAssets.has(a.id))}
                      onChange={() => {
                        const allIds = allAssets.map((a: any) => a.id);
                        const allSelected = allIds.every((id: string) => selectedAssets.has(id));
                        if (allSelected) setSelectedAssets(new Set());
                        else setSelectedAssets(new Set(allIds));
                      }}
                      className="w-4 h-4 rounded border-gray-500 text-cyan-600 focus:ring-cyan-500 bg-gray-700" />
                    <span className="text-sm font-medium text-gray-300">Select All ({allAssets.length})</span>
                    <span className="ml-auto text-xs text-gray-500">{selectedAssets.size} selected</span>
                  </label>

                  {allAssets.map((asset: any) => (
                    <label key={asset.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-700/50 cursor-pointer transition-colors">
                      <input type="checkbox"
                        checked={selectedAssets.has(asset.id)}
                        onChange={() => toggleAsset(asset.id)}
                        className="w-4 h-4 rounded border-gray-500 text-cyan-600 focus:ring-cyan-500 bg-gray-700" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-200">{asset.name}</div>
                        <div className="text-xs text-gray-500 flex items-center gap-2">
                          {asset.filterSet && <span>Set {asset.filterSet.replace('SET_', '')}</span>}
                          {asset.currentLifecycleState && <span>{asset.currentLifecycleState.replace(/_/g, ' ')}</span>}
                          {asset.templateName && <span>{asset.templateName}</span>}
                        </div>
                      </div>
                      {selectedAssets.has(asset.id) && (
                        <span className="text-cyan-400 text-xs shrink-0">Assigned</span>
                      )}
                    </label>
                  ))}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-700 flex items-center justify-between">
              <span className="text-sm text-gray-400">{selectedAssets.size} asset{selectedAssets.size !== 1 ? 's' : ''} selected</span>
              <div className="flex gap-2">
                <button onClick={closeAssignModal} className="px-4 py-2 text-sm text-gray-300 bg-gray-700 rounded-lg hover:bg-gray-600">
                  Cancel
                </button>
                <button onClick={saveAssignment} disabled={assigning}
                  className="px-4 py-2 text-sm text-white bg-cyan-600 rounded-lg hover:bg-cyan-500 disabled:opacity-50">
                  {assigning ? 'Saving...' : 'Save Assignment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
