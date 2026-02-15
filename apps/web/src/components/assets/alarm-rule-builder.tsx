import { useState } from 'react';
import { ALARM_RULE_TYPES, ALARM_SEVERITIES, type AlarmRuleType, type AlarmSeverity } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface AlarmRuleBuilderProps {
  open: boolean;
  onClose: () => void;
  nodeId: string;
  onCreated?: () => void;
}

export function AlarmRuleBuilder({ open, onClose, nodeId, onCreated }: AlarmRuleBuilderProps) {
  const [name, setName] = useState('');
  const [ruleType, setRuleType] = useState<AlarmRuleType>('THRESHOLD');
  const [field, setField] = useState('');
  const [operator, setOperator] = useState('gt');
  const [value, setValue] = useState('');
  const [severity, setSeverity] = useState<AlarmSeverity>('WARNING');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    setSubmitting(true);
    try {
      await apiClient.post('/api/alarms/rules', {
        nodeId, name, ruleType,
        config: {
          field: field || undefined,
          operator: operator || undefined,
          value: value ? (isNaN(Number(value)) ? value : Number(value)) : undefined,
          severity,
          notifyRoles: [],
        },
      });
      onCreated?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create alarm rule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Create Alarm Rule</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <div className="space-y-2">
          <label className="text-sm font-medium">Rule Name *</label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., High Temperature Alert" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Rule Type</label>
            <Select value={ruleType} onChange={e => setRuleType(e.target.value as AlarmRuleType)}>
              {ALARM_RULE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Severity</label>
            <Select value={severity} onChange={e => setSeverity(e.target.value as AlarmSeverity)}>
              {ALARM_SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
            </Select>
          </div>
        </div>

        {(ruleType === 'THRESHOLD' || ruleType === 'CHECKLIST_FIELD') && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Condition</label>
            <div className="flex gap-2">
              <Input className="flex-1" value={field} onChange={e => setField(e.target.value)} placeholder="Field name / question ID" />
              <Select className="w-24" value={operator} onChange={e => setOperator(e.target.value)}>
                <option value="gt">&gt;</option>
                <option value="gte">&ge;</option>
                <option value="lt">&lt;</option>
                <option value="lte">&le;</option>
                <option value="eq">=</option>
                <option value="neq">&ne;</option>
              </Select>
              <Input className="w-24" value={value} onChange={e => setValue(e.target.value)} placeholder="Value" />
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Rule'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
