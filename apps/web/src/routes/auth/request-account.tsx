import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { createUserRequestSchema, type CreateUserRequestInput } from '@digilog/shared';
import { useBranding } from '@/hooks/use-branding';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ActiveRole { name: string; displayName: string; hierarchyLevel: number; color: string }
interface UserIdRules { length: number; format: string; prefix: string; prefixSeparator: string; letterCase: string; customPatternDescription: string; customPatternExample: string }
type FieldStatus = { checking: boolean; available?: boolean; error?: string };

const FORMAT_LABELS: Record<string, string> = {
  NUMBERS_ONLY: 'numbers only', LETTERS_ONLY: 'letters only', LETTERS_NUMBERS: 'letters and numbers',
  PREFIX_NUMBERS: 'prefix + numbers', PREFIX_LETTERS: 'prefix + letters',
  PREFIX_LETTERS_NUMBERS: 'prefix + letters and numbers', CUSTOM_PATTERN: 'custom pattern',
};

function buildFormatHint(r: UserIdRules): string {
  const p: string[] = [`${r.length} characters`];
  if (r.prefix) p.push(`prefix "${r.prefix}${r.prefixSeparator}"`);
  if (r.format === 'CUSTOM_PATTERN' && r.customPatternDescription) p.push(r.customPatternDescription);
  else p.push(FORMAT_LABELS[r.format] || r.format);
  if (r.letterCase === 'UPPERCASE') p.push('uppercase');
  else if (r.letterCase === 'LOWERCASE') p.push('lowercase');
  return p.join(', ');
}

function StatusIcon({ status }: { status: FieldStatus }) {
  if (status.checking) return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2">
      <svg className="animate-spin h-4 w-4 text-slate-400" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
    </div>
  );
  if (status.available === true) return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2">
      <svg className="h-4 w-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
    </div>
  );
  if (status.available === false) return (
    <div className="absolute right-3 top-1/2 -translate-y-1/2">
      <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
    </div>
  );
  return null;
}

function borderClass(status: FieldStatus) {
  if (status.available === true) return 'border-emerald-400';
  if (status.available === false) return 'border-red-400';
  return 'border-slate-200';
}

