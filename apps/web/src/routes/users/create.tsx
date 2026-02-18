import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, type CreateUserInput, type PasswordPolicyConfig, type RoleData } from '@digilog/shared';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { useFieldLabels } from '@/hooks/use-field-labels';
import { apiClient } from '@/lib/api-client';
import { ReauthDialog } from '@/components/reauth-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import useSWR from 'swr';

// Default password policy
const defaultPolicy: PasswordPolicyConfig = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  minUppercase: 1,
  minLowercase: 1,
  minNumbers: 1,
  minSpecialChars: 1,
  preventReuseCount: 12,
  cannotBeUserId: true,
  cannotContainUserId: true,
  maxFailedAttempts: 5,
  passwordExpiryDays: 90,
  autoLogoutEnabled: true,
  idleTimeoutMinutes: 15,
  warningMinutes: 2,
};

// Generate password based on policy
function generatePassword(policy: PasswordPolicyConfig): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  let password = '';
  const allChars: string[] = [];

  // Add required characters
  if (policy.requireUppercase) {
    for (let i = 0; i < policy.minUppercase; i++) {
      password += uppercase[Math.floor(Math.random() * uppercase.length)];
    }
    allChars.push(...uppercase.split(''));
  }

  if (policy.requireLowercase) {
    for (let i = 0; i < policy.minLowercase; i++) {
      password += lowercase[Math.floor(Math.random() * lowercase.length)];
    }
    allChars.push(...lowercase.split(''));
  }

  if (policy.requireNumbers) {
    for (let i = 0; i < policy.minNumbers; i++) {
      password += numbers[Math.floor(Math.random() * numbers.length)];
    }
    allChars.push(...numbers.split(''));
  }

  if (policy.requireSpecialChars) {
    for (let i = 0; i < policy.minSpecialChars; i++) {
      password += special[Math.floor(Math.random() * special.length)];
    }
    allChars.push(...special.split(''));
  }

  // Fill remaining length with random characters
  const targetLength = Math.max(policy.minLength, password.length + 4);
  while (password.length < targetLength) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  // Shuffle the password
  return password.split('').sort(() => Math.random() - 0.5).join('');
}

