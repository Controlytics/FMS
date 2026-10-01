import { useState, useEffect } from 'react';
import { AuthShell, AuthError, AuthSuccess } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiUrl } from '@/lib/url-utils';

const REQUEST_TYPES = [
  { value: 'CREATE_USER', label: 'Create User Account' },
  { value: 'MODIFY_USER', label: 'Modify User Account' },
  { value: 'UNLOCK', label: 'Unlock Account' },
  { value: 'ENABLE_ACCOUNT', label: 'Enable Account' },
  { value: 'DISABLE_ACCOUNT', label: 'Disable Account' },
  { value: 'FORGOT_PASSWORD', label: 'Forgot Password' },
];

export function ContactAdminPage() {
  const [requestType, setRequestType] = useState('');
  const [requesterEmployeeId, setRequesterEmployeeId] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // Type-specific fields
  const [newUserId, setNewUserId] = useState(''); // CREATE_USER: requested login ID for the new account
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [requestedRole, setRequestedRole] = useState('');
  const [username, setUsername] = useState('');
  // MODIFY_USER changes the ROLE only (2026-10-01) — the server refuses any other field.
  const [newRole, setNewRole] = useState('');

  // User lookup (for MODIFY_USER / UNLOCK / FORGOT_PASSWORD target user).
  // `role` is null for a SUPER_ADMIN account (the server never discloses it).
  type LookupUser = { username: string; fullName: string; role: string | null; roleDisplayName: string | null };
  const [lookupUser, setLookupUser] = useState<LookupUser | null>(null);
  const [lookupError, setLookupError] = useState('');
  const [lookingUp, setLookingUp] = useState(false);

  // The requester's Employee ID is a plain text field — no Verify step (operator
  // request 2026-10-01). It was never a real check: the endpoint is public, so
  // the server records the submitter as `unverified:<id>` in the audit trail and
  // resolves the stored full name itself when the ID matches an account
  // (admin-request.service.ts create()). A requester asking for a NEW account
  // has no ID to verify anyway.

  const ACCOUNT_STATE_TYPES = ['UNLOCK', 'ENABLE_ACCOUNT', 'DISABLE_ACCOUNT'];
  const needsLookup = requestType === 'MODIFY_USER' || requestType === 'FORGOT_PASSWORD'
    || ACCOUNT_STATE_TYPES.includes(requestType);

  // Reset dependent state when request type changes
  useEffect(() => {
    setUsername('');
    setLookupUser(null);
    setLookupError('');
    setNewRole('');
    setNewUserId('');
  }, [requestType]);

  // Reset the role selection when the looked-up user changes
  useEffect(() => {
    setNewRole('');
  }, [lookupUser]);

  const performLookup = async () => {
    const trimmed = username.trim();
    if (!trimmed) return;
    setLookingUp(true);
    setLookupError('');
    setLookupUser(null);
    try {
      const res = await fetch(apiUrl(`/api/admin-requests/user-lookup?username=${encodeURIComponent(trimmed)}`));
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setLookupError(data.message ?? `Lookup failed (${res.status})`);
        return;
      }
      const data = await res.json() as { exists: boolean; username: string; fullName: string | null; role?: string | null; roleDisplayName?: string | null };
      if (!data.exists) {
        setLookupError('Employee ID does not exist in the application');
        return;
      }
      setLookupUser({ username: data.username, fullName: data.fullName ?? '', role: data.role ?? null, roleDisplayName: data.roleDisplayName ?? null });
    } catch (err: any) {
      setLookupError(err.message ?? 'Lookup failed');
    } finally {
      setLookingUp(false);
    }
  };

  // Fetch available roles for Create User
  const [roles, setRoles] = useState<{ name: string; displayName: string }[]>([]);
  useEffect(() => {
    fetch(apiUrl('/api/roles/active'))
      .then(r => r.json())
      .then(d => {
        const list = Array.isArray(d) ? d : d.data ?? [];
        setRoles(list.filter((r: { name: string }) => r.name !== 'SUPER_ADMIN'));
      })
      .catch(() => {});
  }, []);

  const buildRequestData = () => {
    switch (requestType) {
      case 'CREATE_USER':
        return { username: newUserId.trim(), fullName, department, email, requestedRole };
      case 'MODIFY_USER':
        return { username: lookupUser?.username ?? username, modifyField: 'role', newValue: newRole };
      case 'UNLOCK':
      case 'ENABLE_ACCOUNT':
      case 'DISABLE_ACCOUNT':
        return { username: lookupUser?.username ?? username };
      case 'FORGOT_PASSWORD':
        return { username: lookupUser?.username ?? username };
      default:
        return {};
    }
  };

  // 2026-09-02: an `isAlreadyEnabled` check lived here, comparing
  // `lookupUser.status` — a field `GET /admin-requests/user-lookup` has NOT
  // returned since it was hardened against directory enumeration (its response
  // schema is {exists, username, fullName}, and Fastify strips the rest). It was
  // therefore always false and blocked nothing. Removed rather than repaired:
  // account state must not be exposed on a public endpoint, so the real check
  // is server-side at approval time, where the actor is authenticated and the
  // state is current. See admin-request.service.ts executeApproval.

  const canSubmit = () => {
    if (!requestType || !requesterEmployeeId.trim() || !remarks.trim()) return false;
    switch (requestType) {
      case 'CREATE_USER':
        return newUserId.trim().length >= 6 && fullName.trim() && requestedRole;
      case 'MODIFY_USER':
        return !!lookupUser && !!lookupUser.role && !!newRole && newRole !== lookupUser.role;
      case 'UNLOCK':
      case 'ENABLE_ACCOUNT':
      case 'DISABLE_ACCOUNT':
        return !!lookupUser;
      case 'FORGOT_PASSWORD':
        return !!lookupUser;
      default:
        return false;
    }
  };

  const getMissingFields = (): string[] => {
    const missing: string[] = [];
    if (!requesterEmployeeId.trim()) missing.push('Your employee ID');
    if (!requestType) missing.push('What you need');
    if (requestType === 'CREATE_USER') {
      if (!newUserId.trim()) missing.push('User ID');
      else if (newUserId.trim().length < 6) missing.push('User ID (min 6 characters)');
      if (!fullName.trim()) missing.push('Full name');
      if (!requestedRole) missing.push('Role');
    }
    if (requestType === 'MODIFY_USER') {
      if (!lookupUser) missing.push('Employee ID of the account (use Find)');
      if (lookupUser && !lookupUser.role) missing.push('a modifiable account (this account\'s role cannot be changed here)');
      if (lookupUser?.role && !newRole) missing.push('New role');
    }
    if (ACCOUNT_STATE_TYPES.includes(requestType)) {
      if (!lookupUser) missing.push('Employee ID of the account (use Find)');
    }
    if (requestType === 'FORGOT_PASSWORD') {
      if (!lookupUser) missing.push('Employee ID of the account (use Find)');
    }
    if (requestType && !remarks.trim()) missing.push('Reason');
    return missing;
  };

  const handleSubmit = async () => {
    const missing = getMissingFields();
    if (missing.length > 0) {
      setError(`Still needed: ${missing.join(', ')}.`);
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        requestType,
        // The API requires a name; the server replaces it with the account's
        // stored full name when the Employee ID matches one.
        requesterName: requesterEmployeeId.trim(),
        requesterEmployeeId: requesterEmployeeId.trim(),
        requesterEmail: requesterEmail.trim() || undefined,
        requestData: buildRequestData(),
        remarks: remarks.trim(),
      };
      const res = await fetch(apiUrl('/api/admin-requests'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? `Server error (${res.status})`);
      }
      setSubmitted(true);
    } catch (err: any) {
      setError(err.message ?? 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const label = 'mb-1.5 block text-sm font-medium text-slate-700';
  const selectCls = 'h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 hover:border-slate-400 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15';
  const required = <span className="text-red-600">*</span>;

  if (submitted) {
    return (
      <AuthShell title="Contact admin" backToLogin wide>
        <div className="space-y-5">
          <AuthSuccess title="Request sent">
            The administrator has your request. You will be told when it has been processed.
          </AuthSuccess>
          <a href="/login" className="flex h-11 w-full items-center justify-center rounded-lg bg-brand-600 text-sm font-medium text-white hover:bg-brand-700">
            Back to sign in
          </a>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Contact admin"
      description="Ask the administrator to create, change, unlock or reset an account."
      backToLogin
      wide
    >
      <div className="space-y-4">
        {error && <AuthError>{error}</AuthError>}

        <div>
          <label htmlFor="ca-requester" className={label}>Your employee ID {required}</label>
          <Input
            id="ca-requester"
            value={requesterEmployeeId}
            onChange={e => setRequesterEmployeeId(e.target.value)}
            placeholder="EMP-001"
            className="h-11"
          />
          <p className="mt-1.5 text-xs text-slate-500">Recorded in the audit trail with this request.</p>
        </div>

        <div>
          <label htmlFor="ca-type" className={label}>What do you need? {required}</label>
          <select id="ca-type" value={requestType} onChange={e => setRequestType(e.target.value)} className={selectCls}>
            <option value="">Select a request…</option>
            {REQUEST_TYPES.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
          </select>
        </div>

        {/* One neutral panel for every request type — the type is named by its
            heading, not by a different background colour per type. */}
        {requestType === 'CREATE_USER' && (
          <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">New account</legend>
            <div>
              <label htmlFor="ca-newid" className={label}>User ID {required}</label>
              <Input id="ca-newid" value={newUserId} onChange={e => setNewUserId(e.target.value)}
                placeholder="e.g. jdoe01" autoComplete="off" className="h-11" />
              <p className="mt-1.5 text-xs text-slate-500">The login ID for the new account, at least 6 characters.</p>
            </div>
            <div>
              <label htmlFor="ca-fullname" className={label}>Full name {required}</label>
              <Input id="ca-fullname" value={fullName} onChange={e => setFullName(e.target.value)} placeholder="John Doe" className="h-11" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="ca-dept" className={label}>Department</label>
                <Input id="ca-dept" value={department} onChange={e => setDepartment(e.target.value)} placeholder="Engineering" className="h-11" />
              </div>
              <div>
                <label htmlFor="ca-email" className={label}>Email <span className="font-normal text-slate-500">(optional)</span></label>
                <Input id="ca-email" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="user@company.com" className="h-11" />
              </div>
            </div>
            <div>
              <label htmlFor="ca-role" className={label}>Role {required}</label>
              <select id="ca-role" value={requestedRole} onChange={e => setRequestedRole(e.target.value)} className={selectCls}>
                <option value="">Select a role…</option>
                {roles.map(r => <option key={r.name} value={r.name}>{r.displayName}</option>)}
              </select>
            </div>
          </fieldset>
        )}

        {needsLookup && (
          <fieldset className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <legend className="px-1 text-sm font-semibold text-slate-800">
              {requestType === 'MODIFY_USER' ? 'Account to change'
                : requestType === 'UNLOCK' ? 'Account to unlock'
                : requestType === 'ENABLE_ACCOUNT' ? 'Account to enable'
                : requestType === 'DISABLE_ACCOUNT' ? 'Account to disable'
                : 'Account to reset'}
            </legend>

            <div>
              <label htmlFor="ca-target" className={label}>Employee ID {required}</label>
              <div className="flex gap-2">
                <Input
                  id="ca-target"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setLookupUser(null); setLookupError(''); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); performLookup(); } }}
                  placeholder="Enter employee ID"
                  className="h-11 flex-1"
                />
                <Button type="button" variant="outline" onClick={performLookup} disabled={!username.trim() || lookingUp} className="h-11 shrink-0">
                  {lookingUp ? 'Finding…' : 'Find'}
                </Button>
              </div>
              {lookupError && <p className="mt-1.5 text-sm text-red-600">{lookupError}</p>}
            </div>

            {lookupUser && (
              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                <p className="text-sm font-semibold text-slate-900">{lookupUser.fullName}</p>
                <p className="font-mono text-xs text-slate-500">{lookupUser.username}</p>
              </div>
            )}

            {/* MODIFY_USER changes the role only (2026-10-01): current role -> new role. */}
            {lookupUser && requestType === 'MODIFY_USER' && (
              lookupUser.role ? (
                <div>
                  <span className={label}>Role change {required}</span>
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 min-w-0 flex-1 items-center rounded-lg border border-slate-200 bg-slate-100 px-3 text-sm text-slate-600" title="Current role">
                      <span className="truncate">{lookupUser.roleDisplayName ?? lookupUser.role}</span>
                    </span>
                    <svg className="h-4 w-4 shrink-0 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                    </svg>
                    <select aria-label="New role" value={newRole} onChange={e => setNewRole(e.target.value)} className={`${selectCls} min-w-0 flex-1`}>
                      <option value="">Select new role…</option>
                      {roles.filter(r => r.name !== lookupUser.role).map(r => (
                        <option key={r.name} value={r.name}>{r.displayName}</option>
                      ))}
                    </select>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-500">Current role on the left, the role you are asking for on the right.</p>
                </div>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-600">
                  This account's role cannot be changed through a request. Contact the administrator directly.
                </p>
              )
            )}
          </fieldset>
        )}

        {requestType && (
          <div>
            <label htmlFor="ca-remarks" className={label}>Reason {required}</label>
            <textarea id="ca-remarks" value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder="Why is this needed?"
              rows={3}
              className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15" />
          </div>
        )}

        <Button onClick={handleSubmit} disabled={submitting} className="h-11 w-full">
          {submitting ? 'Sending…' : 'Send request'}
        </Button>
      </div>
    </AuthShell>
  );
}
