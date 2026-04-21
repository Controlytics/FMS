import { Plus, Trash2 } from 'lucide-react';
import type { HeaderFooterConfig, HeaderFooterElement } from './template-types';

interface Props {
  label: string;
  config: HeaderFooterConfig;
  onChange: (updated: HeaderFooterConfig) => void;
}

export function HeaderFooterEditor({ label, config, onChange }: Props) {
  const addElement = (type: 'text' | 'image') => {
    const el: HeaderFooterElement = type === 'text'
      ? { type: 'text', content: '', position: 'left', style: { fontSize: 10 } }
      : { type: 'image', source: 'branding_logo', position: 'left', width: 120 };
    onChange({ ...config, elements: [...config.elements, el] });
  };

  return (
    <div className="p-4">
      <h3 className="text-sm font-bold text-slate-800 mb-1">{label}</h3>
      <p className="text-xs text-slate-400 mb-4">Configure {label.toLowerCase()} elements</p>

      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer mb-4">
        <input type="checkbox" checked={config.enabled}
          onChange={e => onChange({ ...config, enabled: e.target.checked })}
          className="rounded" />
        Enable {label.toLowerCase()}
      </label>

      {config.enabled && (
        <>
          <div className="mb-4">
            <label className="block text-sm font-medium text-slate-700 mb-1">Height (px)</label>
            <input type="number" min={20} max={200} value={config.height}
              onChange={e => onChange({ ...config, height: Number(e.target.value) })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none" />
          </div>

          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-slate-700">Elements ({config.elements.length})</label>
            <div className="flex gap-1">
              <button onClick={() => addElement('text')}
                className="px-2 py-1 text-xs font-medium rounded-lg hover:bg-slate-100 transition-colors text-theme-primary">
                + Text
              </button>
              <button onClick={() => addElement('image')}
                className="px-2 py-1 text-xs font-medium rounded-lg hover:bg-slate-100 transition-colors text-theme-primary">
                + Image
              </button>
            </div>
          </div>

          <div className="space-y-2">
            {config.elements.map((el, idx) => (
              <div key={idx} className="p-3 border border-slate-200 rounded-xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500 uppercase">{el.type}</span>
                  <button onClick={() => onChange({ ...config, elements: config.elements.filter((_, i) => i !== idx) })}
                    className="p-0.5 text-slate-300 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {el.type === 'text' ? (
                  <input value={el.content ?? ''} placeholder="Text or {{variable.tag}}"
                    onChange={e => {
                      const elements = [...config.elements];
                      elements[idx] = { ...el, content: e.target.value };
                      onChange({ ...config, elements });
                    }}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
                ) : (
                  <select value={el.source ?? 'branding_logo'}
                    onChange={e => {
                      const elements = [...config.elements];
                      elements[idx] = { ...el, source: e.target.value };
                      onChange({ ...config, elements });
                    }}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none">
                    <option value="branding_logo">Organization Logo</option>
                  </select>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs font-medium text-slate-500">Position</label>
                    <select value={el.position}
                      onChange={e => {
                        const elements = [...config.elements];
                        elements[idx] = { ...el, position: e.target.value as any };
                        onChange({ ...config, elements });
                      }}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none">
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </select>
                  </div>
                  {el.type === 'text' && (
                    <div>
                      <label className="text-xs font-medium text-slate-500">Font Size</label>
                      <input type="number" min={6} max={24} value={el.style?.fontSize ?? 10}
                        onChange={e => {
                          const elements = [...config.elements];
                          elements[idx] = { ...el, style: { ...el.style, fontSize: Number(e.target.value) } };
                          onChange({ ...config, elements });
                        }}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none" />
                    </div>
                  )}
                  {el.type === 'image' && (
                    <div>
                      <label className="text-xs font-medium text-slate-500">Width (px)</label>
                      <input type="number" min={20} max={400} value={el.width ?? 120}
                        onChange={e => {
                          const elements = [...config.elements];
                          elements[idx] = { ...el, width: Number(e.target.value) };
                          onChange({ ...config, elements });
                        }}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none" />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
