import { Plus, Trash2 } from 'lucide-react';
import type { ChartSection, EntitySlot } from './template-types';

interface Props {
  section: ChartSection;
  onChange: (updated: ChartSection) => void;
  entitySlots: EntitySlot[];
}

const CHART_TYPES = [
  { value: 'line', label: 'Line' },
  { value: 'bar', label: 'Bar' },
  { value: 'pie', label: 'Pie' },
] as const;

const DEFAULT_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

export function ChartSectionEditor({ section, onChange, entitySlots }: Props) {
  const addSeries = () => {
    const color = DEFAULT_COLORS[section.dataSeries.length % DEFAULT_COLORS.length];
    onChange({
      ...section,
      dataSeries: [...section.dataSeries, { source: '', label: `Series ${section.dataSeries.length + 1}`, color }],
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Chart Title</label>
        <input value={section.title} onChange={e => onChange({ ...section, title: e.target.value })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" placeholder="Temperature Trend" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Chart Type</label>
          <select value={section.chartType}
            onChange={e => onChange({ ...section, chartType: e.target.value as any })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
            {CHART_TYPES.map(ct => <option key={ct.value} value={ct.value}>{ct.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Height (px)</label>
          <input type="number" min={100} max={800} value={section.height}
            onChange={e => onChange({ ...section, height: Number(e.target.value) })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" />
        </div>
      </div>

      <div className="flex gap-4">
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={section.showLegend}
            onChange={e => onChange({ ...section, showLegend: e.target.checked })} className="rounded" />
          Legend
        </label>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={section.showGrid}
            onChange={e => onChange({ ...section, showGrid: e.target.checked })} className="rounded" />
          Grid
        </label>
      </div>

      {/* Axes */}
      {section.chartType !== 'pie' && (
        <div className="space-y-3">
          <label className="text-sm font-semibold text-slate-700">Axes</label>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500">X Label</label>
              <input value={section.xAxis.label} onChange={e => onChange({ ...section, xAxis: { ...section.xAxis, label: e.target.value } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">X Type</label>
              <select value={section.xAxis.type ?? 'time'}
                onChange={e => onChange({ ...section, xAxis: { ...section.xAxis, type: e.target.value as any } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none">
                <option value="time">Time</option>
                <option value="linear">Linear</option>
                <option value="category">Category</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-xs font-medium text-slate-500">Y Label</label>
              <input value={section.yAxis.label} onChange={e => onChange({ ...section, yAxis: { ...section.yAxis, label: e.target.value } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Y Min</label>
              <input type="number" value={section.yAxis.min ?? ''} placeholder="Auto"
                onChange={e => onChange({ ...section, yAxis: { ...section.yAxis, min: e.target.value ? Number(e.target.value) : undefined } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">Y Max</label>
              <input type="number" value={section.yAxis.max ?? ''} placeholder="Auto"
                onChange={e => onChange({ ...section, yAxis: { ...section.yAxis, max: e.target.value ? Number(e.target.value) : undefined } })}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
            </div>
          </div>
        </div>
      )}

      {/* Data Series */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-slate-700">Data Series ({section.dataSeries.length})</label>
          <button onClick={addSeries}
            className="flex items-center gap-1 text-xs font-medium hover:text-blue-500" style={{ color: 'var(--theme-primary)' }}>
            <Plus className="w-3.5 h-3.5" /> Add
          </button>
        </div>
        <div className="space-y-2">
          {section.dataSeries.map((series, idx) => (
            <div key={idx} className="p-2.5 border border-slate-200 rounded-xl space-y-2">
              <div className="flex items-center gap-2">
                <input type="color" value={series.color}
                  onChange={e => {
                    const ds = [...section.dataSeries];
                    ds[idx] = { ...series, color: e.target.value };
                    onChange({ ...section, dataSeries: ds });
                  }}
                  className="w-6 h-6 rounded border border-slate-200 cursor-pointer" />
                <input value={series.label} placeholder="Label"
                  onChange={e => {
                    const ds = [...section.dataSeries];
                    ds[idx] = { ...series, label: e.target.value };
                    onChange({ ...section, dataSeries: ds });
                  }}
                  className="flex-1 border border-slate-200 rounded-lg px-2 py-1 text-sm outline-none" />
                <button onClick={() => onChange({ ...section, dataSeries: section.dataSeries.filter((_, i) => i !== idx) })}
                  className="p-0.5 text-slate-300 hover:text-red-500">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
              <input value={series.source} placeholder="ts.$slot.key[range]"
                onChange={e => {
                  const ds = [...section.dataSeries];
                  ds[idx] = { ...series, source: e.target.value };
                  onChange({ ...section, dataSeries: ds });
                }}
                className="w-full border border-slate-200 rounded-lg px-2 py-1 text-sm font-mono outline-none" />
            </div>
          ))}
        </div>
        {entitySlots.length > 0 && (
          <p className="text-xs text-slate-400 mt-1">Slots: {entitySlots.map(s => `$${s.name}`).join(', ')}</p>
        )}
      </div>
    </div>
  );
}
