import type { PageSettings } from './template-types';

interface Props {
  settings: PageSettings;
  onChange: (updated: PageSettings) => void;
}

export function PageSettingsEditor({ settings, onChange }: Props) {
  return (
    <div className="p-4">
      <h3 className="text-sm font-bold text-slate-800 mb-1">Page Settings</h3>
      <p className="text-xs text-slate-400 mb-4">Configure page layout for PDF output</p>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Page Size</label>
          <select value={settings.size}
            onChange={e => onChange({ ...settings, size: e.target.value as any })}
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none">
            <option value="A4">A4 (210 x 297 mm)</option>
            <option value="Letter">Letter (8.5 x 11 in)</option>
            <option value="Legal">Legal (8.5 x 14 in)</option>
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Orientation</label>
          <div className="flex gap-2">
            {(['portrait', 'landscape'] as const).map(o => (
              <button key={o} onClick={() => onChange({ ...settings, orientation: o })}
                className={`flex-1 py-2 rounded-xl text-sm font-medium border-2 transition-colors ${settings.orientation === o ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
                {o.charAt(0).toUpperCase() + o.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-2">Margins (mm)</label>
          <div className="grid grid-cols-2 gap-3">
            {(['top', 'right', 'bottom', 'left'] as const).map(side => (
              <div key={side}>
                <label className="text-xs font-medium text-slate-500 capitalize">{side}</label>
                <input type="number" min={0} max={50} value={settings.margins[side]}
                  onChange={e => onChange({ ...settings, margins: { ...settings.margins, [side]: Number(e.target.value) } })}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm outline-none" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