export function RequestAccountPage() {
  const navigate = useNavigate();
  const { branding } = useBranding();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [roles, setRoles] = useState<ActiveRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [userIdRules, setUserIdRules] = useState<UserIdRules | null>(null);
  const [userIdStatus, setUserIdStatus] = useState<FieldStatus>({ checking: false });
  const [emailStatus, setEmailStatus] = useState<FieldStatus>({ checking: false });
  const userIdTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const emailTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch('/api/user-requests/roles')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => { setRoles(Array.isArray(d) ? d : []); setRolesLoading(false); })
      .catch(() => setRolesLoading(false));
    fetch('/api/user-requests/user-id-rules')
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(d => setUserIdRules(d))
      .catch(() => {});
  }, []);

  const checkAvailability = useCallback(async (field: 'userId' | 'email', value: string) => {
    if (!value.trim()) return;
    const setStatus = field === 'userId' ? setUserIdStatus : setEmailStatus;
    setStatus({ checking: true });
    try {
      const body = field === 'userId' ? { userId: value } : { email: value };
      const res = await fetch('/api/user-requests/check-availability', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      const available = field === 'userId' ? d.userIdAvailable : d.emailAvailable;
      const err = field === 'userId' ? d.userIdError : d.emailError;
      setStatus({ checking: false, available, error: err });
    } catch { setStatus({ checking: false }); }
  }, []);

  const handleUserIdBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    clearTimeout(userIdTimer.current);
    const v = e.target.value;
    if (v.trim()) userIdTimer.current = setTimeout(() => checkAvailability('userId', v), 300);
    else setUserIdStatus({ checking: false });
  }, [checkAvailability]);

  const handleEmailBlur = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    clearTimeout(emailTimer.current);
    const v = e.target.value;
    if (v.trim() && v.includes('@')) emailTimer.current = setTimeout(() => checkAvailability('email', v), 300);
    else setEmailStatus({ checking: false });
  }, [checkAvailability]);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<CreateUserRequestInput>({
    resolver: zodResolver(createUserRequestSchema),
  });

  const onSubmit = async (data: CreateUserRequestInput) => {
    setError('');
    try {
      const res = await fetch('/api/user-requests', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.message || 'Submission failed');
      setSubmitted(true);
    } catch (err: any) { setError(err.message || 'Failed to submit request'); }
  };

  const userIdReg = register('requestedUserId');
  const emailReg = register('email');
  const placeholderUserId = userIdRules
    ? `e.g. ${userIdRules.prefix ? userIdRules.prefix + userIdRules.prefixSeparator : ''}${'0'.repeat(Math.max(1, userIdRules.length - (userIdRules.prefix ? userIdRules.prefix.length + userIdRules.prefixSeparator.length : 0)))}`
    : 'Enter desired User ID';

  return (
    <div className="flex min-h-screen items-center justify-center p-8" style={{ background: `linear-gradient(to bottom right, ${branding.loginBgStart}, ${branding.loginBgEnd}, ${branding.loginBgStart})` }}>
      <div className="w-full max-w-md">
        <div className="relative bg-white/95 backdrop-blur-sm rounded-3xl shadow-2xl overflow-hidden">
          <div className="h-2" style={{ background: `linear-gradient(to right, ${branding.gradientStart}, ${branding.gradientMiddle}, ${branding.gradientEnd})` }} />
          <div className="p-8 pt-6">
            {/* Branding */}
            <div className="text-center mb-6">
              {branding.logoUrl ? (
                <div className="inline-flex items-center justify-center w-40 h-28 mb-4">
                  <img src={branding.logoUrl} alt={branding.appName} className="max-w-full max-h-full object-contain" />
                </div>
              ) : (
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 shadow-xl" style={{ background: `linear-gradient(to bottom right, ${branding.primaryColor}, ${branding.secondaryColor})`, boxShadow: `0 10px 40px -10px ${branding.secondaryColor}50` }}>
                  <span className="text-2xl font-bold text-white tracking-tight">{branding.logoText}</span>
                </div>
              )}
              <h1 className="text-2xl font-bold mb-2" style={{ background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Request New Account
              </h1>
              <p className="text-sm text-slate-500">{submitted ? 'Your request has been submitted' : 'Fill in the details below to request a new user account'}</p>
            </div>

            {submitted ? (
              <div className="space-y-6">
                <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-emerald-50 to-emerald-100 border border-emerald-200 p-4">
                  <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-emerald-800">Request Submitted</p>
                    <p className="text-sm text-emerald-700 mt-1">Your account creation request has been submitted. An administrator will review it and notify you once it's been processed.</p>
                  </div>
                </div>
                <Button type="button" className="w-full h-12 text-base font-semibold rounded-xl" style={{ background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})` }} onClick={() => navigate('/login')}>Back to Login</Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                {error && (
                  <div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-red-50 to-red-100 border border-red-200 p-4">
                    <div className="w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shrink-0">
                      <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </div>
                    <p className="text-sm text-red-700 font-medium">{error}</p>
                  </div>
                )}

                {/* User ID */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">User ID <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Input {...userIdReg} onBlur={(e) => { userIdReg.onBlur(e); handleUserIdBlur(e); }} placeholder={placeholderUserId} className={`h-11 text-sm rounded-xl border-2 bg-slate-50/50 pr-9 ${borderClass(userIdStatus)}`} />
                    <StatusIcon status={userIdStatus} />
                  </div>
                  {userIdRules && <p className="text-xs text-slate-400">Required format: {buildFormatHint(userIdRules)}</p>}
                  {errors.requestedUserId && <p className="text-xs text-red-500 font-medium">{errors.requestedUserId.message}</p>}
                  {userIdStatus.error && !errors.requestedUserId && <p className="text-xs text-red-500 font-medium">{userIdStatus.error}</p>}
                  {userIdStatus.available === true && <p className="text-xs text-emerald-600 font-medium">User ID is available</p>}
                </div>

                {/* Full Name */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">Full Name <span className="text-red-500">*</span></label>
                  <Input {...register('fullName')} placeholder="Enter your full name" className="h-11 text-sm rounded-xl border-2 border-slate-200 bg-slate-50/50" />
                  {errors.fullName && <p className="text-xs text-red-500 font-medium">{errors.fullName.message}</p>}
                </div>

                {/* Email */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">Email <span className="text-red-500">*</span></label>
                  <div className="relative">
                    <Input {...emailReg} onBlur={(e) => { emailReg.onBlur(e); handleEmailBlur(e); }} type="email" placeholder="Enter your email address" className={`h-11 text-sm rounded-xl border-2 bg-slate-50/50 pr-9 ${borderClass(emailStatus)}`} />
                    <StatusIcon status={emailStatus} />
                  </div>
                  {errors.email && <p className="text-xs text-red-500 font-medium">{errors.email.message}</p>}
                  {emailStatus.error && !errors.email && <p className="text-xs text-red-500 font-medium">{emailStatus.error}</p>}
                  {emailStatus.available === true && <p className="text-xs text-emerald-600 font-medium">Email is available</p>}
                </div>

                {/* Department */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">Department</label>
                  <Input {...register('department')} placeholder="Enter your department (optional)" className="h-11 text-sm rounded-xl border-2 border-slate-200 bg-slate-50/50" />
                </div>

                {/* Role */}
                <div className="space-y-1.5">
                  <label className="block text-sm font-semibold text-slate-700">Role <span className="text-red-500">*</span></label>
                  <select {...register('roleName')} className="w-full h-11 text-sm rounded-xl border-2 border-slate-200 bg-slate-50/50 px-3 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500" defaultValue="">
                    <option value="" disabled>{rolesLoading ? 'Loading roles...' : 'Select a role'}</option>
                    {roles.map(role => <option key={role.name} value={role.name}>{role.displayName}</option>)}
                  </select>
                  {errors.roleName && <p className="text-xs text-red-500 font-medium">{errors.roleName.message}</p>}
                </div>

                {/* Info box */}
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <div className="flex gap-2">
                    <svg className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <p className="text-xs text-amber-800">Your request will be reviewed by an administrator. Once approved, you'll receive a temporary password to log in.</p>
                  </div>
                </div>

                <div className="space-y-3 pt-1">
                  <Button type="submit" className="w-full h-12 text-base font-semibold rounded-xl transition-all hover:-translate-y-0.5" style={{ background: `linear-gradient(to right, ${branding.primaryColor}, ${branding.secondaryColor})`, boxShadow: `0 10px 40px -10px ${branding.secondaryColor}50` }} disabled={isSubmitting}>
                    {isSubmitting ? (
                      <span className="flex items-center gap-2">
                        <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                        Submitting...
                      </span>
                    ) : 'Submit Request'}
                  </Button>
                  <button type="button" className="w-full text-sm font-semibold transition-colors py-2" style={{ color: branding.secondaryColor }} onClick={() => navigate('/login')}>Back to Login</button>
                </div>
              </form>
            )}

            {/* Company info */}
            <div className="mt-6 pt-5 border-t border-slate-200 text-center">
              <p className="text-base font-bold text-slate-700">{branding.companyName}</p>
              <p className="text-sm text-slate-500 mt-1 font-semibold">Version {branding.version}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
