import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { sessionConfigSchema, type SessionConfig } from '@digilog/shared';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

export function SessionConfigPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const reauth = useReauth();
  const { data } = useSWR('/api/config/session');

  const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm<SessionConfig>({
    resolver: zodResolver(sessionConfigSchema),
    values: data ?? undefined,
  });

  const autoLogout = watch('autoLogoutEnabled');

  const onSubmit = async (formData: SessionConfig) => {
    setError(''); setSuccess('');
    await reauth.execute('UPDATE_SESSION_CONFIG', async (password?) => {
      if (password) await apiClient.put('/api/config/session', { ...formData, _currentPassword: password });
      else await apiClient.put('/api/config/session', formData);
      setSuccess('Session configuration updated successfully');
    }, {
      onError: (err: any) => setError(err.message || 'Failed to update'),
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader><CardTitle>Session / Auto-Logout Configuration</CardTitle></CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

            <div className="space-y-2">
              <label className="text-sm font-medium">Session Duration (hours, 1-24)</label>
              <Input {...register('sessionDurationHours', { valueAsNumber: true })} type="number" min={1} max={24} />
              <p className="text-xs text-slate-500">How long a login session remains valid before requiring re-login.</p>
            </div>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" {...register('autoLogoutEnabled')} className="rounded" />
              Enable Auto-Logout on Idle
            </label>

            {autoLogout && (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Idle Timeout (minutes, 5-60)</label>
                  <Input {...register('idleTimeoutMinutes', { valueAsNumber: true })} type="number" min={5} max={60} />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Warning Before Logout (minutes, 1-5)</label>
                  <Input {...register('warningMinutes', { valueAsNumber: true })} type="number" min={1} max={5} />
                </div>
              </>
            )}
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/config')}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Saving...' : 'Save Changes'}</Button>
          </CardFooter>
        </form>
      </Card>

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Update Session Config"
      />
    </div>
  );
}
