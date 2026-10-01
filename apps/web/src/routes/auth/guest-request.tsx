import { useState } from 'react';
import { AuthShell, AuthError, AuthSuccess } from '@/components/auth-shell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getApiBase } from '@/lib/api-base';

// Public (unauthenticated) page reached from the login "Guest" button. Collects a
// filter cleaning request and posts it to the public /api/guest/cleaning-request,
// which drops a GUEST_CLEANING_REQUEST notification to the configured roles.
const FIELDS = [
  { key: 'name', label: 'Name', placeholder: 'Your full name' },
  { key: 'employeeId', label: 'Employee ID', placeholder: 'e.g. EMP-001' },
  { key: 'block', label: 'Block', placeholder: 'Block' },
  { key: 'area', label: 'Area', placeholder: 'Area' },
  { key: 'ahu', label: 'AHU', placeholder: 'AHU' },
  { key: 'filter', label: 'Filter', placeholder: 'Filter' },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

export function GuestRequestPage() {
  const [form, setForm] = useState<Record<FieldKey, string>>({ name: '', employeeId: '', block: '', area: '', ahu: '', filter: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const allFilled = FIELDS.every((f) => form[f.key].trim().length > 0);
  const set = (k: FieldKey, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const base = getApiBase();

  const submit = async () => {
    if (!allFilled || submitting) return;
    setSubmitting(true); setError('');
    try {
      const payload = Object.fromEntries(FIELDS.map((f) => [f.key, form[f.key].trim()]));
      const res = await fetch(`${base}/api/guest/cleaning-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || `Request failed (HTTP ${res.status})`);
      }
      setDone(true);
    } catch (e: any) {
      setError(e?.message || 'Could not submit your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Filter cleaning request"
      description={done ? undefined : 'Guest request. Fill in every field, then send it.'}
      backToLogin
    >
      {done ? (
        <div className="space-y-5">
          <AuthSuccess title="Request sent">Your filter cleaning request has been sent.</AuthSuccess>
          <a href="/login" className="flex h-11 w-full items-center justify-center rounded-lg bg-brand-600 text-sm font-medium text-white hover:bg-brand-700">
            Back to sign in
          </a>
        </div>
      ) : (
        <div className="space-y-4">
          {error && <AuthError>{error}</AuthError>}
          {FIELDS.map((f) => (
            <label key={f.key} className="block">
              <span className="mb-1.5 block text-sm font-medium text-slate-700">{f.label} <span className="text-red-600">*</span></span>
              <Input
                type="text"
                value={form[f.key]}
                onChange={(e) => set(f.key, e.target.value)}
                placeholder={f.placeholder}
                maxLength={f.key === 'employeeId' ? 60 : 120}
                className="h-11"
              />
            </label>
          ))}
          <Button onClick={submit} disabled={!allFilled || submitting} className="h-11 w-full">
            {submitting ? 'Sending…' : 'Send request'}
          </Button>
        </div>
      )}
    </AuthShell>
  );
}
