import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { IdentifierDef } from '../../template-types';
import { IDENTIFIER_TYPES } from '../../template-types';
import { RemoveButton } from './remove-button';

export function IdentifierRow({ ident, idx, onUpdate, onRemove }: {
  ident: IdentifierDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-3 gap-3 pr-6">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Identifier Type</label>
          <Select
            value={ident.identifierType}
            onChange={(e) => onUpdate(idx, 'identifierType', e.target.value)}
            selectSize="sm"
          >
            {IDENTIFIER_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Label</label>
          <Input
            value={ident.label}
            onChange={(e) => onUpdate(idx, 'label', e.target.value)}
            placeholder="e.g., Equipment QR Code"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ident.required}
              onChange={(e) => onUpdate(idx, 'required', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs font-medium text-slate-600">Required</span>
          </label>
        </div>
      </div>
    </div>
  );
}
