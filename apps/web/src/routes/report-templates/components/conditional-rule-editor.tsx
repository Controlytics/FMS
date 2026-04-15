import { Trash2 } from 'lucide-react';
import type { ConditionalRule } from './template-types';

interface Props {
  rule: ConditionalRule;
  onChange: (updated: ConditionalRule) => void;
  onRemove: () => void;
}

const CONDITIONS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
  { value: 'between', label: 'Between' },
  { value: 'contains', label: 'Contains' },
  { value: 'empty', label: 'Empty' },
  { value: 'not_empty', label: 'Not Empty' },
] as const;

export function ConditionalRuleEditor({ rule, onChange, onRemove }: Props) {
  const needsValue = !['empty', 'not_empty'].includes(rule.condition);
  const isBetween = rule.condition === 'between';

  return (
    <div className="flex flex-wrap items-center gap-1.5 p-2 bg-slate-50 rounded-lg text-xs">
      <select value={rule.condition}
        onChange={e => onChange({ ...rule, condition: e.target.value as ConditionalRule['condition'] })}
        className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white outline-none">
        {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
      </select>

      {isBetween ? (
        <>
          <input type="number" value={rule.min ?? ''} placeholder="Min"
            onChange={e => onChange({ ...rule, min: Number(e.target.value) })}
            className="w-14 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white outline-none" />
          <span className="text-slate-400">-</span>
          <input type="number" value={rule.max ?? ''} placeholder="Max"
            onChange={e => onChange({ ...rule, max: Number(e.target.value) })}
            className="w-14 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white outline-none" />
        </>
      ) : needsValue ? (
        <input type="text" value={rule.value ?? ''} placeholder="Value"
          onChange={e => onChange({ ...rule, value: e.target.value })}
          className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white outline-none" />
      ) : null}

      <span className="text-slate-300 mx-0.5">&rarr;</span>

      <button onClick={() => onChange({ ...rule, style: { ...rule.style, fontWeight: rule.style.fontWeight === 'bold' ? 'normal' : 'bold' } })}
        className={`w-6 h-6 rounded border text-xs font-bold ${rule.style.fontWeight === 'bold' ? 'bg-slate-200 border-slate-300' : 'bg-white border-slate-200'}`}>
        B
      </button>
      <button onClick={() => onChange({ ...rule, style: { ...rule.style, fontStyle: rule.style.fontStyle === 'italic' ? 'normal' : 'italic' } })}
        className={`w-6 h-6 rounded border text-xs italic ${rule.style.fontStyle === 'italic' ? 'bg-slate-200 border-slate-300' : 'bg-white border-slate-200'}`}>
        I
      </button>

      <input type="color" value={rule.style.color || '#000000'} title="Text color"
        onChange={e => onChange({ ...rule, style: { ...rule.style, color: e.target.value } })}
        className="w-6 h-6 rounded border border-slate-200 cursor-pointer" />
      <input type="color" value={rule.style.backgroundColor || '#ffffff'} title="Background"
        onChange={e => onChange({ ...rule, style: { ...rule.style, backgroundColor: e.target.value } })}
        className="w-6 h-6 rounded border border-slate-200 cursor-pointer" />

      <button onClick={onRemove} className="ml-auto p-0.5 text-slate-300 hover:text-red-500">
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
