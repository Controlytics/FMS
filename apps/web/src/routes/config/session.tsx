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
import { ReauthDialog } from '@/components/ui/reauth-dialog';
import { useReauth } from '@/hooks/use-reauth';

export function SessionConfigPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { data } = useSWR('/api/config/session');

  const { isOpen, operation, executeWithReauth, onReauthSuccess, onReauthClose } = useReauth();

  const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm<SessionConfig>({
    resolver: zodResolver(sessionConfigSchema),
    values: data ?? undefined,
  });

  const autoLogout = watch('autoLogoutEnabled');

  const onSubmit = async (formData: SessionConfig) => {
    setError(''); setSuccess('');
    try {
      await executeWithReauth('Update Session Config', async (token) => {
        const headers = token ? { 'X-Verification-Token': token } : undefined;
        await apiClient.put('/api/config/session', formData, headers);
        setSuccess('Session configuration updated successfully');
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <ReauthDialog open={isOpen} onClose={onReauthClose} onSuccess={onReauthSuccess} operation={operation} />
      <Card>
        <CardHeader><CardTitle>Session / Auto-Logout Configuration</CardTitle></CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

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
    </div>
  );
}
