import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSecuritySchema, type LoginSecurityConfig } from '@digilog/shared';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

export function LoginSecurityPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const reauth = useReauth();
  const { data } = useSWR('/api/config/login-security');

  const { register, handleSubmit, watch, formState: { isSubmitting } } = useForm<LoginSecurityConfig>({
    resolver: zodResolver(loginSecuritySchema),
    values: data ?? undefined,
  });

  const lockoutType = watch('lockoutType');

  const onSubmit = async (formData: LoginSecurityConfig) => {
    setError(''); setSuccess('');
    await reauth.execute('UPDATE_LOGIN_SECURITY', async (password?) => {
      if (password) await apiClient.put('/api/config/login-security', { ...formData, _currentPassword: password });
      else await apiClient.put('/api/config/login-security', formData);
      setSuccess('Login security updated successfully');
    }, {
      onError: (err: any) => setError(err.message || 'Failed to update'),
    });
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader><CardTitle>Login Security Configuration</CardTitle></CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

            <div className="space-y-2">
              <label className="text-sm font-medium">Max Failed Attempts (3-10)</label>
              <Input {...register('maxFailedAttempts', { valueAsNumber: true })} type="number" min={3} max={10} />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Lockout Type</label>
              <Select {...register('lockoutType')}>
                <option value="TEMPORARY">Temporary</option>
                <option value="PERMANENT">Permanent</option>
              </Select>
            </div>

            {lockoutType === 'TEMPORARY' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Lockout Duration (minutes, 15-1440)</label>
                <Input {...register('lockoutDurationMinutes', { valueAsNumber: true })} type="number" min={15} max={1440} />
              </div>
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
        actionLabel="Update Login Security"
      />
    </div>
  );
}
