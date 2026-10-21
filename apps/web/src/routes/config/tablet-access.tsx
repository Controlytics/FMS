import { useState, useEffect } from 'react';
import useSWR, { mutate } from 'swr';
import { apiClient } from '../../lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { useAuth } from '@/hooks/use-auth';
import { PageHeader } from '@/components/ui/page-header';

const FEATURES = [
  { key: 'login', label: 'Login', description: 'Allow this role to log into the tablet app' },
  { key: 'filter_cleaning', label: 'Filter Cleaning', description: 'Start/advance cleaning cycles, scan filters' },
  { key: 'filter_status', label: 'Filter Status', description: 'View current filter states and cleaning progress' },
  { key: 'my_tasks', label: 'My Tasks', description: 'View PM schedule tasks and due filters' },
  // 2026-09-02. Deliberately NOT the retired `approvals` key (removed 2026-08-10):
  // that one meant block-change approvals plus a read-only stage list, and reusing
  // the name would resurrect a key whose meaning has changed. Grants the tablet
  // screen only — the backend still requires STAGE_APPROVAL_VIEW / _DECIDE.
  { key: 'stage_approvals', label: 'Stage Approvals', description: 'Approve or reject cleaning stages held at the Wash Out / Dry Out QA interlock' },
  { key: 'rfid_assign', label: 'RFID Assign', description: 'Assign or remove RFID tags on filters from the tablet' },
  { key: 'logout', label: 'Logout', description: 'Allow logout from the tablet app' },
];

type TabletConfig = Record<string, string[]>;

