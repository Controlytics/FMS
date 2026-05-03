import { Input } from '@/components/ui/input';
import type { AlarmRuleDef } from '../../template-types';
import { ALARM_RULE_TYPES, ALARM_SEVERITIES } from '../../template-types';
import { RemoveButton } from './remove-button';

export function AlarmRuleRow({ rule, idx, onUpdate, onRemove }: {
  rule: AlarmRuleDef;
  idx: number;
  onUpdate: (index: number, field: string, value: unknown) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-lg border border-slate-200 p-3 bg-white relative">
      <RemoveButton onClick={() => onRemove(idx)} />
      <div className="grid grid-cols-3 gap-3 pr-6 mb-2">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Rule Name *</label>
          <Input
            value={rule.name}
            onChange={(e) => onUpdate(idx, 'name', e.target.value)}
            placeholder="e.g., High Temperature"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Type</label>
          <select
            value={rule.type}
            onChange={(e) => onUpdate(idx, 'type', e.target.value)}
            className="w-full h-8 text-xs rounded-md border border-slate-200 px-2 bg-white"
          >
            {ALARM_RULE_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Severity</label>
          <select
            value={rule.severity}
            onChange={(e) => onUpdate(idx, 'severity', e.target.value)}
            className="w-full h-8 text-xs rounded-md border border-slate-200 px-2 bg-white"
          >
            {ALARM_SEVERITIES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-2">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Source Field</label>
          <Input
            value={rule.sourceField}
            onChange={(e) => onUpdate(idx, 'sourceField', e.target.value)}
            placeholder="e.g., Temperature, Recording Status"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Threshold</label>
          <Input
            type="number"
            value={rule.threshold}
            onChange={(e) => onUpdate(idx, 'threshold', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="e.g., 85"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Deadband</label>
          <Input
            type="number"
            value={rule.deadband}
            onChange={(e) => onUpdate(idx, 'deadband', e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="Hysteresis value"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Condition / Expression</label>
          <Input
            value={rule.condition}
            onChange={(e) => onUpdate(idx, 'condition', e.target.value)}
            placeholder="e.g., > 85.0, = Off, custom expression"
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Message Template</label>
          <Input
            value={rule.message}
            onChange={(e) => onUpdate(idx, 'message', e.target.value)}
            placeholder="e.g., Temperature exceeded {threshold} for {entity.name}"
            className="h-8 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Notify Roles (comma-separated)</label>
          <Input
            value={rule.notifyRoles}
            onChange={(e) => onUpdate(idx, 'notifyRoles', e.target.value)}
            placeholder="e.g., SUPERVISOR, ADMIN"
            className="h-8 text-xs"
          />
        </div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={rule.enabled}
              onChange={(e) => onUpdate(idx, 'enabled', e.target.checked)}
              className="rounded border-slate-300"
            />
            Enabled
          </label>
        </div>
      </div>
    </div>
  );
}
