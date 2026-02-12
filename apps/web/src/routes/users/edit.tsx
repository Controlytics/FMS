import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { updateUserSchema, type UpdateUserInput, CREATABLE_ROLES, type Role } from '@digilog/shared';
import { useAuth } from '@/hooks/use-auth';
import { apiClient } from '@/lib/api-client';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';

export function EditUserPage() {
  const { id } = useParams();
  const { user: currentUser } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [resetDialog, setResetDialog] = useState(false);
  const [resetPassword, setResetPassword] = useState('');
  const creatableRoles = CREATABLE_ROLES[currentUser?.role as string] ?? [];

  const { data: userData, mutate } = useSWR(id ? `/api/users/${id}` : null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<UpdateUserInput>({
    resolver: zodResolver(updateUserSchema),
    values: userData ? {
      fullName: userData.fullName,
      email: userData.email,
      department: userData.department ?? '',
      role: userData.role,
      status: userData.status,
    } : undefined,
  });

  const onSubmit = async (data: UpdateUserInput) => {
    setError('');
    try {
      await apiClient.put(`/api/users/${id}`, data);
      navigate('/users');
    } catch (err: any) {
      setError(err.message || 'Failed to update user');
    }
  };

  const handleResetPassword = async () => {
    try {
      await apiClient.post(`/api/users/${id}/reset-password`, { newPassword: resetPassword });
      setResetDialog(false);
      setResetPassword('');
      mutate();
    } catch (err: any) {
      setError(err.message || 'Failed to reset password');
    }
  };

  if (!userData) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Edit User: {userData.username}</CardTitle>
            <Badge variant="outline">{userData.status}</Badge>
          </div>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">User ID (read-only)</label>
              <Input value={userData.username} disabled />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Full Name</label>
                <Input {...register('fullName')} />
                {errors.fullName && <p className="text-sm text-destructive">{errors.fullName.message}</p>}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Email</label>
                <Input {...register('email')} type="email" />
                {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Department</label>
                <Input {...register('department')} />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Role</label>
                <Select {...register('role')}>
                  {creatableRoles.map((r: Role) => (
                    <option key={r} value={r}>{r.replace('_', ' ')}</option>
                  ))}
                </Select>
              </div>
            </div>

            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground space-y-1">
              <div>Created: {new Date(userData.createdAt).toLocaleString()} by {userData.createdBy ?? 'system'}</div>
              <div>Last Login: {userData.lastLogin ? new Date(userData.lastLogin).toLocaleString() : 'Never'}</div>
              <div>Password Changed: {userData.passwordChangedAt ? new Date(userData.passwordChangedAt).toLocaleString() : 'Never'}</div>
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/users')}>Cancel</Button>
            <Button type="button" variant="secondary" onClick={() => setResetDialog(true)}>Reset Password</Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardFooter>
        </form>
      </Card>

      {/* Reset Password Dialog */}
      <Dialog open={resetDialog} onClose={() => setResetDialog(false)}>
        <DialogHeader>
          <DialogTitle>Reset Password for {userData.username}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Set a temporary password. The user must change it on next login.
          </p>
          <Input
            type="password"
            placeholder="New temporary password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            secureField
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setResetDialog(false)}>Cancel</Button>
          <Button onClick={handleResetPassword} disabled={resetPassword.length < 8}>Reset</Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
