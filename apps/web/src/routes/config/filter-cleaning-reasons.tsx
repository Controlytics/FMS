import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';


interface CleaningReason {
  key: string; name: string; description: string; requiresJustification: boolean; isActive: boolean; sortOrder: number;
}

export function CleaningReasonsConfigPage() {
  const { data: config } = useSWR('/api/config/dynamic/filter-cleaning-reasons');
  const [reasons, setReasons] = useState<CleaningReason[]>([]);
  const [editing, setEditing] = useState<CleaningReason | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (config?.value) setReasons(Array.isArray(config.value) ? config.value : []);
  }, [config]);

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put('/api/config/dynamic/filter-cleaning-reasons', { value: reasons });
      mutate('/api/config/dynamic/filter-cleaning-reasons');
    } catch (e: any) { alert(e.message); }
    setSaving(false);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">Cleaning Reasons</h1>
        <div className="flex gap-2">
          <button onClick={() => setEditing({ key: '', name: '', description: '', requiresJustification: false, isActive: true, sortOrder: reasons.length + 1 })}
            className="px-4 py-2 bg-gray-700 text-gray-200 rounded-lg hover:bg-gray-600">Add Reason</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-500 disabled:opacity-50">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {reasons.map((r) => (
          <div key={r.key} className="bg-gray-800 border border-gray-700 rounded-lg p-4 flex items-center gap-4">
            <div className="flex-1">
              <span className="text-gray-100 font-medium">{r.name}</span>
              <span className="ml-2 text-xs text-gray-500 font-mono">{r.key}</span>
              <p className="text-sm text-gray-400 mt-0.5">{r.description}</p>
            </div>
            {r.requiresJustification && <span className="px-2 py-0.5 text-xs bg-amber-900 text-amber-300 rounded-full">Requires Justification</span>}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={r.isActive} disabled={r.key === 'PM'}
                onChange={e => setReasons(reasons.map(x => x.key === r.key ? { ...x, isActive: e.target.checked } : x))}
                className="w-4 h-4 rounded" />
              <span className="text-sm text-gray-400">Active</span>
            </label>
            <button onClick={() => setEditing({ ...r })} className="text-gray-400 hover:text-cyan-400 text-sm">Edit</button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditing(null)}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 w-full max-w-md space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-gray-100">{editing.key ? 'Edit Reason' : 'Add Reason'}</h2>
            <div className="space-y-3">
              <input className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-100" placeholder="Name" value={editing.name}
                onChange={e => setEditing({ ...editing, name: e.target.value, key: editing.key || e.target.value.toUpperCase().replace(/\s+/g, '_') })} />
              <input className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-100 font-mono" placeholder="Key" value={editing.key}
                onChange={e => setEditing({ ...editing, key: e.target.value })} />
              <textarea className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-2 text-gray-100" placeholder="Description" rows={2}
                value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} />
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.requiresJustification}
                  onChange={e => setEditing({ ...editing, requiresJustification: e.target.checked })} className="w-4 h-4 rounded" />
                <span className="text-sm text-gray-300">Requires Justification</span>
              </label>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setEditing(null)} className="flex-1 py-2 bg-gray-700 text-gray-300 rounded-lg">Cancel</button>
              <button onClick={() => {
                const idx = reasons.findIndex(x => x.key === editing.key);
                if (idx >= 0) { const ns = [...reasons]; ns[idx] = editing; setReasons(ns); }
                else setReasons([...reasons, editing]);
                setEditing(null);
              }} className="flex-1 py-2 bg-cyan-600 text-white rounded-lg">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
