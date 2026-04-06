import { useState, useEffect } from 'react';
import { useBranding } from '@/hooks/use-branding';

const REQUEST_TYPES = [
  { value: 'CREATE_USER', label: 'Create User Account' },
  { value: 'MODIFY_USER', label: 'Modify User Account' },
  { value: 'UNLOCK', label: 'Unlock Account' },
  { value: 'FORGOT_PASSWORD', label: 'Forgot Password' },
];

export function ContactAdminPage() {
  const { branding } = useBranding();
  const [requestType, setRequestType] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [requesterEmployeeId, setRequesterEmployeeId] = useState('');
  const [requesterEmail, setRequesterEmail] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  // Type-specific fields
  const [fullName, setFullName] = useState('');
  const [department, setDepartment] = useState('');
  const [email, setEmail] = useState('');
  const [requestedRole, setRequestedRole] = useState('');
  const [username, setUsername] = useState('');
  const [modifyField, setModifyField] = useState('');
  const [newValue, setNewValue] = useState('');

  // Fetch available roles for Create User
  const [roles, setRoles] = useState<{ name: string; displayName: string }[]>([]);
  useEffect(() => {
    fetch('/api/roles/active')
      .then(r => r.json())
      .then(d => setRoles(Array.isArray(d) ? d : d.data ?? []))
      .catch(() => {});
  }, []);

  const buildRequestData = () => {
    switch (requestType) {
      case 'CREATE_USER':
        return { fullName, department, email, requestedRole };
      case 'MODIFY_USER':
        return { username, modifyField, newValue };
      case 'UNLOCK':
        return { username };
      case 'FORGOT_PASSWORD':
        return { username };
      default:
        return {};
    }
  };

  const canSubmit = () => {
    if (!requestType || !requesterName.trim() || !remarks.trim()) return false;
    switch (requestType) {
      case 'CREATE_USER':
        return fullName.trim() && email.trim() && requestedRole;
      case 'MODIFY_USER':
        return username.trim() && modifyField && newValue.trim();
      case 'UNLOCK':
      case 'FORGOT_PASSWORD':
        return username.trim();
      default:
        return false;
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit()) {
      setError('Please fill in all required fields.');
      return;
    }
    setSubmitting(true);
    setError('');

    try {
      const payload = {
        requestType,
        requesterName: requesterName.trim(),
        requesterEmployeeId: requesterEmployeeId.trim() || undefined,
        requesterEmail: requesterEmail.trim() || undefined,
        requestData: buildRequestData(),
        remarks: remarks.trim(),
      };
      const res = await fetch('/api/admin-requests', {
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

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: `linear-gradient(135deg, ${branding.loginBgStart ?? '#0f172a'}, ${branding.loginBgEnd ?? '#1e293b'})` }}>
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-slate-800 mb-2">Request Submitted</h2>
          <p className="text-sm text-slate-500 mb-6">Your request has been sent to the administrator. You will be notified once it's processed.</p>
          <a href="/login" className="inline-block px-6 py-2 rounded-lg text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 transition-colors">
            Back to Login
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: `linear-gradient(135deg, ${branding.loginBgStart ?? '#0f172a'}, ${branding.loginBgEnd ?? '#1e293b'})` }}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="px-8 py-6 border-b border-slate-200">
          <div className="flex items-center gap-3 mb-1">
            <a href="/login" className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </a>
            <h1 className="text-xl font-bold text-slate-800">Contact Admin</h1>
          </div>
          <p className="text-sm text-slate-500 ml-9">Submit a request to the system administrator</p>
        </div>

        {/* Form */}
        <div className="px-8 py-6 space-y-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>
          )}

          {/* Your Information */}
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Your Information</h3>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Your Name <span className="text-red-500">*</span></label>
              <input type="text" value={requesterName} onChange={e => setRequesterName(e.target.value)}
                placeholder="Enter your full name" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Employee ID</label>
                <input type="text" value={requesterEmployeeId} onChange={e => setRequesterEmployeeId(e.target.value)}
                  placeholder="EMP-001" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Your Email</label>
                <input type="email" value={requesterEmail} onChange={e => setRequesterEmail(e.target.value)}
                  placeholder="you@company.com" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
              </div>
            </div>
          </div>

          {/* Request Type */}
          <div className="pt-2 space-y-3">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Request Details</h3>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Request Type <span className="text-red-500">*</span></label>
              <select value={requestType} onChange={e => setRequestType(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500">
                <option value="">Select request type...</option>
                {REQUEST_TYPES.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
              </select>
            </div>
          </div>

          {/* Dynamic Fields Based on Request Type */}
          {requestType === 'CREATE_USER' && (
            <div className="space-y-3 p-4 rounded-lg bg-blue-50 border border-blue-200">
              <p className="text-xs font-semibold text-blue-700 uppercase tracking-wider">New User Details</p>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Full Name <span className="text-red-500">*</span></label>
                <input type="text" value={fullName} onChange={e => setFullName(e.target.value)}
                  placeholder="John Doe" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Department</label>
                  <input type="text" value={department} onChange={e => setDepartment(e.target.value)}
                    placeholder="Engineering" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Email <span className="text-red-500">*</span></label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="user@company.com" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Requested Role <span className="text-red-500">*</span></label>
                <select value={requestedRole} onChange={e => setRequestedRole(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500">
                  <option value="">Select role...</option>
                  {roles.map(r => <option key={r.name} value={r.name}>{r.displayName}</option>)}
                </select>
              </div>
            </div>
          )}

          {requestType === 'MODIFY_USER' && (
            <div className="space-y-3 p-4 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Modification Details</p>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Username <span className="text-red-500">*</span></label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Enter the username to modify" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">What to Modify <span className="text-red-500">*</span></label>
                <select value={modifyField} onChange={e => setModifyField(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500">
                  <option value="">Select...</option>
                  <option value="Role Change">Role Change</option>
                  <option value="Department Change">Department Change</option>
                  <option value="Email Change">Email Change</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">New Value / Description <span className="text-red-500">*</span></label>
                <input type="text" value={newValue} onChange={e => setNewValue(e.target.value)}
                  placeholder="Enter the new value or describe the change" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
              </div>
            </div>
          )}

          {requestType === 'UNLOCK' && (
            <div className="space-y-3 p-4 rounded-lg bg-red-50 border border-red-200">
              <p className="text-xs font-semibold text-red-700 uppercase tracking-wider">Unlock Details</p>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Username <span className="text-red-500">*</span></label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Enter the locked account username" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
              </div>
            </div>
          )}

          {requestType === 'FORGOT_PASSWORD' && (
            <div className="space-y-3 p-4 rounded-lg bg-purple-50 border border-purple-200">
              <p className="text-xs font-semibold text-purple-700 uppercase tracking-wider">Password Reset Details</p>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Username <span className="text-red-500">*</span></label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Enter your username" className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
              </div>
            </div>
          )}

          {/* Remarks */}
          {requestType && (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Reason / Remarks <span className="text-red-500">*</span></label>
              <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
                placeholder="Explain why you need this request..."
                rows={3} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500" />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
          <a href="/login" className="flex-1 px-4 py-2.5 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100 transition-colors text-center">
            Cancel
          </a>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit() || submitting}
            className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
        </div>
      </div>
    </div>
  );
}
