import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';
import { useBranding } from '../../hooks/use-branding';

export function MobileLoginPage() {
  const navigate = useNavigate();
  const { branding } = useBranding();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showForce, setShowForce] = useState(false);

  const handleLogin = async (force?: boolean) => {
    if (!username.trim() || !password.trim()) return;
    setLoading(true); setError('');
    try {
      const res = await apiClient.post<any>('/api/auth/login', {
        username: username.trim(),
        password,
        ...(force && { force: true }),
      });
      sessionStorage.setItem('access_token', res.token);
      localStorage.setItem('access_token_backup', res.token);
      navigate('/m', { replace: true });
    } catch (e: any) {
      if (e?.code === 'SESSION_CONFLICT' || e?.error === 'SESSION_CONFLICT' || e?.message?.includes('session')) {
        if (!force) {
          // Auto-retry with force on mobile — operators need quick access
          try {
            const res = await apiClient.post<any>('/api/auth/login', {
              username: username.trim(),
              password,
              force: true,
            });
            sessionStorage.setItem('access_token', res.token);
            localStorage.setItem('access_token_backup', res.token);
            navigate('/m', { replace: true });
          } catch (e2: any) {
            // Auto-retry failed — show manual force button as fallback
            setShowForce(true);
            setError('Session conflict. Tap "Force Login" to proceed.');
          }
        } else {
          setError(e?.message ?? 'Force login failed');
        }
      } else {
        setError(e?.message ?? 'Login failed');
      }
    }
    setLoading(false);
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        background: `linear-gradient(to bottom right, ${branding.loginBgStart}, ${branding.loginBgEnd}, ${branding.loginBgStart})`
      }}
    >
      <div className="bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Decorative gradient header */}
        <div
          className="h-2"
          style={{
            background: `linear-gradient(to right, ${branding.gradientStart}, ${branding.gradientMiddle}, ${branding.gradientEnd})`
          }}
        />

        <div className="p-8 space-y-6">
          <div className="text-center">
            {branding.logoUrl ? (
              <div className="inline-flex items-center justify-center w-40 h-28 mb-4">
                <img
                  src={branding.logoUrl}
                  alt={branding.appName}
                  className="max-w-full max-h-full object-contain"
                />
              </div>
            ) : (
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-white text-2xl font-bold mx-auto mb-4 shadow-xl"
                style={{
                  background: `linear-gradient(to bottom right, ${branding.primaryColor}, ${branding.secondaryColor})`,
                  boxShadow: `0 10px 40px -10px ${branding.secondaryColor}50`
                }}
              >
                {branding.logoText}
              </div>
            )}
            <h1
              className="text-2xl font-bold mb-1"
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

          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">User ID</label>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value); setError(''); setShowForce(false); }}
                placeholder="Enter your user ID"
                className="w-full bg-slate-50/50 border-2 border-slate-200 rounded-xl px-4 py-4 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 transition-all"
                autoFocus
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-slate-700">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => { setPassword(e.target.value); setError(''); setShowForce(false); }}
                onKeyDown={e => { if (e.key === 'Enter') handleLogin(); }}
                placeholder="Enter your password"
                className="w-full bg-slate-50/50 border-2 border-slate-200 rounded-xl px-4 py-4 text-base text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 transition-all"
                autoComplete="current-password"
              />
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-red-50 to-red-100 border border-red-200 p-4">
              <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <p className="text-sm text-red-700 font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={() => handleLogin()}
              disabled={loading || !username.trim() || !password.trim()}
              className="w-full py-4 text-white rounded-xl font-bold text-base disabled:opacity-40 active:opacity-90 transition-all"
              style={{
                background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})`,
                boxShadow: `0 10px 40px -10px ${branding.secondaryColor}50`,
              }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>

            {showForce && (
              <button onClick={() => handleLogin(true)} disabled={loading}
                className="w-full py-3 bg-amber-50 text-amber-700 border border-amber-200 rounded-xl font-medium text-sm">
                Force Login (Disconnect Other Session)
              </button>
            )}
          </div>

          {/* Company info */}
          <div className="pt-4 border-t border-slate-200 text-center">
            <p className="text-base font-bold text-slate-700">{branding.companyName}</p>
            <p className="text-sm text-slate-500 mt-1 font-semibold">Version {branding.version}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
