import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

type Matrix = Record<string, boolean>; // role -> enabled

interface Role { name: string; displayName: string; }

export function ReplacementScheduleFiltersPage() {
  const { toast } = useToast();
  const { data: matrixData, mutate } = useSWR<Matrix>('/api/config/replacement-schedule-filters');
  const { data: rolesData } = useSWR<Role[]>('/api/roles/active');

  const [draft, setDraft] = useState<Matrix>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (matrixData) setDraft(matrixData); }, [matrixData]);

  // SUPER_ADMIN always sees the filters — not editable here.
  const roles = useMemo(() => (rolesData ?? []).filter((r) => r.name !== 'SUPER_ADMIN'), [rolesData]);

  const enabled = (role: string) => !!draft[role];
  const toggle = (role: string) => setDraft((d) => ({ ...d, [role]: !d[role] }));

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put('/api/config/replacement-schedule-filters', draft);
      await mutate(draft, false);
      toast.success('Saved', 'Replacement-schedule AHU filter visibility updated.');
    } catch (err: any) {
      toast.error('Save failed', err?.message ?? 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-[760px] mx-auto">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Replacement Schedule — AHU Filters</h1>
          <p className="text-sm text-slate-500 mt-1">
            When enabled, users of that role can expand an AHU on the Replacement Schedule page to see the
            filters under it. Disabled (default) hides them. SUPER_ADMIN always sees them.
          </p>
        </div>
        <button onClick={save} disabled={saving}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-teal-500 to-cyan-600 shadow-sm disabled:opacity-50">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {roles.length === 0 ? (
        <div className="text-sm text-slate-400 py-12 text-center">No roles to configure.</div>
      ) : (
        <div className="border border-slate-200 rounded-xl bg-white divide-y divide-slate-100">
          {roles.map((r) => (
            <div key={r.name} className="flex items-center justify-between px-4 py-3">
              <div className="text-[14px] font-medium text-slate-700">{r.displayName || r.name}</div>
              <button onClick={() => toggle(r.name)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${enabled(r.name) ? 'bg-emerald-500' : 'bg-slate-300'}`}
                aria-pressed={enabled(r.name)}>
                <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${enabled(r.name) ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
