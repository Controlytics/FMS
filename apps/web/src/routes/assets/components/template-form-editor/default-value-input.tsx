import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { AttributeDef } from '../../template-types';

export function DefaultValueInput({ attr, idx, onUpdate }: {
  attr: AttributeDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
}) {
  if (attr.dataType === 'BOOLEAN') {
    return (
      <label className="flex items-center gap-2 cursor-pointer h-8">
        <input
          type="checkbox"
          checked={attr.defaultValue === 'true'}
          onChange={(e) => onUpdate(idx, 'defaultValue', e.target.checked ? 'true' : 'false')}
          className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
        />
        <span className="text-xs text-slate-600">{attr.defaultValue === 'true' ? 'Yes' : 'No'}</span>
      </label>
    );
  }
  if (attr.dataType === 'INTEGER') {
    return (
      <Input
        type="text"
        inputMode="numeric"
        value={attr.defaultValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || v === '-') { onUpdate(idx, 'defaultValue', v); return; }
          if (/^-?\d+$/.test(v)) onUpdate(idx, 'defaultValue', v);
        }}
        placeholder="e.g., 0 (whole numbers only)"
        className="h-8 text-xs"
      />
    );
  }
  if (attr.dataType === 'FLOAT') {
    return (
      <Input
        type="text"
        inputMode="decimal"
        value={attr.defaultValue}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '' || v === '-' || v === '.' || v === '-.') { onUpdate(idx, 'defaultValue', v); return; }
          if (/^-?\d*\.?\d*$/.test(v)) onUpdate(idx, 'defaultValue', v);
        }}
        onBlur={() => {
          const v = attr.defaultValue;
          if (v !== '' && /^-?\d+$/.test(v)) onUpdate(idx, 'defaultValue', v + '.0');
        }}
        placeholder="e.g., 0.0 (decimal numbers)"
        className="h-8 text-xs"
      />
    );
  }
  if (attr.dataType === 'DATE') {
    return (
      <Input
        type="date"
        value={attr.defaultValue}
        onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
        className="h-8 text-xs"
      />
    );
  }
  if (attr.dataType === 'DATETIME') {
    return (
      <Input
        type="datetime-local"
        value={attr.defaultValue}
        onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
        className="h-8 text-xs"
      />
    );
  }
  if (attr.dataType === 'DROPDOWN') {
    return (
      <Select
        value={attr.defaultValue}
        onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
        selectSize="sm"
      >
        <option value="">No default</option>
        {(attr.options ? attr.options.split(',').map(o => o.trim()).filter(Boolean) : []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </Select>
    );
  }
  if (attr.dataType === 'URL') {
    return (
      <Input
        type="url"
        value={attr.defaultValue}
        onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
        placeholder="https://..."
        className="h-8 text-xs"
      />
    );
  }
  // TEXT, FILE, or fallback
  return (
    <Input
      type="text"
      value={attr.defaultValue}
      onChange={(e) => onUpdate(idx, 'defaultValue', e.target.value)}
      placeholder="Default"
      className="h-8 text-xs"
    />
  );
}
