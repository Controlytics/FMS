import { useEffect, useMemo, useState } from 'react';
import { useReauth, isReauthCancelled } from '@/hooks/use-reauth';
import { ReauthPrompt } from '@/components/reauth-prompt';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { EXPORT_SURFACES, type ExportFormat } from '@/lib/export-surfaces';

type Matrix = Record<string, Record<string, string>>; // role -> surfaceKey -> format

interface Role { name: string; displayName: string; }

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: 'BOTH', label: 'Both' },
  { value: 'PDF', label: 'PDF only' },
  { value: 'EXCEL', label: 'Excel only' },
  { value: 'NONE', label: 'None' },
];

const FMT_CLS: Record<string, string> = {
  BOTH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PDF: 'bg-sky-50 text-sky-700 border-sky-200',
  EXCEL: 'bg-amber-50 text-amber-700 border-amber-200',
  NONE: 'bg-slate-100 text-slate-500 border-slate-200',
};

export function ExportOptionsPage() {
  const { toast } = useToast();
  const reauth = useReauth();
  const { data: matrixData, mutate } = useSWR<Matrix>('/api/config/export-options');
  const { data: rolesData } = useSWR<Role[]>('/api/roles/active', { revalidateOnMount: true, dedupingInterval: 0 });

  const [draft, setDraft] = useState<Matrix>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (matrixData) setDraft(matrixData); }, [matrixData]);

  // SUPER_ADMIN always gets both — not editable here.
  const roles = useMemo(() => (rolesData ?? []).filter((r) => r.name !== 'SUPER_ADMIN'), [rolesData]);

  const cell = (role: string, surface: string): string => draft[role]?.[surface] ?? 'BOTH';

  // Save enabled only when the draft differs from the saved matrix.
  //
  // The comparison is normalised over roles × surfaces using the same 'BOTH'
  // fallback the grid renders with, NOT a raw JSON.stringify of the two
  // objects: an unset cell is absent from the stored map but becomes an
  // explicit 'BOTH' in the draft as soon as it is changed and changed back. A
  // raw compare would leave the button enabled forever after that no-op.
  const dirty = roles.some((r) =>
    EXPORT_SURFACES.some(
      (s) => cell(r.name, s.key) !== (matrixData?.[r.name]?.[s.key] ?? 'BOTH'),
    ),
  );

  const setCell = (role: string, surface: string, value: string) =>
    setDraft((d) => ({ ...d, [role]: { ...(d[role] ?? {}), [surface]: value } }));

  const setWholeRole = (role: string, value: string) =>
    setDraft((d) => ({ ...d, [role]: Object.fromEntries(EXPORT_SURFACES.map((s) => [s.key, value])) }));

  const save = async () => {
    setSaving(true);
    try {
      // UPDATE_CONFIG_PAGE gates every configuration save (2026-09-24).
      await reauth.executeWithResult('UPDATE_CONFIG_PAGE', (pw) => pw
        ? apiClient.putWithReauth('/api/config/export-options', draft, pw)
        : apiClient.put('/api/config/export-options', draft));
      await mutate(draft, false);
      toast.success('Saved', 'Export options updated for all roles.');
    } catch (err: any) {
      if (isReauthCancelled(err)) return;
      toast.error('Save failed', err?.message ?? 'Could not save export options.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <ReauthPrompt reauth={reauth} />
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-slate-500 max-w-2xl">
          Choose which export formats each role can use on each page. Unset cells default to
          <span className="font-semibold text-emerald-700"> Both</span>. SUPER_ADMIN always has both.
        </p>
        <button onClick={save} disabled={saving || !dirty}
          className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-teal-500 to-cyan-600 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed">
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {roles.length === 0 ? (
        <div className="text-sm text-slate-400 py-12 text-center">No roles to configure.</div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl bg-white">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider sticky left-0 bg-slate-50">Page</th>
                {roles.map((r) => (
                  <th key={r.name} className="px-3 py-2 text-center min-w-[130px]">
                    <div className="text-[12px] font-bold text-slate-700">{r.displayName || r.name}</div>
                    <select value="" onChange={(e) => { if (e.target.value) setWholeRole(r.name, e.target.value); }}
                      className="mt-1 text-[10px] text-slate-400 bg-transparent border border-slate-200 rounded px-1 py-0.5 cursor-pointer">
                      <option value="">set all…</option>
                      {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {EXPORT_SURFACES.map((s) => (
                <tr key={s.key} className="hover:bg-slate-50/40">
                  <td className="px-4 py-2.5 text-[13px] font-medium text-slate-700 whitespace-nowrap sticky left-0 bg-white">{s.label}</td>
                  {roles.map((r) => {
                    const val = cell(r.name, s.key);
                    return (
                      <td key={r.name} className="px-3 py-2 text-center">
                        <select value={val} onChange={(e) => setCell(r.name, s.key, e.target.value)}
                          className={`text-[12px] font-semibold rounded-md border px-2 py-1 cursor-pointer outline-none ${FMT_CLS[val] ?? FMT_CLS.BOTH}`}>
                          {FORMATS.map((f) => <option key={f.value} value={f.value} className="bg-white text-slate-700">{f.label}</option>)}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
