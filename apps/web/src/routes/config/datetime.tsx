import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { datetimeConfigSchema, type DatetimeConfig } from '@digilog/shared';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

export function DatetimeConfigPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { data } = useSWR('/api/config/datetime');

  const { register, handleSubmit, formState: { isSubmitting } } = useForm<DatetimeConfig>({
    resolver: zodResolver(datetimeConfigSchema),
    values: data ?? undefined,
  });

  const onSubmit = async (formData: DatetimeConfig) => {
    setError(''); setSuccess('');
    try {
      await apiClient.put('/api/config/datetime', formData);
      setSuccess('Date/time format updated successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to update');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader><CardTitle>Date/Time Format Configuration</CardTitle></CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

            <div className="space-y-2">
              <label className="text-sm font-medium">Date Format</label>
              <Select {...register('dateFormat')}>
                <option value="DD/MM/YYYY">DD/MM/YYYY (25/12/2024)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (12/25/2024)</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (2024-12-25) - ISO</option>
                <option value="DD-MMM-YYYY">DD-MMM-YYYY (25-Dec-2024)</option>
                <option value="MMM DD, YYYY">MMM DD, YYYY (Dec 25, 2024)</option>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Time Format</label>
              <Select {...register('timeFormat')}>
                <option value="24-hour">24-Hour (14:30)</option>
                <option value="12-hour">12-Hour (02:30 PM)</option>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Timezone</label>
              <Input {...register('timezone')} placeholder="e.g., UTC, Asia/Kolkata, America/New_York" />
            </div>

            <p className="text-xs text-muted-foreground">
              Note: Format applies to ALL users and ALL pages in the application.
            </p>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/config')}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save Changes'}</Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
