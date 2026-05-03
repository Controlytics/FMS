import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import type { TelemetryDef } from '../../template-types';
import { TELEMETRY_DATA_TYPES } from '../../template-types';
import { RemoveButton } from './remove-button';

export function TelemetryRow({ tel, idx, onUpdate, onRemove }: {
  tel: TelemetryDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 space-y-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-4 gap-3 pr-8">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Field Name</label>
          <Input
            value={tel.fieldName}
            onChange={(e) => onUpdate(idx, 'fieldName', e.target.value)}
            placeholder="e.g. temperature"
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Data Type</label>
          <Select
            value={tel.dataType}
            onChange={(e) => onUpdate(idx, 'dataType', e.target.value)}
            selectSize="sm"
          >
            {TELEMETRY_DATA_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Unit</label>
          <Input
            value={tel.unit}
            onChange={(e) => onUpdate(idx, 'unit', e.target.value)}
            placeholder="e.g. \u00b0C, psi, %"
            className="text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Description</label>
          <Input
            value={tel.description}
            onChange={(e) => onUpdate(idx, 'description', e.target.value)}
            placeholder="Optional description"
            className="text-xs"
          />
        </div>
      </div>
    </div>
  );
}
