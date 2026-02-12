import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { passwordChangeSchema, type PasswordChangeInput } from '@digilog/shared';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';

export function ChangePasswordPage() {
  const { user, mutate } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [showPasswords, setShowPasswords] = useState({ current: false, new: false, confirm: false });
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<PasswordChangeInput>({
    resolver: zodResolver(passwordChangeSchema),
  });

  const newPassword = watch('newPassword', '');

  // Password strength indicators
  const hasUpper = /[A-Z]/.test(newPassword);
  const hasLower = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const hasLength = newPassword.length >= 8;

  const onSubmit = async (data: PasswordChangeInput) => {
    setError('');
    try {
      await apiClient.post('/api/auth/change-password', data);
      await mutate();
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Failed to change password');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Change Password</CardTitle>
          <CardDescription>
            {user?.isTemporaryPassword
              ? 'You are using a temporary password. You must change it before continuing.'
              : 'Update your password to continue.'}
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium">Current Password</label>
              <div className="relative">
                <Input
                  {...register('currentPassword')}
                  type={showPasswords.current ? 'text' : 'password'}
                  secureField
                />
                <button type="button" className="absolute right-3 top-2.5 text-sm text-muted-foreground"
                  onClick={() => setShowPasswords(p => ({ ...p, current: !p.current }))} tabIndex={-1}>
                  {showPasswords.current ? 'Hide' : 'Show'}
                </button>
              </div>
              {errors.currentPassword && <p className="text-sm text-destructive">{errors.currentPassword.message}</p>}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">New Password</label>
              <div className="relative">
                <Input
                  {...register('newPassword')}
                  type={showPasswords.new ? 'text' : 'password'}
                  secureField
                />
                <button type="button" className="absolute right-3 top-2.5 text-sm text-muted-foreground"
                  onClick={() => setShowPasswords(p => ({ ...p, new: !p.new }))} tabIndex={-1}>
                  {showPasswords.new ? 'Hide' : 'Show'}
                </button>
              </div>
              {errors.newPassword && <p className="text-sm text-destructive">{errors.newPassword.message}</p>}
              {/* Strength indicators */}
              <div className="space-y-1 text-xs">
                <p className={hasLength ? 'text-green-600' : 'text-muted-foreground'}>
                  {hasLength ? '\u2713' : '\u2717'} At least 8 characters
                </p>
                <p className={hasUpper ? 'text-green-600' : 'text-muted-foreground'}>
                  {hasUpper ? '\u2713' : '\u2717'} Uppercase letter
                </p>
                <p className={hasLower ? 'text-green-600' : 'text-muted-foreground'}>
                  {hasLower ? '\u2713' : '\u2717'} Lowercase letter
                </p>
                <p className={hasNumber ? 'text-green-600' : 'text-muted-foreground'}>
                  {hasNumber ? '\u2713' : '\u2717'} Number
                </p>
                <p className={hasSpecial ? 'text-green-600' : 'text-muted-foreground'}>
                  {hasSpecial ? '\u2713' : '\u2717'} Special character
                </p>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Confirm New Password</label>
              <div className="relative">
                <Input
                  {...register('confirmPassword')}
                  type={showPasswords.confirm ? 'text' : 'password'}
                  secureField
                />
                <button type="button" className="absolute right-3 top-2.5 text-sm text-muted-foreground"
                  onClick={() => setShowPasswords(p => ({ ...p, confirm: !p.confirm }))} tabIndex={-1}>
                  {showPasswords.confirm ? 'Hide' : 'Show'}
                </button>
              </div>
              {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? 'Changing...' : 'Change Password'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
