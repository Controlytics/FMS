import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, type CreateUserInput, CREATABLE_ROLES, type Role } from '@digilog/shared';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

export function CreateUserPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const creatableRoles = CREATABLE_ROLES[user?.role as string] ?? [];

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { status: 'ENABLED' },
  });

  const onSubmit = async (data: CreateUserInput) => {
    setError('');
    try {
      await apiClient.post('/api/users', data);
      navigate('/users');
    } catch (err: any) {
      setError(err.message || 'Failed to create user');
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Create New User</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">User ID *</label>
                <Input {...register('username')} placeholder="6-50 characters" />
                {errors.username && <p className="text-sm text-destructive">{errors.username.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name *</label>
                <Input {...register('fullName')} />
                {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Email *</label>
                <Input {...register('email')} type="email" />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Department</label>
                <Input {...register('department')} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Role *</label>
                <Select {...register('role')}>
                  <option value="">Select role</option>
                  {creatableRoles.map((r: Role) => (
                    <option key={r} value={r}>{r.replace('_', ' ')}</option>
                  ))}
                </Select>
                {errors.role && <p className="text-sm text-destructive">{errors.role.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Status</label>
                <Select {...register('status')}>
                  <option value="ENABLED">Enabled</option>
                  <option value="DISABLED">Disabled</option>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Temporary Password *</label>
                <div className="relative">
                  <Input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    secureField
                  />
                  <button type="button" className="absolute right-3 top-2.5 text-sm text-muted-foreground"
                    onClick={() => setShowPassword(!showPassword)} tabIndex={-1}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {errors.password && <p className="text-sm text-destructive">{errors.password.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Confirm Password *</label>
                <Input
                  {...register('confirmPassword')}
                  type={showPassword ? 'text' : 'password'}
                  secureField
                />
                {errors.confirmPassword && <p className="text-sm text-destructive">{errors.confirmPassword.message}</p>}
              </div>
            </div>

            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              <strong>Note:</strong> This is a temporary password. The user will be required to change it on first login.
              Force password change is mandatory and cannot be unchecked.
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/users')}>Cancel</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating...' : 'Create User'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
