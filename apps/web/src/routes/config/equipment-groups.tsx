import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';

interface Instrument {
  id?: string;
  description: string;
  stageKey: string;
  serialNumber: string;
  instrumentId: string;
  uom: string;
  instrumentMin: number;
  instrumentMax: number;
  operatingMin: number;
  operatingMax: number;
  leastCount: number;
}

interface EquipmentGroup {
  id: string;
  name: string;
  blockId: string;
  isActive: boolean;
  instruments: Instrument[];
  block?: { id: string; name: string };
}

const DEFAULT_INSTRUMENTS: Instrument[] = [
  { description: 'Compressed Air Pressure', stageKey: 'WASH_IN', serialNumber: '', instrumentId: '', uom: 'bar', instrumentMin: 0, instrumentMax: 10, operatingMin: 0, operatingMax: 10, leastCount: 0.1 },
  { description: 'RO Water Pressure', stageKey: 'WASH_IN', serialNumber: '', instrumentId: '', uom: 'bar', instrumentMin: 0, instrumentMax: 10, operatingMin: 0, operatingMax: 10, leastCount: 0.1 },
  { description: 'Dryer Temperature', stageKey: 'DRY_IN', serialNumber: '', instrumentId: '', uom: '\u00b0C', instrumentMin: 0, instrumentMax: 100, operatingMin: 0, operatingMax: 100, leastCount: 0.5 },
];

function generateValues(opMin: number, opMax: number, leastCount: number): number[] {
  const values: number[] = [];
  if (leastCount <= 0 || opMin >= opMax) return values;
  const maxSteps = 10000;
  for (let v = opMin, i = 0; v <= opMax + 1e-9 && i < maxSteps; v = Math.round((v + leastCount) * 1e10) / 1e10, i++) {
    values.push(v);
  }
  return values;
}

function stageBadgeClass(stageKey: string): string {
  if (stageKey === 'WASH_IN') return 'bg-sky-50 text-sky-700 border border-sky-200';
  if (stageKey === 'DRY_IN') return 'bg-amber-50 text-amber-700 border border-amber-200';
  return 'bg-slate-50 text-slate-600 border border-slate-200';
}

