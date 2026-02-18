import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@digilog/shared';
import { useAuth } from '@/hooks/use-auth';
import { useBranding } from '@/hooks/use-branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { checkExistingUserSession, type ActiveSessionInfo } from '@/hooks/use-single-tab';

export function LoginPage() {
  const { login } = useAuth();
  const { branding } = useBranding();
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Check if another user is logged in on this system
  const [systemSession, setSystemSession] = useState<ActiveSessionInfo | null>(null);
  const [showSystemSessionDialog, setShowSystemSessionDialog] = useState(false);

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

  const onSubmit = async (data: LoginInput) => {
    setError('');

    // Re-check for existing system session before login
    const existingSystemSession = checkExistingUserSession();
    if (existingSystemSession) {
      setSystemSession(existingSystemSession);
      setShowSystemSessionDialog(true);
      return;
    }

    try {
      await login(data.username, data.password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div
      className="flex min-h-screen items-center justify-center p-8"
      style={{
        background: `linear-gradient(to bottom right, ${branding.loginBgStart}, ${branding.loginBgEnd}, ${branding.loginBgStart})`
      }}
    >
      <div className="w-full max-w-md">
        {/* Login Card */}
        <div className="relative bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden">
          {/* Decorative gradient header */}
          <div
            className="h-2"
            style={{
              background: `linear-gradient(to right, ${branding.gradientStart}, ${branding.gradientMiddle}, ${branding.gradientEnd})`
            }}
          />

          <div className="p-8 pt-6">
            {/* Branding */}
            <div className="text-center mb-8">
              {branding.logoUrl ? (
                <div className="inline-flex items-center justify-center w-52 h-40 mb-4">
                  <img
                    src={branding.logoUrl}
                    alt={branding.appName}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : (
                <div
                  className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-4 shadow-xl"
                  style={{
                    background: `linear-gradient(to bottom right, ${branding.primaryColor}, ${branding.secondaryColor})`,
                    boxShadow: `0 10px 40px -10px ${branding.secondaryColor}50`
                  }}
                >
                  <span className="text-3xl font-bold text-white tracking-tight">{branding.logoText}</span>
                </div>
              )}
              <h1
                className="text-3xl font-bold mb-2"
                style={{
                  background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})`,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                }}
              >
                {branding.appName}
              </h1>
              <p className="text-sm text-slate-500 font-medium">{branding.appTagline}</p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              {error && (
                <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-red-50 to-red-100 border border-red-200 p-4">
                  <div className="w-10 h-10 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <p className="text-sm text-red-700 font-medium">{error}</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">User ID</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                  <Input
                    {...register('username')}
                    placeholder="Enter your user ID"
                    autoFocus
                    autoComplete="username"
                    className="h-12 pl-12 pr-4 text-base rounded-xl border-2 border-slate-200 bg-slate-50/50 transition-all"
                  />
                </div>
                {errors.username && (
                  <p className="text-sm text-red-500 flex items-center gap-1.5 mt-1 font-medium">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {errors.username.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-semibold text-slate-700">Password</label>
                <div className="relative">
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <Input
                    {...register('password')}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Enter your password"
                    secureField
                    autoComplete="current-password"
                    className="h-12 pl-12 pr-16 text-base rounded-xl border-2 border-slate-200 bg-slate-50/50 transition-all"
                  />
                  <button
                    type="button"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-semibold transition-colors"
                    style={{ color: showPassword ? branding.secondaryColor : undefined }}
                    onMouseOver={(e) => e.currentTarget.style.color = branding.secondaryColor}
                    onMouseOut={(e) => e.currentTarget.style.color = showPassword ? branding.secondaryColor : '#94a3b8'}
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-red-500 flex items-center gap-1.5 mt-1 font-medium">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {errors.password.message}
                  </p>
                )}
                <div className="flex justify-end pt-1">
                  <a
                    href="/forgot-password"
                    className="text-sm font-semibold transition-colors"
                    style={{ color: branding.secondaryColor }}
                    onMouseOver={(e) => e.currentTarget.style.color = branding.primaryColor}
                    onMouseOut={(e) => e.currentTarget.style.color = branding.secondaryColor}
                  >
                    Forgot password?
                  </a>
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold rounded-xl transition-all hover:-translate-y-0.5"
                style={{
                  background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})`,
                  boxShadow: `0 10px 40px -10px ${branding.secondaryColor}50`,
                }}
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Signing in...
                  </span>
                ) : 'Sign In'}
              </Button>
            </form>

            {/* Company info */}
            <div className="mt-8 pt-6 border-t border-slate-200 text-center">
              <p className="text-base font-bold text-slate-700">{branding.companyName}</p>
              <p className="text-sm text-slate-500 mt-1 font-semibold">Version {branding.version}</p>
            </div>
          </div>
        </div>
      </div>

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
              <p className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Current Session</p>
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center">
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
    </div>
  );
}
