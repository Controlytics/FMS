import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';


interface LifecycleState {
  key: string; name: string; category: string; icon: string; color: string; sortOrder: number;
}

export function LifecycleStateConfigPage() {
  const { data: config } = useSWR('/api/config/dynamic/filter_lifecycle_states');
  const [states, setStates] = useState<LifecycleState[]>([]);
  const [editing, setEditing] = useState<LifecycleState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    if (config?.value) setStates(Array.isArray(config.value) ? config.value : []);
  }, [config]);

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put('/api/config/dynamic/filter_lifecycle_states', { value: states });
      mutate('/api/config/dynamic/filter_lifecycle_states');
      setError(null);
    } catch (e: any) { setError(e.message || 'Failed to save lifecycle states'); console.error(e); }
    setSaving(false);
  };

  const moveState = (idx: number, dir: -1 | 1) => {
    const newStates = [...states];
    const target = idx + dir;
    if (target < 0 || target >= newStates.length) return;
    [newStates[idx], newStates[target]] = [newStates[target], newStates[idx]];
    newStates.forEach((s, i) => s.sortOrder = i + 1);
    setStates(newStates);
  };

  const handleSaveEditing = () => {
    if (!editing) return;
    if (!editing.key.trim()) {
      setEditError('Key is required');
      return;
    }
    if (!editing.name.trim()) {
      setEditError('Name is required');
      return;
    }
    // Check for duplicate keys (only for new states or if key was changed)
    const existingIdx = states.findIndex(s => s.key === editing.key);
    const isNewState = !states.some(s => s.key === editing.key);
    // If adding a new state and a state with the same key already exists, block it
    if (isNewState) {
      // This is truly new — no conflict possible since findIndex returned -1
    } else {
      // Editing existing — existingIdx is valid
    }
    // For new entries, check if key already exists
    const originalKey = states[existingIdx]?.key;
    if (existingIdx < 0) {
      // New state — check for duplicate key among all existing states
      const duplicate = states.find(s => s.key === editing.key);
      if (duplicate) {
        setEditError(`A state with key "${editing.key}" already exists`);
        return;
      }
    }

    setEditError(null);
    if (existingIdx >= 0) {
      const ns = [...states];
      ns[existingIdx] = editing;
      setStates(ns);
    } else {
      setStates([...states, editing]);
    }
    setEditing(null);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/config" className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors">
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 shadow-lg shadow-cyan-500/25">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Filter Lifecycle States</h1>
            <p className="text-sm text-slate-500 mt-0.5">Configure lifecycle states for filter management</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => {
              setEditing({ key: '', name: '', category: 'REPETITIVE', icon: 'circle', color: '#6B7280', sortOrder: states.length + 1 });
              setEditError(null);
            }}
            className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all font-medium text-sm shadow-sm"
          >
            Add State
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl hover:from-cyan-600 hover:to-blue-700 disabled:opacity-50 transition-all font-medium text-sm shadow-lg shadow-cyan-500/25"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4 text-lg leading-none">&times;</button>
        </div>
      )}

      {/* States List */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <h2 className="text-sm font-semibold text-slate-700">Lifecycle States ({states.length})</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {states.length === 0 && (
            <div className="px-6 py-12 text-center text-slate-400 text-sm">
              No lifecycle states configured. Click "Add State" to create one.
            </div>
          )}
          {states.map((s, i) => (
            <div key={s.key} className="px-6 py-4 flex items-center gap-4 hover:bg-slate-50/50 transition-colors">
              <div className="flex flex-col gap-1">
                <button onClick={() => moveState(i, -1)} className="text-slate-300 hover:text-slate-600 text-xs transition-colors">&#9650;</button>
                <button onClick={() => moveState(i, 1)} className="text-slate-300 hover:text-slate-600 text-xs transition-colors">&#9660;</button>
              </div>
              <div className="w-4 h-4 rounded-full ring-2 ring-white shadow-sm" style={{ backgroundColor: s.color }} />
              <div className="flex-1 min-w-0">
                <span className="text-slate-800 font-medium">{s.name}</span>
                <span className="ml-2 text-xs text-slate-400 font-mono">{s.key}</span>
              </div>
              <span className={`px-2.5 py-0.5 text-xs rounded-full font-medium ${
                s.category === 'ONE_TIME'
                  ? 'bg-blue-50 text-blue-600 border border-blue-200'
                  : 'bg-emerald-50 text-emerald-600 border border-emerald-200'
              }`}>
                {s.category}
              </span>
              <button
                onClick={() => { setEditing({ ...s }); setEditError(null); }}
                className="text-slate-400 hover:text-cyan-600 text-sm font-medium transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => setStates(states.filter(x => x.key !== s.key))}
                className="text-slate-400 hover:text-red-500 text-sm font-medium transition-colors"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Edit / Add Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div className="bg-white border border-slate-200 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-800">
              {states.some(s => s.key === editing.key) ? 'Edit State' : 'Add State'}
            </h2>

            {editError && (
              <div className="bg-red-50 border border-red-200 text-red-600 px-3 py-2 rounded-lg text-sm flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{editError}</span>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium text-slate-600 mb-1 block">Name</label>
                <input
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 transition-colors"
                  value={editing.name}
                  onChange={e => {
                    setEditing({ ...editing, name: e.target.value, key: editing.key || e.target.value.toUpperCase().replace(/\s+/g, '_') });
                    setEditError(null);
                  }}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600 mb-1 block">Key</label>
                <input
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 transition-colors"
                  value={editing.key}
                  onChange={e => { setEditing({ ...editing, key: e.target.value }); setEditError(null); }}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600 mb-1 block">Category</label>
                <select
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/40 focus:border-cyan-500 transition-colors"
                  value={editing.category}
                  onChange={e => setEditing({ ...editing, category: e.target.value })}
                >
                  <option value="ONE_TIME">One-Time</option>
                  <option value="REPETITIVE">Repetitive</option>
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-slate-600 mb-1 block">Color</label>
                <input
                  type="color"
                  className="w-full h-10 bg-white border border-slate-200 rounded-lg cursor-pointer"
                  value={editing.color}
                  onChange={e => setEditing({ ...editing, color: e.target.value })}
                />
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-xl hover:bg-slate-50 transition-colors font-medium text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEditing}
                className="flex-1 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl hover:from-cyan-600 hover:to-blue-700 transition-all font-medium text-sm shadow-lg shadow-cyan-500/25"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
