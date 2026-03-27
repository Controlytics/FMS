import { useState, useEffect } from 'react';
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

  useEffect(() => {
    if (config?.value) setStates(Array.isArray(config.value) ? config.value : []);
  }, [config]);

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put('/api/config/dynamic/filter_lifecycle_states', { value: states });
      mutate('/api/config/dynamic/filter_lifecycle_states');
    } catch (e: any) { console.error(e.message); }
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

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Filter Lifecycle States</h1>
        <div className="flex gap-2">
          <button onClick={() => setEditing({ key: '', name: '', category: 'REPETITIVE', icon: 'circle', color: '#6B7280', sortOrder: states.length + 1 })}
            className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600">Add State</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {states.map((s, i) => (
          <div key={s.key} className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center gap-4">
            <div className="flex flex-col gap-1">
              <button onClick={() => moveState(i, -1)} className="text-gray-500 hover:text-gray-300 text-xs">▲</button>
              <button onClick={() => moveState(i, 1)} className="text-gray-500 hover:text-gray-300 text-xs">▼</button>
            </div>
            <div className="w-4 h-4 rounded-full" style={{ backgroundColor: s.color }} />
            <div className="flex-1">
              <span className="text-gray-100 font-medium">{s.name}</span>
              <span className="ml-2 text-xs text-gray-500 font-mono">{s.key}</span>
            </div>
            <span className={`px-2 py-0.5 text-xs rounded-full ${s.category === 'ONE_TIME' ? 'bg-blue-900 text-blue-300' : 'bg-green-900 text-green-300'}`}>
              {s.category}
            </span>
            <button onClick={() => setEditing({ ...s })} className="text-gray-400 hover:text-cyan-400 text-sm">Edit</button>
            <button onClick={() => setStates(states.filter(x => x.key !== s.key))} className="text-gray-400 hover:text-red-400 text-sm">Remove</button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-100">{editing.key ? 'Edit State' : 'Add State'}</h2>
            <div className="space-y-3">
              <div>
                <label className="text-sm text-gray-400">Name</label>
                <input className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-100" value={editing.name}
                  onChange={e => setEditing({ ...editing, name: e.target.value, key: editing.key || e.target.value.toUpperCase().replace(/\s+/g, '_') })} />
              </div>
              <div>
                <label className="text-sm text-gray-400">Key</label>
                <input className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-100 font-mono" value={editing.key}
                  onChange={e => setEditing({ ...editing, key: e.target.value })} />
              </div>
              <div>
                <label className="text-sm text-gray-400">Category</label>
                <select className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-100" value={editing.category}
                  onChange={e => setEditing({ ...editing, category: e.target.value })}>
                  <option value="ONE_TIME">One-Time</option>
                  <option value="REPETITIVE">Repetitive</option>
                </select>
              </div>
              <div>
                <label className="text-sm text-gray-400">Color</label>
                <input type="color" className="w-full h-10 bg-gray-900 border border-gray-600 rounded" value={editing.color}
                  onChange={e => setEditing({ ...editing, color: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditing(null)} className="flex-1 py-2 bg-gray-700 text-gray-300 rounded-lg">Cancel</button>
              <button onClick={() => {
                const existing = states.findIndex(s => s.key === editing.key);
                if (existing >= 0) { const ns = [...states]; ns[existing] = editing; setStates(ns); }
                else setStates([...states, editing]);
                setEditing(null);
              }} className="flex-1 py-2 bg-cyan-600 text-white rounded-lg">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
