import { Plus } from 'lucide-react';
import type { TableSection, EntitySlot } from './template-types';
import { TableColumnEditor } from './table-column-editor';

interface Props {
  section: TableSection;
  onChange: (updated: TableSection) => void;
  entitySlots: EntitySlot[];
}

export function TableSectionEditor({ section, onChange, entitySlots }: Props) {
  const addColumn = () => {
    onChange({
      ...section,
      columns: [...section.columns, { key: '', header: '', style: {} }],
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Table Title</label>
        <input value={section.title} onChange={e => onChange({ ...section, title: e.target.value })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" placeholder="e.g. Telemetry Readings" />
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Data Source</label>
        <input value={section.dataSource} onChange={e => onChange({ ...section, dataSource: e.target.value })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono outline-none" placeholder="ts.$slot.key[range]" />
        {entitySlots.length > 0 && (
          <p className="text-xs text-slate-400 mt-1">Slots: {entitySlots.map(s => `$${s.name}`).join(', ')}</p>
        )}
      </div>

      {/* Table settings */}
      <div>
        <label className="text-sm font-semibold text-slate-700">Table Settings</label>
        <div className="mt-2 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500">Rows / Page</label>
              <input type="number" min={5} max={200} value={section.tableSettings.maxRowsPerPage}
                onChange={e => onChange({ ...section, tableSettings: { ...section.tableSettings, maxRowsPerPage: Number(e.target.value) } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Body Font Size</label>
              <input type="number" min={6} max={20} value={section.tableSettings.bodyStyle.fontSize}
                onChange={e => onChange({ ...section, tableSettings: { ...section.tableSettings, bodyStyle: { ...section.tableSettings.bodyStyle, fontSize: Number(e.target.value) } } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            </div>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {(['wrapText', 'showBorders', 'stripedRows', 'headerRepeat'] as const).map(key => (
              <label key={key} className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={section.tableSettings[key]}
                  onChange={e => onChange({ ...section, tableSettings: { ...section.tableSettings, [key]: e.target.checked } })}
                  className="rounded" />
                {key === 'wrapText' ? 'Wrap' : key === 'showBorders' ? 'Borders' : key === 'stripedRows' ? 'Striped' : 'Repeat Header'}
              </label>
            ))}
          </div>

          <div>
            <label className="text-xs font-medium text-slate-500">Empty Value</label>
            <input value={section.tableSettings.emptyValue}
              onChange={e => onChange({ ...section, tableSettings: { ...section.tableSettings, emptyValue: e.target.value } })}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" placeholder="&#x2014;" />
          </div>
        </div>
      </div>

      {/* Columns */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-slate-700">Columns ({section.columns.length})</label>
          <button onClick={addColumn}
            className="flex items-center gap-1 text-xs font-medium hover:text-blue-500 transition-colors" style={{ color: 'var(--theme-primary)' }}>
            <Plus className="w-3.5 h-3.5" /> Add Column
          </button>
        </div>
        <div className="space-y-2">
          {section.columns.map((col, idx) => (
            <TableColumnEditor key={idx} column={col} index={idx}
              onChange={updated => {
                const cols = [...section.columns];
                cols[idx] = updated;
                onChange({ ...section, columns: cols });
              }}
              onRemove={() => onChange({ ...section, columns: section.columns.filter((_, i) => i !== idx) })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
