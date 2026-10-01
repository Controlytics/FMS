import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthShell, AuthError, AuthSuccess } from '@/components/auth-shell';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim()) {
      setError('Please enter your User ID');
      return;
    }

    setError('');
    setIsSubmitting(true);

    try {
      await apiClient.post('/api/auth/forgot-password', { username: username.trim() });
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message || 'Failed to submit request. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Forgot password"
      description={submitted ? undefined : 'Enter your user ID. Your administrator will issue a temporary password.'}
      backToLogin
    >
      {submitted ? (
        <div className="space-y-5">
          <AuthSuccess title="Request sent">
            If that user ID exists, your administrator has been notified. Contact them to receive your temporary password.
          </AuthSuccess>
          <Button type="button" className="h-11 w-full" onClick={() => navigate('/login')}>
            Back to sign in
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <AuthError>{error}</AuthError>}

          <div>
            <label htmlFor="forgot-username" className="mb-1.5 block text-sm font-medium text-slate-700">User ID</label>
            <Input
              id="forgot-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your user ID"
              autoFocus
              className="h-11"
            />
          </div>

          <ol className="list-decimal space-y-1 rounded-lg border border-slate-200 bg-slate-50 py-3 pl-8 pr-4 text-sm text-slate-600">
            <li>Send your user ID.</li>
            <li>Your administrator is notified.</li>
            <li>They give you a temporary password.</li>
            <li>Sign in and set a new password.</li>
          </ol>

          <Button type="submit" className="h-11 w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Sending…' : 'Send request'}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
