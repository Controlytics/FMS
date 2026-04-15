import { Plus, Trash2 } from 'lucide-react';
import type { KVSection } from './template-types';

interface Props {
  section: KVSection;
  onChange: (updated: KVSection) => void;
}

export function KVSectionEditor({ section, onChange }: Props) {
  const addEntry = () => {
    onChange({
      ...section,
      entries: [...section.entries, { label: '', value: '' }],
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Section Title</label>
        <input value={section.title} onChange={e => onChange({ ...section, title: e.target.value })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" placeholder="Filter Details" />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Layout</label>
        <select value={section.layout}
          onChange={e => onChange({ ...section, layout: e.target.value as any })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
          <option value="one_column">1 Column</option>
          <option value="two_column">2 Columns</option>
          <option value="three_column">3 Columns</option>
        </select>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-slate-700">Entries ({section.entries.length})</label>
          <button onClick={addEntry}
            className="flex items-center gap-1 text-xs font-medium hover:text-blue-500" style={{ color: 'var(--theme-primary)' }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        <div className="space-y-2">
          {section.entries.map((entry, idx) => (
            <div key={idx} className="flex items-start gap-2 p-2 bg-slate-50 rounded-lg">
              <div className="flex-1 space-y-1.5">
                <input value={entry.label} placeholder="Label"
                  onChange={e => {
                    const entries = [...section.entries];
                    entries[idx] = { ...entry, label: e.target.value };
                    onChange({ ...section, entries });
                  }}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-medium outline-none bg-white" />
                <input value={entry.value} placeholder="{{attr.$slot.field}}"
                  onChange={e => {
                    const entries = [...section.entries];
                    entries[idx] = { ...entry, value: e.target.value };
                    onChange({ ...section, entries });
                  }}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono outline-none bg-white" />
                <select value={entry.format?.type ?? 'text'}
                  onChange={e => {
                    const entries = [...section.entries];
                    entries[idx] = { ...entry, format: { ...entry.format, type: e.target.value as any } };
                    onChange({ ...section, entries });
                  }}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none bg-white">
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="datetime">Date/Time</option>
                </select>
              </div>
              <button onClick={() => onChange({ ...section, entries: section.entries.filter((_, i) => i !== idx) })}
                className="p-1 text-slate-300 hover:text-red-500 mt-1">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
