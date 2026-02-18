import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { passwordPolicySchema, type PasswordPolicyConfig } from '@digilog/shared';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

export function PasswordPolicyPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const reauth = useReauth();
  const { data } = useSWR('/api/config/password-policy');

  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<PasswordPolicyConfig>({
    resolver: zodResolver(passwordPolicySchema),
    values: data ?? undefined,
  });

  const autoLogoutEnabled = watch('autoLogoutEnabled');

  const onSubmit = async (formData: PasswordPolicyConfig) => {
    setError('');
    setSuccess('');
    await reauth.execute('UPDATE_PASSWORD_POLICY', async (password?) => {
      if (password) await apiClient.put('/api/config/password-policy', { ...formData, _currentPassword: password });
      else await apiClient.put('/api/config/password-policy', formData);
      setSuccess('Settings updated successfully');
    }, {
      onError: (err: any) => setError(err.message || 'Failed to update'),
    });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/config" className="p-2 rounded-xl hover:bg-slate-100 transition-colors">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">General & Password Settings</h1>
            <p className="text-sm text-slate-500 mt-0.5">Configure security and authentication policies</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Status Messages */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
            <div className="p-2 rounded-lg bg-red-100">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {success && (
          <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 p-4">
            <div className="p-2 rounded-lg bg-emerald-100">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm text-emerald-700">{success}</p>
          </div>
        )}

        {/* General Settings Section */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">General Settings</h2>
                <p className="text-sm text-slate-500">Login security and session timeout</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Max Failed Login Attempts
                </label>
                <Input {...register('maxFailedAttempts', { valueAsNumber: true })} type="number" min={3} max={10} className="h-11" />
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Account locks after this many failed attempts (3-10)
                </p>
              </div>
            </div>

            {/* Auto Logout Section */}
            <div className="p-5 rounded-xl bg-gradient-to-r from-slate-50 to-white border border-slate-200 space-y-4">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input type="checkbox" {...register('autoLogoutEnabled')} className="sr-only peer" />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:ring-4 peer-focus:ring-indigo-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600 transition-colors"></div>
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">Enable Auto-Logout on Idle</span>
                  <p className="text-xs text-slate-500">Automatically log out inactive users</p>
                </div>
              </label>

              {autoLogoutEnabled && (
                <div className="grid grid-cols-2 gap-4 pl-14 animate-fade-in">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-600">Idle Timeout</label>
                    <div className="relative">
                      <Input {...register('idleTimeoutMinutes', { valueAsNumber: true })} type="number" min={5} max={60} className="h-11 pr-16" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">minutes</span>
                    </div>
                    <p className="text-xs text-slate-400">5-60 minutes</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-600">Warning Before Logout</label>
                    <div className="relative">
                      <Input {...register('warningMinutes', { valueAsNumber: true })} type="number" min={1} max={5} className="h-11 pr-16" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">minutes</span>
                    </div>
                    <p className="text-xs text-slate-400">1-5 minutes</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Password Settings Section */}
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Password Requirements</h2>
                <p className="text-sm text-slate-500">Configure password complexity and history rules</p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-6">
            {/* Length Settings */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16m-7 6h7" />
                  </svg>
                </div>
                Password Length
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-600">Minimum Length</label>
                  <div className="relative">
                    <Input {...register('minLength', { valueAsNumber: true })} type="number" min={8} max={32} className="h-11 pr-20" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">characters</span>
                  </div>
                  <p className="text-xs text-slate-400">8-32 characters</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-slate-600">Maximum Length</label>
                  <div className="relative">
                    <Input {...register('maxLength', { valueAsNumber: true })} type="number" min={32} max={128} className="h-11 pr-20" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">characters</span>
                  </div>
                  <p className="text-xs text-slate-400">32-128 characters</p>
                </div>
              </div>
            </div>

            {/* Character Requirements */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-purple-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                Character Requirements
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-blue-800">Uppercase</span>
                    <span className="text-lg font-bold text-blue-600">A-Z</span>
                  </div>
                  <label className="text-xs text-blue-600">Minimum required</label>
                  <Input {...register('minUppercase', { valueAsNumber: true })} type="number" min={0} className="h-10 bg-white/70" />
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-emerald-800">Lowercase</span>
                    <span className="text-lg font-bold text-emerald-600">a-z</span>
                  </div>
                  <label className="text-xs text-emerald-600">Minimum required</label>
                  <Input {...register('minLowercase', { valueAsNumber: true })} type="number" min={0} className="h-10 bg-white/70" />
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-amber-800">Numbers</span>
                    <span className="text-lg font-bold text-amber-600">0-9</span>
                  </div>
                  <label className="text-xs text-amber-600">Minimum required</label>
                  <Input {...register('minNumbers', { valueAsNumber: true })} type="number" min={0} className="h-10 bg-white/70" />
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-rose-50 to-pink-50 border border-rose-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-rose-800">Special</span>
                    <span className="text-lg font-bold text-rose-600">!@#</span>
                  </div>
                  <label className="text-xs text-rose-600">Minimum required</label>
                  <Input {...register('minSpecialChars', { valueAsNumber: true })} type="number" min={0} className="h-10 bg-white/70" />
                </div>
              </div>
            </div>

            {/* Password History */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-cyan-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                Password History
              </h3>
              <div className="max-w-md space-y-2">
                <label className="text-sm font-medium text-slate-600">Prevent Password Reuse</label>
                <div className="relative">
                  <Input {...register('preventReuseCount', { valueAsNumber: true })} type="number" min={1} max={24} className="h-11 pr-28" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">past passwords</span>
                </div>
                <p className="text-xs text-slate-500">Users cannot reuse any of their last N passwords (1-24)</p>
              </div>
            </div>

            {/* Password Expiry */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-orange-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                Password Expiry
              </h3>
              <div className="max-w-md space-y-2">
                <label className="text-sm font-medium text-slate-600">Password Expiry Period</label>
                <div className="relative">
                  <Input {...register('passwordExpiryDays', { valueAsNumber: true })} type="number" min={0} max={365} className="h-11 pr-16" />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">days</span>
                </div>
                <p className="text-xs text-slate-500">Users must change their password after this many days. Set to 0 to disable password expiry. (0–365, default: 90)</p>
              </div>
            </div>

            {/* Security Options */}
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-4 flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-red-100 flex items-center justify-center">
                  <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                </div>
                Security Options
              </h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer">
                  <input type="checkbox" {...register('cannotBeUserId')} className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <div>
                    <span className="text-sm font-medium text-slate-700">Password cannot be same as User ID</span>
                    <p className="text-xs text-slate-500">Prevents users from using their username as password</p>
                  </div>
                </label>
                <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer">
                  <input type="checkbox" {...register('cannotContainUserId')} className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                  <div>
                    <span className="text-sm font-medium text-slate-700">Password cannot contain User ID</span>
                    <p className="text-xs text-slate-500">Prevents passwords that include the username</p>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => navigate('/config')} className="px-6">
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={isSubmitting}
            className="px-6 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-lg shadow-blue-500/25"
          >
            {isSubmitting ? (
              <>
                <svg className="w-4 h-4 mr-2 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save Changes
              </>
            )}
          </Button>
        </div>
      </form>

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Update Password Policy"
      />
    </div>
  );
}
