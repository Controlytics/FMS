import { Plus, Trash2 } from 'lucide-react';
import type { EntitySlot } from './template-types';

interface Props {
  slots: EntitySlot[];
  onChange: (slots: EntitySlot[]) => void;
}

export function EntitySlotEditor({ slots, onChange }: Props) {
  const addSlot = () => {
    onChange([...slots, { name: `slot_${slots.length + 1}`, label: '', type: 'asset_instance' }]);
  };

  return (
    <div className="p-4 border-b border-slate-100">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Entity Slots</h3>
        <button onClick={addSlot}
          className="p-1 rounded-lg hover:bg-slate-100 transition-colors text-theme-primary">
          <Plus className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">Define placeholders that users fill when generating reports</p>

      <div className="space-y-2">
        {slots.map((slot, idx) => (
          <div key={idx} className="p-2.5 bg-slate-50 rounded-xl space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">${slot.name}</span>
              <div className="flex-1" />
              <button onClick={() => onChange(slots.filter((_, i) => i !== idx))}
                className="p-0.5 text-slate-300 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            <input value={slot.name} placeholder="Variable name"
              onChange={e => {
                const s = [...slots];
                s[idx] = { ...slot, name: e.target.value };
                onChange(s);
              }}
              className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono outline-none bg-white" />
            <input value={slot.label} placeholder="Display label"
              onChange={e => {
                const s = [...slots];
                s[idx] = { ...slot, label: e.target.value };
                onChange(s);
              }}
              className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none bg-white" />
            <select value={slot.type}
              onChange={e => {
                const s = [...slots];
                s[idx] = { ...slot, type: e.target.value as any };
                onChange(s);
              }}
              className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none bg-white">
              <option value="asset_instance">Asset Instance</option>
              <option value="equipment_group">Equipment Group</option>
              <option value="uns_path">UNS Path</option>
            </select>
            {slot.type === 'asset_instance' && (
              <input value={slot.templateFilter ?? ''} placeholder="Template filter (optional)"
                onChange={e => {
                  const s = [...slots];
                  s[idx] = { ...slot, templateFilter: e.target.value };
                  onChange(s);
                }}
                className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none bg-white" />
            )}
            {slot.type === 'uns_path' && (
              <input value={slot.pathPrefix ?? ''} placeholder="Path prefix (optional)"
                onChange={e => {
                  const s = [...slots];
                  s[idx] = { ...slot, pathPrefix: e.target.value };
                  onChange(s);
                }}
                className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none bg-white" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