export function EquipmentGroupsConfigPage() {
  const navigate = useNavigate();
  const { data: instancesData } = useSWR('/api/assets/instances?limit=200');
  const { data: templatesData } = useSWR('/api/assets/templates?limit=100');
  const [selectedBlockId, setSelectedBlockId] = useState<string>('');
  const { data: groupsData } = useSWR(selectedBlockId ? `/api/equipment-groups?blockId=${selectedBlockId}` : null);

  const [editing, setEditing] = useState<{ group: Partial<EquipmentGroup>; isNew: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [previewInst, setPreviewInst] = useState<number | null>(null);

  const blockTemplateId = (templatesData?.data ?? []).find((t: any) => t.name === 'Block')?.id;
  const blocks = (instancesData?.data ?? []).filter((e: any) => e.templateId === blockTemplateId);

  useEffect(() => {
    if (blocks.length > 0 && !selectedBlockId) setSelectedBlockId(blocks[0].id);
  }, [blocks.length]);

  const groups: EquipmentGroup[] = Array.isArray(groupsData) ? groupsData : [];

  const handleCreate = () => {
    setEditing({
      group: {
        name: '',
        blockId: selectedBlockId,
        instruments: DEFAULT_INSTRUMENTS.map(d => ({ ...d })),
      },
      isNew: true,
    });
    setError('');
  };

  const handleEdit = (g: EquipmentGroup) => {
    setEditing({
      group: {
        ...g,
        instruments: g.instruments.map(i => ({ ...i })),
      },
      isNew: false,
    });
    setError('');
  };

  const handleDelete = async (g: EquipmentGroup) => {
    if (!confirm(`Delete equipment group "${g.name}"?`)) return;
    setDeleteError('');
    try {
      await apiClient.delete(`/api/equipment-groups/${g.id}`);
      mutate(`/api/equipment-groups?blockId=${selectedBlockId}`);
    } catch (e: any) {
      setDeleteError(e.message || 'Failed to delete');
    }
  };

  const updateInstrument = (idx: number, field: string, value: any) => {
    if (!editing) return;
    const instruments = [...(editing.group.instruments ?? [])];
    instruments[idx] = { ...instruments[idx], [field]: value };
    setEditing({ ...editing, group: { ...editing.group, instruments } });
  };

  const handleSave = async () => {
    if (!editing) return;
    const { group, isNew } = editing;
    if (!group.name?.trim()) { setError('Group name is required'); return; }
    for (let i = 0; i < 3; i++) {
      const inst = group.instruments![i];
      if (!inst.instrumentId?.trim()) { setError(`Instrument ID is required for ${inst.description}`); return; }
      if (!inst.uom?.trim()) { setError(`UOM is required for ${inst.description}`); return; }
      if (inst.leastCount <= 0) { setError(`Least Count must be > 0 for ${inst.description}`); return; }
      if (inst.instrumentMin >= inst.instrumentMax) { setError(`Min Range must be less than Max Range for ${inst.description}`); return; }
      if (inst.operatingMin < inst.instrumentMin || inst.operatingMin > inst.instrumentMax) { setError(`Operating Min must be within instrument range for ${inst.description}`); return; }
      if (inst.operatingMax < inst.instrumentMin || inst.operatingMax > inst.instrumentMax) { setError(`Operating Max must be within instrument range for ${inst.description}`); return; }
      if (inst.operatingMin >= inst.operatingMax) { setError(`Operating Min must be less than Operating Max for ${inst.description}`); return; }
    }
    setSaving(true); setError('');
    try {
      const payload = {
        name: group.name!.trim(),
        blockId: group.blockId,
        instruments: group.instruments!.map(i => ({
          serialNumber: i.serialNumber,
          instrumentId: i.instrumentId,
          uom: i.uom,
          instrumentMin: Number(i.instrumentMin),
          instrumentMax: Number(i.instrumentMax),
          operatingMin: Number(i.operatingMin),
          operatingMax: Number(i.operatingMax),
          leastCount: Number(i.leastCount),
        })),
      };
      if (isNew) {
        await apiClient.post('/api/equipment-groups', payload);
      } else {
        await apiClient.put(`/api/equipment-groups/${group.id}`, payload);
      }
      mutate(`/api/equipment-groups?blockId=${selectedBlockId}`);
      setEditing(null);
    } catch (e: any) { setError(e.message || 'Failed to save'); }
    setSaving(false);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/config')}
            className="p-2 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Equipment Groups</h1>
              <p className="text-sm text-slate-500">Configure instrument groups per block</p>
            </div>
          </div>
        </div>
        <button onClick={handleCreate} disabled={!selectedBlockId}
          className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-40 transition-colors shadow-sm">
          Add Equipment Group
        </button>
      </div>

      {/* Block selector */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-slate-500">Block:</label>
        <select value={selectedBlockId} onChange={e => setSelectedBlockId(e.target.value)}
          className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 text-sm min-w-[200px] focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400">
          <option value="">Select Block</option>
          {blocks.map((b: any) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      {/* Delete error inline */}
      {deleteError && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm flex items-center justify-between">
          <span>{deleteError}</span>
          <button onClick={() => setDeleteError('')} className="text-red-400 hover:text-red-600 ml-4 font-bold">&times;</button>
        </div>
      )}

      {!selectedBlockId && (
        <div className="text-center py-12 text-slate-400">Select a block to view its equipment groups</div>
      )}

      {selectedBlockId && groups.length === 0 && (
        <div className="text-center py-12 text-slate-400">No equipment groups for this block. Click "Add Equipment Group" to create one.</div>
      )}

      {/* Group cards */}
      <div className="space-y-4">
        {groups.map(g => (
          <div key={g.id} className="bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/60">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">{g.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">3 instruments</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => handleEdit(g)}
                  className="px-3 py-1.5 text-sm bg-slate-50 text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">
                  Edit
                </button>
                <button onClick={() => handleDelete(g)}
                  className="px-3 py-1.5 text-sm bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 transition-colors">
                  Delete
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs uppercase tracking-wider bg-slate-50">
                    <th className="px-4 py-2 text-left">S.No</th>
                    <th className="px-4 py-2 text-left">Description</th>
                    <th className="px-4 py-2 text-left">Stage</th>
                    <th className="px-4 py-2 text-left">Instrument ID</th>
                    <th className="px-4 py-2 text-left">Range</th>
                    <th className="px-4 py-2 text-left">Operating Range</th>
                    <th className="px-4 py-2 text-left">UOM</th>
                    <th className="px-4 py-2 text-left">Least Count</th>
                  </tr>
                </thead>
                <tbody>
                  {g.instruments.map((inst, idx) => (
                    <tr key={inst.id ?? idx} className="border-t border-slate-100 text-slate-600">
                      <td className="px-4 py-2">{inst.serialNumber || (idx + 1)}</td>
                      <td className="px-4 py-2 font-medium text-slate-800">{inst.description}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full ${stageBadgeClass(inst.stageKey)}`}>
                          {inst.stageKey.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{inst.instrumentId}</td>
                      <td className="px-4 py-2">{inst.instrumentMin} – {inst.instrumentMax}</td>
                      <td className="px-4 py-2">{inst.operatingMin} – {inst.operatingMax}</td>
                      <td className="px-4 py-2">{inst.uom}</td>
                      <td className="px-4 py-2">{inst.leastCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {/* Create / Edit Dialog */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setEditing(null)}>
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-4 shrink-0">
              <h2 className="text-lg font-bold text-white">{editing.isNew ? 'Add Equipment Group' : 'Edit Equipment Group'}</h2>
              {!editing.isNew && <p className="text-cyan-100/80 text-sm">{editing.group.name}</p>}
            </div>
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              <div>
                <label className="text-sm font-medium text-slate-600 mb-1 block">Group Name</label>
                <input className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400" placeholder="e.g. Equipment Group 1"
                  value={editing.group.name ?? ''} onChange={e => setEditing({ ...editing, group: { ...editing.group, name: e.target.value } })} />
              </div>

              {editing.isNew && (
                <div>
                  <label className="text-sm font-medium text-slate-600 mb-1 block">Block</label>
                  <select value={editing.group.blockId ?? ''} onChange={e => setEditing({ ...editing, group: { ...editing.group, blockId: e.target.value } })}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400">
                    {blocks.map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {editing.group.instruments?.map((inst, idx) => (
                <div key={idx} className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-700">
                      {idx + 1}. {inst.description}
                      <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${stageBadgeClass(inst.stageKey)}`}>
                        {inst.stageKey.replace('_', ' ')}
                      </span>
                    </h3>
                    <button onClick={() => setPreviewInst(previewInst === idx ? null : idx)}
                      className="text-xs text-cyan-600 hover:text-cyan-700 font-medium">
                      {previewInst === idx ? 'Hide Preview' : 'Preview Values'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">S.No</label>
                      <input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        value={inst.serialNumber} onChange={e => updateInstrument(idx, 'serialNumber', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Instrument ID *</label>
                      <input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        value={inst.instrumentId} onChange={e => updateInstrument(idx, 'instrumentId', e.target.value)} placeholder="e.g. CAP-001" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">UOM *</label>
                      <input className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        value={inst.uom} onChange={e => updateInstrument(idx, 'uom', e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Least Count *</label>
                      <input type="number" step="any" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        value={inst.leastCount} onChange={e => updateInstrument(idx, 'leastCount', parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Instrument Min *</label>
                      <input type="number" step="any" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        value={inst.instrumentMin} onChange={e => updateInstrument(idx, 'instrumentMin', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Instrument Max *</label>
                      <input type="number" step="any" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        value={inst.instrumentMax} onChange={e => updateInstrument(idx, 'instrumentMax', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Operating Min *</label>
                      <input type="number" step="any" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        value={inst.operatingMin} onChange={e => updateInstrument(idx, 'operatingMin', parseFloat(e.target.value) || 0)} />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500 block mb-1">Operating Max *</label>
                      <input type="number" step="any" className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1.5 text-slate-800 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500/30 focus:border-cyan-400"
                        value={inst.operatingMax} onChange={e => updateInstrument(idx, 'operatingMax', parseFloat(e.target.value) || 0)} />
                    </div>
                  </div>
                  {previewInst === idx && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <p className="text-xs text-slate-500 mb-2">Dropdown values ({inst.operatingMin} to {inst.operatingMax}, step {inst.leastCount}):</p>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {generateValues(inst.operatingMin, inst.operatingMax, inst.leastCount).slice(0, 100).map((v, i) => (
                          <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-200 rounded text-xs">{v} {inst.uom}</span>
                        ))}
                        {generateValues(inst.operatingMin, inst.operatingMax, inst.leastCount).length > 100 && (
                          <span className="text-xs text-slate-400">...and more</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {error && (
                <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700 flex items-center justify-between">
                  <span>{error}</span>
                  <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 ml-4 font-bold">&times;</button>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex gap-3 shrink-0">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-200 transition-colors">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-cyan-600 text-white rounded-xl font-bold disabled:opacity-40 hover:bg-cyan-700 transition-colors flex items-center justify-center gap-2 shadow-sm">
                {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : null}
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