export function CreateUserPage() {
  const { user } = useAuth();
  const { userLabels } = useFieldLabels();
  const navigate = useNavigate();
  const reauth = useReauth();
  const [error, setError] = useState('');
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch password policy
  const { data: policyData } = useSWR<PasswordPolicyConfig>('/api/config/password-policy');
  const policy = { ...defaultPolicy, ...policyData };

  // Fetch roles that current user can create
  const { data: creatableRolesData } = useSWR<RoleData[]>(
    user?.role ? `/api/roles/${user.role}/creatable` : null
  );
  const creatableRoles = creatableRolesData || [];

  const { register, handleSubmit, setValue, formState: { errors, isSubmitting } } = useForm<CreateUserInput>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { status: 'ENABLED' },
  });

  // Generate password on mount and when policy changes
  useEffect(() => {
    const newPassword = generatePassword(policy);
    setGeneratedPassword(newPassword);
    setValue('password', newPassword);
    setValue('confirmPassword', newPassword);
  }, [policyData, setValue]);

  const regeneratePassword = () => {
    const newPassword = generatePassword(policy);
    setGeneratedPassword(newPassword);
    setValue('password', newPassword);
    setValue('confirmPassword', newPassword);
    setCopied(false);
  };

  const copyToClipboard = async () => {
    try {
      await navigator.clipboard.writeText(generatedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = generatedPassword;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const onSubmit = async (data: CreateUserInput) => {
    setError('');
    await reauth.execute('CREATE_USER', async (password?) => {
      if (password) await apiClient.postWithReauth('/api/users', data, password);
      else await apiClient.post('/api/users', data);
      navigate('/users');
    }, {
      onError: (err: any) => setError(err.message || 'Failed to create user'),
    });
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Create New User</h1>
            <p className="text-sm text-slate-500 mt-0.5">Add a new user to the system</p>
          </div>
        </div>
        <Link to="/users">
          <Button variant="outline" className="gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Users
          </Button>
        </Link>
      </div>

      {/* Form Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Error Message */}
          {error && (
            <div className="mx-6 mt-6 flex items-center gap-3 rounded-xl bg-red-50 border border-red-200 p-4">
              <div className="p-2 rounded-lg bg-red-100">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          {/* User Details Section */}
          <div className="p-6 border-b border-slate-100">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-slate-100">
                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-slate-800">User Information</h2>
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">
                  {userLabels.userId} <span className="text-red-500">*</span>
                </label>
                <Input
                  {...register('username')}
                  placeholder={`Enter ${userLabels.userId.toLowerCase()} (6-50 characters)`}
                  className="h-12"
                />
                {errors.username && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {errors.username.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">
                  {userLabels.fullName} <span className="text-red-500">*</span>
                </label>
                <Input
                  {...register('fullName')}
                  placeholder={`Enter ${userLabels.fullName.toLowerCase()}`}
                  className="h-12"
                />
                {errors.fullName && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {errors.fullName.message}
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-6 mt-6">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">
                  {userLabels.email} <span className="text-red-500">*</span>
                </label>
                <Input
                  {...register('email')}
                  type="email"
                  placeholder="user@example.com"
                  className="h-12"
                />
                {errors.email && (
                  <p className="text-sm text-red-500 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {errors.email.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">{userLabels.department}</label>
                <Input
                  {...register('department')}
                  placeholder={`Enter ${userLabels.department.toLowerCase()} (optional)`}
                  className="h-12"
                />
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <label className="text-sm font-semibold text-slate-700">
                {userLabels.role} <span className="text-red-500">*</span>
              </label>
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-gradient-to-br from-purple-100 to-indigo-100 z-10 pointer-events-none">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <Select {...register('role')} variant="filled" className="pl-12 h-12">
                  <option value="">Select a role</option>
                  {creatableRoles.map((r) => (
                    <option key={r.name} value={r.name}>{r.displayName}</option>
                  ))}
                </Select>
              </div>
              {errors.role && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {errors.role.message}
                </p>
              )}
            </div>
          </div>

          {/* Temporary Password Section */}
          <div className="p-6 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 rounded-lg bg-amber-100">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                </svg>
              </div>
              <h2 className="text-lg font-semibold text-slate-800">Temporary Password</h2>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-700">Auto-Generated Password</label>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={regeneratePassword} className="gap-1.5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Regenerate
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={copyToClipboard} className="gap-1.5">
                    {copied ? (
                      <>
                        <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-emerald-600">Copied!</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="relative">
                <Input
                  value={generatedPassword}
                  readOnly
                  type={showPassword ? 'text' : 'password'}
                  className="font-mono text-base bg-white pr-16 h-12 border-slate-200"
                />
                <button
                  type="button"
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <input type="hidden" {...register('password')} />
              <input type="hidden" {...register('confirmPassword')} />
              {errors.password && (
                <p className="text-sm text-red-500 flex items-center gap-1">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {errors.password.message}
                </p>
              )}

              <div className="rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/60 p-4 mt-4">
                <div className="flex gap-3">
                  <div className="p-2 rounded-lg bg-amber-100 h-fit">
                    <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <p className="font-semibold text-amber-800 text-sm">Important</p>
                    <p className="text-amber-700 text-sm mt-1">
                      Copy the temporary password before creating the user. The user will be required to change this password on first login.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
            <Link to="/users">
              <Button type="button" variant="outline" className="px-6">
                Cancel
              </Button>
            </Link>
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
                  Creating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Create User
                </>
              )}
            </Button>
          </div>
        </form>
      </div>
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Create User"
      />
    </div>
  );
}
