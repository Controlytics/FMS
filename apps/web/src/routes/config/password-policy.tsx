import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { passwordPolicySchema, type PasswordPolicyConfig } from '@digilog/shared';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { ReauthDialog } from '@/components/ui/reauth-dialog';
import { useReauth } from '@/hooks/use-reauth';

export function PasswordPolicyPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { data } = useSWR('/api/config/password-policy');
  const { isOpen, operation, executeWithReauth, onReauthSuccess, onReauthClose } = useReauth();

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<PasswordPolicyConfig>({
    resolver: zodResolver(passwordPolicySchema),
    values: data ?? undefined,
  });

  const onSubmit = async (formData: PasswordPolicyConfig) => {
    setError('');
    setSuccess('');
    try {
      await executeWithReauth('Update Password Policy', async (token) => {
        const headers = token ? { 'X-Verification-Token': token } : undefined;
        await apiClient.put('/api/config/password-policy', formData, headers);
        setSuccess('Password policy updated successfully');
      });
    } catch (err: any) {
      setError(err.message || 'Failed to update');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <ReauthDialog open={isOpen} onClose={onReauthClose} onSuccess={onReauthSuccess} operation={operation} />
      <Card>
        <CardHeader>
          <CardTitle>Password Policy Configuration</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Minimum Length (8-32)</label>
                <Input {...register('minLength', { valueAsNumber: true })} type="number" min={8} max={32} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Maximum Length (32-128)</label>
                <Input {...register('maxLength', { valueAsNumber: true })} type="number" min={32} max={128} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Min Uppercase</label>
                <Input {...register('minUppercase', { valueAsNumber: true })} type="number" min={0} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Min Lowercase</label>
                <Input {...register('minLowercase', { valueAsNumber: true })} type="number" min={0} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Min Numbers</label>
                <Input {...register('minNumbers', { valueAsNumber: true })} type="number" min={0} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Min Special Characters</label>
                <Input {...register('minSpecialChars', { valueAsNumber: true })} type="number" min={0} />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Password History Count (1-24)</label>
              <Input {...register('preventReuseCount', { valueAsNumber: true })} type="number" min={1} max={24} />
              <p className="text-xs text-muted-foreground">Last N passwords cannot be reused</p>
            </div>

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('cannotBeUserId')} className="rounded" />
                Password cannot be same as User ID
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" {...register('cannotContainUserId')} className="rounded" />
                Password cannot contain User ID
              </label>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/config')}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
