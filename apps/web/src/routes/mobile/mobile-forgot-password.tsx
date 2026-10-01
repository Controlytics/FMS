import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { AuthShell, AuthError, AuthSuccess } from '../../components/auth-shell';

/**
 * Tablet forgot-password screen. Mirrors the desktop /forgot-password flow:
 * operator submits their User ID, server logs the request and notifies admins,
 * admin issues a temporary password out-of-band. Backend always returns 200
 * to prevent username enumeration.
 */
export function MobileForgotPasswordPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!username.trim()) {
      setError('Please enter your User ID');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await apiClient.post('/api/auth/forgot-password', { username: username.trim() });
      setSubmitted(true);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to submit request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Forgot password"
      description={submitted ? undefined : 'Enter your user ID. Your administrator will issue a temporary password.'}
      backToLogin="/m/login"
    >
      {submitted ? (
        <div className="space-y-5">
          <AuthSuccess title="Request sent">
            If that user ID exists, your administrator has been notified. Contact them to receive your temporary password.
          </AuthSuccess>
          <button
            onClick={() => navigate('/m/login', { replace: true })}
            className="h-14 w-full rounded-lg bg-brand-600 text-base font-semibold text-white active:bg-brand-700"
          >
            Back to sign in
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <AuthError>{error}</AuthError>}
          <div>
            <label htmlFor="m-forgot-username" className="mb-1.5 block text-sm font-medium text-slate-700">User ID</label>
            <input
              id="m-forgot-username"
              type="text"
              value={username}
              onChange={e => { setUsername(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') handleSubmit(); }}
              placeholder="Enter your user ID"
              className="h-14 w-full rounded-lg border border-slate-300 bg-white px-4 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15"
              autoFocus
              autoComplete="username"
            />
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting || !username.trim()}
            className="h-14 w-full rounded-lg bg-brand-600 text-base font-semibold text-white active:bg-brand-700 disabled:opacity-40"
          >
            {submitting ? 'Sending…' : 'Send request'}
          </button>
        </div>
      )}
    </AuthShell>
  );
}
