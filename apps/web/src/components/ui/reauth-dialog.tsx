import { useState } from 'react';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from './dialog';
import { Input } from './input';
import { Button } from './button';
import { apiClient } from '@/lib/api-client';

interface ReauthDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (token: string) => void;
  operation?: string;
}

export function ReauthDialog({ open, onClose, onSuccess, operation }: ReauthDialogProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await apiClient.post<{ verificationToken: string }>('/api/auth/verify', { password });
      setPassword('');
      onSuccess(res.verificationToken);
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPassword('');
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose}>
      <DialogHeader>
        <DialogTitle>Re-authentication Required</DialogTitle>
      </DialogHeader>
      <form onSubmit={handleSubmit}>
        <p className="text-sm text-muted-foreground mb-4">
          Please enter your password to confirm this action{operation ? `: ${operation}` : ''}.
        </p>
        {error && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive mb-4">{error}</div>
        )}
        <div className="space-y-2 mb-4">
          <label className="text-sm font-medium">Password</label>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            secureField
            autoFocus
            required
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
          <Button type="submit" disabled={loading || !password}>
            {loading ? 'Verifying...' : 'Confirm'}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
