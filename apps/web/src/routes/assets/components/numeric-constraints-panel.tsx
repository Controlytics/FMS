import { useState, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { constraintPreview } from '../template-types';

export function NumericConstraintsPanel({
  enableConstraints,
  min,
  max,
  resolution,
  dataType,
  onChange,
}: {
  enableConstraints: boolean;
  min: number | '';
  max: number | '';
  resolution: number | '';
  dataType: 'INTEGER' | 'FLOAT';
  onChange: (field: string, value: unknown) => void;
}) {
  const preview = enableConstraints ? constraintPreview(min, max, resolution) : null;
  const isInt = dataType === 'INTEGER';

  // Local display strings so we can show "24.0" after blur without interfering while typing
  const fmt = (v: number | '') => {
    if (v === '') return '';
    if (!isInt && Number.isInteger(v)) return v.toFixed(1);
    return String(v);
  };
  const [minStr, setMinStr] = useState(fmt(min));
  const [maxStr, setMaxStr] = useState(fmt(max));
  const [resStr, setResStr] = useState(fmt(resolution));

  // Sync from parent when external value changes (e.g. loading edit form)
  useEffect(() => { setMinStr(fmt(min)); }, [min, isInt]);
  useEffect(() => { setMaxStr(fmt(max)); }, [max, isInt]);
  useEffect(() => { setResStr(fmt(resolution)); }, [resolution, isInt]);

  const handleLocalChange = (field: string, raw: string, setLocal: (v: string) => void) => {
    if (raw === '' || raw === '-') { setLocal(raw); onChange(field, ''); return; }
    if (isInt) {
      if (/^-?\d+$/.test(raw)) { setLocal(raw); onChange(field, parseInt(raw, 10)); }
    } else {
      if (/^-?\d*\.?\d*$/.test(raw)) {
        setLocal(raw);
        const n = Number(raw);
        if (!isNaN(n) && raw !== '.' && raw !== '-.' && raw !== '-') onChange(field, n);
      }
    }
  };

  const handleBlur = (raw: string, setLocal: (v: string) => void) => {
    if (!isInt && raw !== '' && /^-?\d+$/.test(raw)) {
      setLocal(raw + '.0');
    }
  };

  return (
    <div className="mt-2 p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enableConstraints}
          onChange={(e) => onChange('enableConstraints', e.target.checked)}
          className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
        />
        <span className="text-xs font-medium text-slate-600">Enable Numeric Constraints</span>
      </label>
      {enableConstraints && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Min</label>
              <Input
                type="text"
                inputMode="numeric"
                value={minStr}
                onChange={(e) => handleLocalChange('min', e.target.value, setMinStr)}
                onBlur={() => handleBlur(minStr, setMinStr)}
                className="h-8 text-xs"
                placeholder={isInt ? '0' : '0.0'}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Max</label>
              <Input
                type="text"
                inputMode="numeric"
                value={maxStr}
                onChange={(e) => handleLocalChange('max', e.target.value, setMaxStr)}
                onBlur={() => handleBlur(maxStr, setMaxStr)}
                className="h-8 text-xs"
                placeholder={isInt ? '100' : '100.0'}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Resolution</label>
              <Input
                type="text"
                inputMode="numeric"
                value={resStr}
                onChange={(e) => handleLocalChange('resolution', e.target.value, setResStr)}
                onBlur={() => handleBlur(resStr, setResStr)}
                className="h-8 text-xs"
                placeholder={isInt ? '1' : '0.1'}
              />
            </div>
          </div>
          {preview && (
            <p className="text-[11px] text-purple-600 font-medium bg-purple-50 px-2 py-1 rounded">{preview}</p>
          )}
        </>
      )}
    </div>
  );
}
