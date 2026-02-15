import { useState } from 'react';
import { SCHEDULE_FREQUENCIES, type ScheduleFrequency } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

interface ScheduleEditorProps {
  open: boolean;
  onClose: () => void;
  nodeChecklistId: string;
  onCreated?: () => void;
}

export function ScheduleEditor({ open, onClose, nodeChecklistId, onCreated }: ScheduleEditorProps) {
  const [frequency, setFrequency] = useState<ScheduleFrequency>('DAILY');
  const [frequencyValue, setFrequencyValue] = useState<string>('');
  const [toleranceBefore, setToleranceBefore] = useState<string>('');
  const [toleranceAfter, setToleranceAfter] = useState<string>('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await apiClient.post('/api/schedules', {
        nodeChecklistId,
        frequency,
        frequencyValue: frequencyValue ? Number(frequencyValue) : undefined,
        toleranceBefore: toleranceBefore ? Number(toleranceBefore) : undefined,
        toleranceAfter: toleranceAfter ? Number(toleranceAfter) : undefined,
      });
      onCreated?.();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create schedule');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogHeader>
        <DialogTitle>Create Schedule</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <div className="space-y-2">
          <label className="text-sm font-medium">Frequency</label>
          <Select value={frequency} onChange={e => setFrequency(e.target.value as ScheduleFrequency)}>
            {SCHEDULE_FREQUENCIES.map(f => <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>)}
          </Select>
        </div>

        {['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'].includes(frequency) && (
          <div className="space-y-2">
            <label className="text-sm font-medium">Every N {frequency === 'HOURLY' ? 'hours' : frequency === 'DAILY' ? 'days' : frequency === 'WEEKLY' ? 'weeks' : 'months'}</label>
            <Input type="number" value={frequencyValue} onChange={e => setFrequencyValue(e.target.value)} placeholder="1" min="1" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Tolerance Before (min)</label>
            <Input type="number" value={toleranceBefore} onChange={e => setToleranceBefore(e.target.value)} placeholder="e.g., 30" min="0" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">Tolerance After (min)</label>
            <Input type="number" value={toleranceAfter} onChange={e => setToleranceAfter(e.target.value)} placeholder="e.g., 60" min="0" />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          Onboarding mode: The first completion sets the anchor date for all subsequent schedules.
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Schedule'}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
