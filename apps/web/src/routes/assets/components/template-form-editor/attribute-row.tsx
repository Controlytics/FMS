import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { NumericConstraintsPanel } from '../numeric-constraints-panel';
import type { AttributeDef } from '../../template-types';
import { ATTRIBUTE_DATA_TYPES } from '../../template-types';
import { RemoveButton } from './remove-button';
import { DefaultValueInput } from './default-value-input';

export function AttributeRow({ attr, idx, onUpdate, onRemove }: {
  attr: AttributeDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-3 gap-3 pr-6">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Field Name</label>
          <Input
            value={attr.fieldName}
            onChange={(e) => onUpdate(idx, 'fieldName', e.target.value)}
            placeholder="e.g., serialNumber"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Data Type</label>
          <Select
            value={attr.dataType}
            onChange={(e) => {
              onUpdate(idx, 'dataType', e.target.value);
              onUpdate(idx, 'defaultValue', '');
            }}
            selectSize="sm"
          >
            {ATTRIBUTE_DATA_TYPES.map((dt) => (
              <option key={dt} value={dt}>{dt}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Unit</label>
          <Input
            value={attr.unit}
            onChange={(e) => onUpdate(idx, 'unit', e.target.value)}
            placeholder="e.g., kg, mm"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Default Value</label>
          <DefaultValueInput attr={attr} idx={idx} onUpdate={onUpdate} />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={attr.required}
              onChange={(e) => onUpdate(idx, 'required', e.target.checked)}
              className="w-4 h-4 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-xs font-medium text-slate-600">Required</span>
          </label>
        </div>
      </div>
      {/* DROPDOWN options */}
      {attr.dataType === 'DROPDOWN' && (
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Options (comma-separated)</label>
          <textarea
            value={attr.options || ''}
            onChange={(e) => onUpdate(idx, 'options', e.target.value)}
            placeholder="Option1, Option2, Option3"
            rows={2}
            className="flex w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 resize-none"
          />
        </div>
      )}
      {/* Numeric constraints */}
      {(attr.dataType === 'INTEGER' || attr.dataType === 'FLOAT') && (
        <NumericConstraintsPanel
          enableConstraints={!!attr.enableConstraints}
          min={attr.min ?? ''}
          max={attr.max ?? ''}
          resolution={attr.resolution ?? ''}
          dataType={attr.dataType as 'INTEGER' | 'FLOAT'}
          onChange={(field, value) => onUpdate(idx, field, value)}
        />
      )}
    </div>
  );
}
