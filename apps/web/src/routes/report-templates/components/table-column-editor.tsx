import { ChevronDown, ChevronUp, Trash2, Plus } from 'lucide-react';
import { useState } from 'react';
import type { TableColumn, ConditionalRule } from './template-types';
import { ConditionalRuleEditor } from './conditional-rule-editor';

interface Props {
  column: TableColumn;
  index: number;
  onChange: (updated: TableColumn) => void;
  onRemove: () => void;
}

export function TableColumnEditor({ column, index, onChange, onRemove }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border border-slate-200 rounded-xl overflow-hidden">
      {/* Collapsed header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className="text-xs font-semibold text-slate-400 w-5">#{index + 1}</span>
        <span className="text-sm font-medium text-slate-700 flex-1 truncate">{column.header || column.key || 'New Column'}</span>
        <button onClick={e => { e.stopPropagation(); onRemove(); }} className="p-0.5 text-slate-300 hover:text-red-500">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </div>

      {expanded && (
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500">Data Key</label>
              <input value={column.key} onChange={e => onChange({ ...column, key: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" placeholder="field_name" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Header Label</label>
              <input value={column.header} onChange={e => onChange({ ...column, header: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" placeholder="Display Name" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500">Width</label>
              <input value={column.width ?? ''} onChange={e => onChange({ ...column, width: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" placeholder="25% or 100px" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Align</label>
              <select value={column.style?.textAlign ?? 'left'}
                onChange={e => onChange({ ...column, style: { ...column.style, textAlign: e.target.value as any } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none">
                <option value="left">Left</option>
                <option value="center">Center</option>
                <option value="right">Right</option>
              </select>
            </div>
          </div>

          {/* Format */}
          <div>
            <label className="text-xs font-medium text-slate-500">Format</label>
            <select value={column.format?.type ?? 'text'}
              onChange={e => onChange({ ...column, format: { ...column.format, type: e.target.value as any } })}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none">
              <option value="text">Text</option>
              <option value="number">Number</option>
              <option value="datetime">Date/Time</option>
            </select>
          </div>

          {column.format?.type === 'number' && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-medium text-slate-500">Decimals</label>
                <input type="number" min={0} max={10} value={column.format.decimalPlaces ?? ''}
                  onChange={e => onChange({ ...column, format: { ...column.format!, decimalPlaces: Number(e.target.value) } })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-500">Unit</label>
                <input value={column.format.unit ?? ''} placeholder="°C, Pa, %"
                  onChange={e => onChange({ ...column, format: { ...column.format!, unit: e.target.value } })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
              </div>
            </div>
          )}

          {column.format?.type === 'datetime' && (
            <div>
              <label className="text-xs font-medium text-slate-500">Pattern</label>
              <input value={column.format.pattern ?? ''} placeholder="DD/MM/YYYY HH:mm"
                onChange={e => onChange({ ...column, format: { ...column.format!, pattern: e.target.value } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            </div>
          )}

          {/* Text transform */}
          <div>
            <label className="text-xs font-medium text-slate-500">Text Transform</label>
            <select value={column.style?.textTransform ?? 'none'}
              onChange={e => onChange({ ...column, style: { ...column.style, textTransform: e.target.value as any } })}
              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none">
              <option value="none">None</option>
              <option value="uppercase">UPPERCASE</option>
              <option value="lowercase">lowercase</option>
              <option value="capitalize">Capitalize</option>
            </select>
          </div>

          {/* Conditional rules */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-500">Conditional Formatting</label>
              <button onClick={() => onChange({ ...column, conditionalRules: [...(column.conditionalRules ?? []), { condition: 'gt', value: 0, style: {} }] })}
                className="flex items-center gap-1 text-xs font-medium hover:text-blue-500 transition-colors text-theme-primary">
                <Plus className="w-3 h-3" /> Add
              </button>
            </div>
            <div className="space-y-1.5">
              {(column.conditionalRules ?? []).map((rule, rIdx) => (
                <ConditionalRuleEditor key={rIdx} rule={rule}
                  onChange={updated => {
                    const rules = [...(column.conditionalRules ?? [])];
                    rules[rIdx] = updated;
                    onChange({ ...column, conditionalRules: rules });
                  }}
                  onRemove={() => onChange({ ...column, conditionalRules: column.conditionalRules?.filter((_, i) => i !== rIdx) })}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
