import type { TextSection } from './template-types';

interface Props {
  section: TextSection;
  onChange: (updated: TextSection) => void;
}

export function TextSectionEditor({ section, onChange }: Props) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Content</label>
        <textarea
          value={section.content}
          onChange={e => onChange({ ...section, content: e.target.value })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 resize-none outline-none focus:ring-2"
          style={{ '--tw-ring-color': 'color-mix(in srgb, var(--theme-primary) 20%, transparent)' } as React.CSSProperties}
          rows={6}
          placeholder="Enter text content. Use {{variable.tags}} for dynamic data..."
        />
        <p className="text-xs text-slate-400 mt-1">Supports variable tags like {'{{meta.org.name}}'} or {'{{attr.$slot.field}}'}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Font Family</label>
          <select value={section.style.fontFamily}
            onChange={e => onChange({ ...section, style: { ...section.style, fontFamily: e.target.value } })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none">
            <option value="Arial">Arial</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Times New Roman">Times New Roman</option>
            <option value="Courier New">Courier New</option>
            <option value="Georgia">Georgia</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Font Size</label>
          <input type="number" min={8} max={36} value={section.style.fontSize}
            onChange={e => onChange({ ...section, style: { ...section.style, fontSize: Number(e.target.value) } })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none" />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Line Height</label>
        <input type="number" min={1} max={3} step={0.1} value={section.style.lineHeight}
          onChange={e => onChange({ ...section, style: { ...section.style, lineHeight: Number(e.target.value) } })}
          className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 outline-none" />
      </div>
    </div>
  );
}
