import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';

export function ChecklistProfileListPage() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creating, setCreating] = useState(false);
  const swrKey = '/api/checklist-profiles?limit=50';
  const { data, isLoading } = useSWR(swrKey);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const result = await apiClient.post('/api/checklist-profiles', { name: newName, description: newDesc || undefined });
      mutate(swrKey);
      setShowCreate(false); setNewName(''); setNewDesc('');
      navigate(`/checklists/${(result as any).id}`);
    } catch (e: any) { console.error(e.message); }
    setCreating(false);
  };

  const toggleActive = async (id: string, isActive: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiClient.put(`/api/checklist-profiles/${id}`, { isActive: !isActive });
      mutate(swrKey);
    } catch (e: any) { alert((e as any).message); }
  };

  const deleteProfile = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${name}"?`)) return;
    try { await apiClient.delete(`/api/checklist-profiles/${id}`); mutate(swrKey); }
    catch (e: any) { alert((e as any).message); }
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-100">Checklists</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage checklist profiles with questions</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 transition-colors text-sm font-medium">
          + Create Checklist
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(data?.data ?? []).map((p: any) => (
            <div key={p.id} className="bg-gray-800 border border-gray-700 rounded-xl p-5 hover:border-cyan-600 transition-colors cursor-pointer group"
              onClick={() => navigate(`/checklists/${p.id}`)}>
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-base font-semibold text-gray-100 leading-tight">{p.name}</h3>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button onClick={(e) => deleteProfile(p.id, p.name, e)}
                    className="w-6 h-6 rounded text-gray-600 hover:text-red-400 hover:bg-red-900/30 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity">&times;</button>
                </div>
              </div>
              {p.description && <p className="text-xs text-gray-500 mb-3 line-clamp-2">{p.description}</p>}
              <div className="flex items-center justify-between pt-3 border-t border-gray-700">
                <span className="text-sm text-gray-400">{p.questionCount} question{p.questionCount !== 1 ? 's' : ''}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${p.isActive ? 'text-green-400' : 'text-gray-500'}`}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </span>
                  <button onClick={(e) => toggleActive(p.id, p.isActive, e)}
                    className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${p.isActive ? 'bg-green-600' : 'bg-gray-600'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${p.isActive ? 'translate-x-4' : 'translate-x-0'}`} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {(data?.data ?? []).length === 0 && (
            <div className="col-span-full text-center py-16 text-gray-500">
              <div className="text-4xl mb-3">&#9776;</div>
              No checklists yet. Create one to get started.
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowCreate(false)}>
          <div className="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-100 mb-4">Create Checklist</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Name</label>
                <input className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-sm" value={newName}
                  onChange={e => setNewName(e.target.value)} placeholder="e.g. HEPA Pre-Wash Checklist" autoFocus
                  onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }} />
              </div>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">Description (optional)</label>
                <textarea className="w-full bg-gray-900 border border-gray-600 rounded-lg px-3 py-2 text-gray-100 text-sm" rows={2} value={newDesc}
                  onChange={e => setNewDesc(e.target.value)} placeholder="Brief description..." />
              </div>
            </div>
            <div className="flex gap-2 mt-5">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm">Cancel</button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()} className="flex-1 py-2 bg-cyan-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
