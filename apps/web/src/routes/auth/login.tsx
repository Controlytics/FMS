import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useSearchParams } from 'react-router-dom';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@digilog/shared';
import { useAuth } from '@/hooks/use-auth';
import { AuthShell, AuthError } from '@/components/auth-shell';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { checkExistingUserSession, type ActiveSessionInfo } from '@/hooks/use-single-tab';

export function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const [searchParams] = useSearchParams();

  // All hooks must be called unconditionally before any early return
  const { formatDateTime } = useDatetimeFormat();
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Check if another user is logged in on this system
  const [systemSession, setSystemSession] = useState<ActiveSessionInfo | null>(null);
  const [showSystemSessionDialog, setShowSystemSessionDialog] = useState(false);

  // Session conflict state (server-side active session detected)
  const [sessionConflict, setSessionConflict] = useState<{
    type: 'same_user' | 'different_user';
    loginTime: string;
    lastActiveAt?: string;
    username?: string;
    fullName?: string;
  } | null>(null);
  const [showSessionConflictDialog, setShowSessionConflictDialog] = useState(false);
  const [pendingCredentials, setPendingCredentials] = useState<{ username: string; password: string } | null>(null);
  const [forceLoginLoading, setForceLoginLoading] = useState(false);

  // Check for existing system session on mount
  useEffect(() => {
    const existingSystemSession = checkExistingUserSession();
    if (existingSystemSession) {
      setSystemSession(existingSystemSession);
      setShowSystemSessionDialog(true);
    }
  }, []);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
  });

  // If already authenticated, redirect to home — prevents back-button to login.
  // This must appear AFTER all hook calls to satisfy React Rules of Hooks.
  if (!isLoading && isAuthenticated) {
    // Validate returnUrl is an internal pathname only (prevent open redirect).
    // Mirrors the guard in hooks/use-auth.ts:137 — reject protocol-relative
    // (//evil.com) and absolute (https://evil.com) targets.
    const raw = searchParams.get("returnUrl");
    const isSafeReturnUrl = raw && raw.startsWith('/') && !raw.startsWith('//') && !raw.includes(':');
    return <Navigate to={isSafeReturnUrl ? raw : "/"} replace />;
  }

  const onSubmit = async (data: LoginInput) => {
    setError('');

    try {
      await login(data.username, data.password);
    } catch (err: any) {
      if (err.code === 'SESSION_CONFLICT' && err.activeSession) {
        setPendingCredentials({ username: data.username, password: data.password });
        setSessionConflict({ type: 'same_user', ...err.activeSession });
        setShowSessionConflictDialog(true);
        return;
      }
      if (err.code === 'DIFFERENT_USER_SESSION_CONFLICT' && err.activeSession) {
        setPendingCredentials({ username: data.username, password: data.password });
        setSessionConflict({ type: 'different_user', ...err.activeSession });
        setShowSessionConflictDialog(true);
        return;
      }
      setError(err.message || 'Login failed');
    }
  };

  const handleForceLogin = async () => {
    if (!pendingCredentials) return;
    setForceLoginLoading(true);
    setError('');
    try {
      await login(pendingCredentials.username, pendingCredentials.password, true);
      setShowSessionConflictDialog(false);
      setPendingCredentials(null);
      setSessionConflict(null);
    } catch (err: any) {
      setShowSessionConflictDialog(false);
      setPendingCredentials(null);
      setSessionConflict(null);
      setError(err.message || 'Login failed');
    } finally {
      setForceLoginLoading(false);
    }
  };

  const handleCancelConflict = () => {
    setShowSessionConflictDialog(false);
    setPendingCredentials(null);
    setSessionConflict(null);
  };

  return (
    <>
      <AuthShell title="Sign in" description="Use your user ID and password.">
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {error && <AuthError>{error}</AuthError>}

            <div>
              <label htmlFor="login-username" className="mb-1.5 block text-sm font-medium text-slate-700">User ID</label>
              <Input
                id="login-username"
                {...register('username')}
                placeholder="Enter your user ID"
                autoFocus
                autoComplete="username"
                className="h-11"
              />
              {errors.username && (
                <p className="mt-1.5 text-sm text-red-600">{errors.username.message}</p>
              )}
            </div>

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-700">Password</label>
                <a href="/forgot-password" className="text-sm font-medium text-brand-700 hover:underline">
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Input
                  id="login-password"
                  {...register('password')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Enter your password"
                  secureField
                  autoComplete="current-password"
                  className="h-11 pr-16"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500 hover:text-slate-800"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1.5 text-sm text-red-600">{errors.password.message}</p>
              )}
            </div>

            <Button type="submit" className="h-11 w-full text-[15px]" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in…
                </span>
              ) : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 border-t border-slate-200 pt-5 space-y-2">
            <a href="/guest-request"
              className="flex h-10 w-full items-center justify-center rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:border-slate-400">
              Guest filter cleaning request
            </a>
            <p className="pt-1 text-center text-sm text-slate-500">
              Need an account or locked out?{' '}
              <a href="/contact-admin" className="font-medium text-brand-700 hover:underline">Contact admin</a>
            </p>
          </div>

      </AuthShell>

      {/* System Session Warning Dialog - Another user is logged in on this system */}
      <Dialog open={showSystemSessionDialog} onClose={() => setShowSystemSessionDialog(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            Another User is Logged In
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Another user is currently logged in on this browser/system. For security reasons, only one user can be logged in at a time.
          </p>

          {systemSession && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <p className="text-xs text-slate-500 font-semibold">Current Session</p>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
                  <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{systemSession.username}</p>
                  <p className="text-sm text-slate-500">Active in another tab/window</p>
                </div>
              </div>
            </div>
          )}

          <p className="text-sm text-slate-500">
            Please ask the current user to logout first, or close all browser tabs and try again.
          </p>
        </div>

        <DialogFooter>
          <Button
            onClick={() => setShowSystemSessionDialog(false)}
            variant="outline"
            className="w-full"
          >
            Close
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Session Conflict Dialog - Same user or different user conflict (server-side) */}
      <Dialog open={showSessionConflictDialog} onClose={handleCancelConflict} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
              sessionConflict?.type === 'different_user' ? 'bg-red-100' : 'bg-amber-100'
            }`}>
              <svg className={`w-5 h-5 ${
                sessionConflict?.type === 'different_user' ? 'text-red-600' : 'text-amber-600'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            {sessionConflict?.type === 'different_user' ? 'Another User is Logged In' : 'Active Session Detected'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {sessionConflict?.type === 'different_user'
              ? 'Another user is currently logged in from this system. For security reasons, only one user can be active per system. Continuing will terminate their session.'
              : 'Your account is currently logged in from another location. Continuing will terminate the existing session.'}
          </p>

          {sessionConflict && (
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <p className="text-xs text-slate-500 font-semibold">Existing Session</p>
              <div className="space-y-2">
                {sessionConflict.type === 'different_user' && sessionConflict.username && (
                  <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-sm text-slate-700">
                      <span className="font-medium">User:</span> {sessionConflict.fullName || sessionConflict.username} ({sessionConflict.username})
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm text-slate-700">
                    <span className="font-medium">Logged in:</span> {formatDateTime(sessionConflict.loginTime)}
                  </span>
                </div>
              </div>
            </div>
          )}

          <p className="text-sm text-slate-500">
            {sessionConflict?.type === 'different_user'
              ? 'Do you want to continue and logout the other user\'s session?'
              : 'Do you want to continue and logout the other session?'}
          </p>
        </div>

        <DialogFooter>
          <Button
            onClick={handleCancelConflict}
            variant="outline"
            disabled={forceLoginLoading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleForceLogin}
            disabled={forceLoginLoading}
            variant={sessionConflict?.type === 'different_user' ? 'destructive' : 'default'}
          >
            {forceLoginLoading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Continuing...
              </span>
            ) : sessionConflict?.type === 'different_user'
              ? `Continue & Logout ${sessionConflict?.username ?? 'User'}`
              : 'Continue & Logout Old Session'}
          </Button>
        </DialogFooter>
      </Dialog>
    </>
  );
}
