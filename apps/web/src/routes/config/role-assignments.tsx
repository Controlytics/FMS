import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { themeButton } from '@/lib/theme-styles';

// One page that gathers every "who-does-what" role assignment across the app:
// PM Schedule workflow, Block Change approval, QNN visibility, Guest requests.
// Each section reads/writes its own config key via /api/config/dynamic/<key>.

const CONFIG_KEYS = ['pm-schedule-approval', 'replacement-schedule-approval', 'qnn-notifications', 'guest-cleaning-requests'] as const;
type CfgKey = (typeof CONFIG_KEYS)[number];

function useRoleOptions(): string[] {
  const { data } = useSWR<any>('/api/roles/active');
  const raw = Array.isArray(data) ? data : (data?.data ?? []);
  return raw.map((r: any) => (typeof r === 'string' ? r : r.name ?? r.value ?? '')).filter(Boolean);
}

export function RoleAssignmentsPage() {
  const { toast } = useToast();
  const roles = useRoleOptions();
  const [cfg, setCfg] = useState<Record<CfgKey, Record<string, any>>>({
    'pm-schedule-approval': {}, 'replacement-schedule-approval': {}, 'qnn-notifications': {}, 'guest-cleaning-requests': {},
  });
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const entries = await Promise.all(CONFIG_KEYS.map(async (k) => {
        try { return [k, (await apiClient.get<any>(`/api/config/dynamic/${k}`)) ?? {}] as const; }
        catch { return [k, {}] as const; }
      }));
      if (!alive) return;
      setCfg(Object.fromEntries(entries) as Record<CfgKey, Record<string, any>>);
      setLoaded(true);
    })();
    return () => { alive = false; };
  }, []);

  const patch = (key: CfgKey, field: string, value: any) =>
    setCfg((p) => ({ ...p, [key]: { ...p[key], [field]: value } }));

  const toggleArr = (key: CfgKey, field: string, role: string) => {
    const cur: string[] = Array.isArray(cfg[key]?.[field]) ? cfg[key][field] : [];
    patch(key, field, cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]);
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      await Promise.all(CONFIG_KEYS.map((k) => apiClient.put(`/api/config/dynamic/${k}`, cfg[k])));
      toast.success('Saved', 'Role assignments updated.');
    } catch (e: any) {
      toast.error('Save failed', e?.message ?? 'Could not save role assignments.');
    } finally { setSaving(false); }
  };

  if (!loaded) return <div className="p-6 text-sm text-slate-400">Loading…</div>;

  const RoleSelect = ({ k, field, label, allowBlank = true, blankLabel = 'Anyone with permission' }: { k: CfgKey; field: string; label: string; allowBlank?: boolean; blankLabel?: string }) => (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <select value={cfg[k]?.[field] ?? ''} onChange={(e) => patch(k, field, e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-cyan-500/30">
        {allowBlank && <option value="">{blankLabel}</option>}
        {roles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </label>
  );

  const RoleChecks = ({ k, field }: { k: CfgKey; field: string }) => {
    const sel: string[] = Array.isArray(cfg[k]?.[field]) ? cfg[k][field] : [];
    return (
      <div className="flex flex-wrap gap-3 border border-slate-200 rounded-lg p-3">
        {roles.length === 0 && <span className="text-sm text-slate-400">No roles</span>}
        {roles.map((r) => (
          <label key={r} className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer">
            <input type="checkbox" checked={sel.includes(r)} onChange={() => toggleArr(k, field, r)}
              className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
            {r}
          </label>
        ))}
      </div>
    );
  };

  const Toggle = ({ k, field, label }: { k: CfgKey; field: string; label: string }) => (
    <label className="flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={cfg[k]?.[field] === true} onChange={(e) => patch(k, field, e.target.checked)}
        className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
      <span className="text-sm text-slate-600">{label}</span>
    </label>
  );

  const Section = ({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) => (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3 shadow-sm">
      <div>
        <h2 className="text-sm font-bold text-slate-800">{title}</h2>
        <p className="text-xs text-slate-500">{desc}</p>
      </div>
      {children}
    </div>
  );

  return (
    <div className="p-6 space-y-5 max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Role Assignments</h1>
          <p className="text-sm text-slate-500 mt-0.5">All "who does / who receives" role settings in one place. Super Admin always has access.</p>
        </div>
        <button onClick={saveAll} disabled={saving} className="px-4 py-2.5 text-white rounded-xl text-sm font-semibold shadow-sm disabled:opacity-50" style={themeButton}>
          {saving ? 'Saving…' : 'Save All'}
        </button>
      </div>

      <Section title="PM Schedule Workflow" desc="Who uploads, reviews, and approves PM schedules.">
        <Toggle k="pm-schedule-approval" field="workflowEnabled" label="Enable review + approval workflow" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <RoleSelect k="pm-schedule-approval" field="uploadRole" label="Upload" />
          <RoleSelect k="pm-schedule-approval" field="reviewRole" label="Review" />
          <RoleSelect k="pm-schedule-approval" field="approvalRole" label="Approve" />
        </div>
      </Section>

      <Section title="Replacement Schedule Workflow" desc="Who uploads, reviews, and approves replacement schedules. Leave a field on 'Inherit from PM' to reuse the PM Schedule Workflow setting above.">
        {(() => {
          const rsWf = cfg['replacement-schedule-approval']?.workflowEnabled;
          const pmWf = cfg['pm-schedule-approval']?.workflowEnabled === true;
          const inheriting = typeof rsWf !== 'boolean';
          const effective = inheriting ? pmWf : rsWf === true;
          return (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={effective}
                onChange={(e) => patch('replacement-schedule-approval', 'workflowEnabled', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
              <span className="text-sm text-slate-600">
                Enable review + approval workflow
                {inheriting && <span className="ml-1.5 text-xs text-slate-400">(inheriting from PM)</span>}
              </span>
            </label>
          );
        })()}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <RoleSelect k="replacement-schedule-approval" field="uploadRole" label="Upload" blankLabel="Inherit from PM" />
          <RoleSelect k="replacement-schedule-approval" field="reviewRole" label="Review" blankLabel="Inherit from PM" />
          <RoleSelect k="replacement-schedule-approval" field="approvalRole" label="Approve" blankLabel="Inherit from PM" />
        </div>
      </Section>

      <Section title="QNN Notifications" desc="Which roles see Quality Notification (QNN) entries.">
        <RoleChecks k="qnn-notifications" field="visibleRoles" />
      </Section>

      <Section title="Guest Cleaning Requests" desc="Which roles receive guest filter-cleaning requests from the login page.">
        <RoleChecks k="guest-cleaning-requests" field="recipientRoles" />
      </Section>
    </div>
  );
}