export function TabletAccessConfigPage() {
  const { toast } = useToast();
  const reauth = useReauth();
  // C-02: the route admits CONFIG_READ, but the PUT needs CONFIG_UPDATE (plus
  // the UPDATE_TABLET_ACCESS signature). A read-only role used to get live
  // toggles and a Save that asked for a password and then answered 403.
  const { user } = useAuth();
  const canWrite = user?.role === 'SUPER_ADMIN'
    || ((user?.permissions as string[] | undefined) ?? []).includes('CONFIG_UPDATE');
  const { data: config, isLoading } = useSWR('/api/config/tablet-access');
  // Audit 2026-09-24: /api/roles needs ROLE_READ, which an ADMIN opening this
  // page (CONFIG_READ) does not hold — the page rendered an empty role list
  // behind a 403. The active-roles feed is what every logged-in user may read.
  const { data: rolesData } = useSWR('/api/roles/active', { revalidateOnMount: true, dedupingInterval: 0 });
  const [localConfig, setLocalConfig] = useState<TabletConfig>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const roles: Array<{ name: string; displayName: string }> = Array.isArray(rolesData)
    ? rolesData.map((r: any) => ({ name: r.name, displayName: r.displayName || r.name }))
    : [];

  useEffect(() => {
    if (config && typeof config === 'object') {
      setLocalConfig(config as TabletConfig);
      setDirty(false);
    }
  }, [config]);

  const toggle = (role: string, feature: string) => {
    if (!canWrite) return;
    setLocalConfig(prev => {
      const current = prev[role] ?? [];
      const has = current.includes(feature);

      // If disabling login, disable all other features too
      if (feature === 'login' && has) {
        return { ...prev, [role]: [] };
      }
      // If enabling any feature, also enable login
      if (!has && feature !== 'login' && !current.includes('login')) {
        return { ...prev, [role]: [...current, 'login', feature] };
      }

      const updated = has ? current.filter(f => f !== feature) : [...current, feature];
      return { ...prev, [role]: updated };
    });
    setDirty(true);
  };

  const toggleAll = (role: string) => {
    if (!canWrite) return;
    setLocalConfig(prev => {
      const current = prev[role] ?? [];
      const allEnabled = FEATURES.every(f => current.includes(f.key));
      return { ...prev, [role]: allEnabled ? [] : FEATURES.map(f => f.key) };
    });
    setDirty(true);
  };

  const save = async () => {
    if (!canWrite) return;
    setSaving(true);
    try {
      // 2026-08-10: drop feature keys that no longer exist before saving.
      // `localConfig` is the server's stored value verbatim, so a retired key
      // (e.g. 'approvals', removed with the tablet Approvals screen) would be
      // written straight back on every save and linger forever. Sanitising here
      // makes the stored config self-heal on the next save, through the normal
      // audited PUT rather than a manual DB edit.
      const known = new Set(FEATURES.map(f => f.key));
      const cleaned: TabletConfig = Object.fromEntries(
        Object.entries(localConfig).map(([role, feats]) => [role, (feats ?? []).filter(f => known.has(f))]),
      );
      // Signed: the backend gates this on UPDATE_TABLET_ACCESS
      // (enforceReauthAlways), because it decides which roles may log in on the
      // tablet at all. `saving` is cleared on EVERY exit — including a
      // dismissed password prompt (onCancel, which says nothing); without that
      // the button would stick on "Saving…".
      await reauth.execute(
        'UPDATE_TABLET_ACCESS',
        async (password?: string) => {
          if (password) await apiClient.putWithReauth('/api/config/tablet-access', cleaned, password);
          else await apiClient.put('/api/config/tablet-access', cleaned);
        },
        {
          onSuccess: () => {
            mutate('/api/config/tablet-access');
            toast.success('Saved', 'Tablet access configuration updated');
            setDirty(false);
            setSaving(false);
          },
          onError: (e: any) => {
            toast.error('Error', e?.message ?? 'Failed to save');
            setSaving(false);
          },
          onCancel: () => setSaving(false),
        },
      );
    } catch (e: any) {
      toast.error('Error', e?.message ?? 'Failed to save');
      setSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header */}
      <PageHeader
        title="Tablet App Access Control"
        subtitle="Configure which roles can access tablet features"
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />}
        actions={
          <>
            {dirty && <span className="text-xs text-amber-600 font-medium">Unsaved changes</span>}
            <button onClick={save} disabled={!canWrite || saving || !dirty}
              title={!canWrite ? 'Read-only: changing tablet access needs the CONFIG_UPDATE permission' : undefined}
              className="px-5 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-semibold shadow-xs disabled:opacity-50 hover:bg-brand-700 transition-colors">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </>
        }
      />

      {!canWrite && (
        <div role="note" className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-[13px] text-amber-800">
          Read-only. Your role can view tablet access but not change it. Changing it needs the CONFIG_UPDATE permission.
        </div>
      )}

      {/* Matrix Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="h-10 px-4 py-2.5 text-left text-xs font-semibold text-slate-600 whitespace-nowrap w-44">Role</th>
              {FEATURES.map(f => (
                <th key={f.key} className="h-10 px-3 py-2.5 text-center text-xs font-semibold text-slate-600 align-top">
                  <div className="whitespace-nowrap">{f.label}</div>
                  <div className="font-normal normal-case text-[11px] text-slate-400 mt-0.5 tracking-normal">{f.description}</div>
                </th>
              ))}
              <th className="h-10 px-3 py-2.5 text-center text-xs font-semibold text-slate-600 whitespace-nowrap align-top">All</th>
            </tr>
          </thead>
          <tbody>
            {roles.map(role => {
              const features = localConfig[role.name] ?? [];
              const allEnabled = FEATURES.every(f => features.includes(f.key));
              const loginDisabled = !features.includes('login');

              return (
                <tr key={role.name} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-2.5 text-slate-700">
                    <div className="text-[13px] font-bold text-slate-800">{role.displayName}</div>
                    <div className="text-[11px] text-slate-400 font-mono">{role.name}</div>
                  </td>
                  {FEATURES.map(f => {
                    const enabled = features.includes(f.key);
                    const isLogin = f.key === 'login';
                    const isDisabledByLogin = !isLogin && loginDisabled;

                    return (
                      <td key={f.key} className="text-center px-3 py-2.5">
                        <button
                          onClick={() => toggle(role.name, f.key)}
                          disabled={!canWrite || isDisabledByLogin}
                          aria-label={`${f.label} for ${role.displayName}`}
                          aria-pressed={enabled}
                          className={`w-10 h-6 rounded-full relative transition-all disabled:cursor-not-allowed disabled:opacity-70 ${
                            enabled
                              ? isLogin ? 'bg-cyan-500' : 'bg-emerald-500'
                              : isDisabledByLogin ? 'bg-slate-100 cursor-not-allowed' : 'bg-slate-200'
                          }`}
                        >
                          <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${
                            enabled ? 'left-[18px]' : 'left-0.5'
                          }`} />
                        </button>
                      </td>
                    );
                  })}
                  <td className="text-center px-3 py-2.5">
                    <button onClick={() => toggleAll(role.name)} disabled={!canWrite}
                      aria-label={`All features for ${role.displayName}`} aria-pressed={allEnabled}
                      className={`w-10 h-6 rounded-full relative transition-all disabled:cursor-not-allowed disabled:opacity-70 ${allEnabled ? 'bg-cyan-500' : 'bg-slate-200'}`}>
                      <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all ${allEnabled ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Info */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-[12px] text-slate-500 space-y-1.5">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>Disabling <strong>Login</strong> for a role prevents that role from accessing the tablet app entirely.</span>
        </div>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>Features are hidden from the tablet home screen when disabled. The desktop application is not affected.</span>
        </div>
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <span>Changes take effect immediately — users must refresh or re-login on the tablet to see updates.</span>
        </div>
      </div>

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel={reauth.pendingActionLabel ?? 'Update Tablet Access'}
      />
    </div>
  );
}
