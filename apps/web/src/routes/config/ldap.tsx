import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { api } from '../../lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { PageHeader } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

interface RoleMappingRow {
  ldapGroup: string;
  role: string;
}

interface LdapConfig {
  enabled: boolean;
  serverUrl: string;
  bindDN: string;
  bindPassword: string;
  searchBase: string;
  searchFilter: string;
  usernameAttribute: string;
  emailAttribute: string;
  fullNameAttribute: string;
  departmentAttribute: string;
  groupAttribute: string;
  tlsRejectUnauthorized: boolean;
  connectionTimeout: number;
  roleMappings: RoleMappingRow[];
  defaultRole: string;
  syncAttributes: boolean;
}

const DEFAULTS: LdapConfig = {
  enabled: false,
  serverUrl: '',
  bindDN: '',
  bindPassword: '',
  searchBase: '',
  searchFilter: '(sAMAccountName={{username}})',
  usernameAttribute: 'sAMAccountName',
  emailAttribute: 'mail',
  fullNameAttribute: 'displayName',
  departmentAttribute: 'department',
  groupAttribute: 'memberOf',
  tlsRejectUnauthorized: false,
  connectionTimeout: 5000,
  roleMappings: [],
  defaultRole: 'OPERATOR',
  syncAttributes: true,
};

export default function LdapConfigPage() {
  // 2026-05-26 audit fix (PA-FE-1): gate Save / Test / Enable on CONFIG_UPDATE.
  // 2026-10-21: and every field. Only Save and Test were gated, so a read-only
  // role could flip Enable and edit every field of a form it can never save.
  const { user } = useAuth();
  const perms = (user?.permissions as string[] | undefined) ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canWrite = isSuperAdmin || perms.includes('CONFIG_UPDATE');
  const { data: savedConfig, mutate } = useSWR<LdapConfig>('/api/ldap/config');
  const { data: rolesData } = useSWR<Array<{ name: string; displayName: string }>>('/api/roles/active', { revalidateOnMount: true, dedupingInterval: 0 });
  const reauth = useReauth();

  const [config, setConfig] = useState<LdapConfig>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saveMsg, setSaveMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (savedConfig) setConfig({ ...DEFAULTS, ...savedConfig });
  }, [savedConfig]);

  const updateField = (key: keyof LdapConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  // Save enabled only when the form differs from what the server holds. The
  // saved side is built exactly the way the seeding effect above builds it
  // (`{...DEFAULTS, ...savedConfig}`), so key order and defaults line up and
  // the page never paints dirty before the config loads. Test Connection is
  // deliberately NOT gated on this — you may want to test the stored config.
  const savedLdap: LdapConfig = savedConfig ? { ...DEFAULTS, ...savedConfig } : DEFAULTS;
  const dirty = JSON.stringify(config) !== JSON.stringify(savedLdap);

  // Audit 2026-05-04 fix #5 (web-routes review H2): LDAP config edits
  // (bind credentials + base-DN) can redirect every login to an attacker-
  // controlled directory. Distinct UPDATE_LDAP_CONFIG action key (vs
  // UPDATE_LOGIN_SECURITY) so the audit trail makes the source-of-trust
  // change explicit.
  const handleSave = () => {
    setSaving(true);
    setSaveMsg(null);
    reauth.execute(
      'UPDATE_LDAP_CONFIG',
      async (password?: string) => {
        if (password) await api.putWithReauth('/api/ldap/config', config, password);
        else await api.put('/api/ldap/config', config);
      },
      {
        onSuccess: () => {
          mutate();
          setSaveMsg({ type: 'success', text: 'LDAP configuration saved successfully' });
          setTimeout(() => setSaveMsg(null), 5000);
          setSaving(false);
        },
        onError: (e: any) => {
          setSaveMsg({ type: 'error', text: e.message || 'Failed to save' });
          setSaving(false);
        },
        // Dismissing the password prompt is not a failure: free the button,
        // keep the edits, say nothing.
        onCancel: () => setSaving(false),
      },
    );
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<{ success: boolean; message: string }>('/api/ldap/test-connection', config);
      setTestResult(result);
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || 'Test failed' });
    }
    setTesting(false);
  };

  const addRoleMapping = () => {
    updateField('roleMappings', [...config.roleMappings, { ldapGroup: '', role: config.defaultRole }]);
  };

  const updateRoleMapping = (index: number, field: 'ldapGroup' | 'role', value: string) => {
    const updated = [...config.roleMappings];
    updated[index] = { ...updated[index], [field]: value };
    updateField('roleMappings', updated);
  };

  const removeRoleMapping = (index: number) => {
    updateField('roleMappings', config.roleMappings.filter((_, i) => i !== index));
  };

  return (
    <div className="p-6 space-y-6 animate-fade-in max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader
        title="LDAP / Active Directory"
        subtitle="Configure LDAP authentication and user provisioning"
        icon={<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />}
        back={
          <Link to="/config" aria-label="Back to configuration" className="p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </Link>
        }
        actions={
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${config.enabled ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
            <span className={`w-2 h-2 rounded-full ${config.enabled ? 'bg-emerald-500' : 'bg-slate-400'}`}></span>
            {config.enabled ? 'Enabled' : 'Disabled'}
          </span>
        }
      />

      {/* Messages */}
      {saveMsg && (
        <div className={`rounded-xl border p-4 text-sm flex items-center gap-2 ${saveMsg.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={saveMsg.type === 'success' ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z' : 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} /></svg>
          {saveMsg.text}
        </div>
      )}

      {/* Enable Toggle */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">Enable LDAP Authentication</h3>
            <p className="text-sm text-slate-500 mt-1">When enabled, users can authenticate via LDAP/Active Directory. Local authentication remains available for Super Admin.</p>
          </div>
          <button type="button" role="switch" aria-checked={config.enabled} aria-label="Enable LDAP authentication"
            onClick={() => updateField('enabled', !config.enabled)} disabled={!canWrite}
            title={!canWrite ? 'CONFIG_UPDATE permission required' : undefined}
            className={`relative w-14 h-7 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${config.enabled ? 'bg-emerald-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${config.enabled ? 'translate-x-7' : 'translate-x-0.5'}`}></span>
          </button>
        </div>
      </div>

      {/* Connection Settings */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101" /></svg>
            Connection Settings
          </h3>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Server URL <span className="text-red-500">*</span></label>
              <Input disabled={!canWrite} value={config.serverUrl} onChange={e => updateField('serverUrl', e.target.value)} placeholder="ldaps://ad.company.com:636"
                className="font-mono" />
              <p className="text-xs text-slate-400 mt-1">ldap:// connects, then upgrades with StartTLS (port 389); ldaps:// is TLS (port 636)</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Bind DN <span className="text-red-500">*</span></label>
              <Input disabled={!canWrite} value={config.bindDN} onChange={e => updateField('bindDN', e.target.value)} placeholder="CN=svc_digilog,OU=Service Accounts,DC=company,DC=com"
                className="font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Bind Password <span className="text-red-500">*</span></label>
              <input type="password" disabled={!canWrite} value={config.bindPassword} onChange={e => updateField('bindPassword', e.target.value)} placeholder="Service account password"
                className="w-full h-10 px-3 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 hover:border-slate-400 focus:outline-none focus:border-brand-600 focus:ring-3 focus:ring-brand-600/15 [@media(pointer:coarse)]:h-11 disabled:cursor-not-allowed disabled:opacity-60 disabled:bg-slate-50 disabled:hover:border-slate-300" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Connection Timeout (ms)</label>
              <Input disabled={!canWrite} type="number" value={config.connectionTimeout} onChange={e => updateField('connectionTimeout', Number(e.target.value))} />
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" disabled={!canWrite} checked={config.tlsRejectUnauthorized} onChange={e => updateField('tlsRejectUnauthorized', e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-green-600 focus:ring-brand-600/15" />
                <span className="text-sm text-slate-700">Verify TLS Certificate</span>
              </label>
            </div>
          </div>

          {/* Test Connection */}
          <div className="flex items-center gap-4 pt-2">
            <button onClick={handleTest} disabled={testing || !config.serverUrl || !canWrite}
              title={!canWrite ? 'CONFIG_UPDATE permission required' : undefined}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl text-sm font-medium hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 shadow-sm">
              {testing ? (
                <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>Testing...</>
              ) : (
                <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Test Connection</>
              )}
            </button>
            {testResult && (
              <span className={`text-sm font-medium ${testResult.success ? 'text-emerald-600' : 'text-red-600'}`}>
                {testResult.message}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Search Settings */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            User Search Settings
          </h3>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Search Base DN <span className="text-red-500">*</span></label>
            <Input disabled={!canWrite} value={config.searchBase} onChange={e => updateField('searchBase', e.target.value)} placeholder="OU=Users,DC=company,DC=com"
              className="font-mono" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Search Filter</label>
            <Input disabled={!canWrite} value={config.searchFilter} onChange={e => updateField('searchFilter', e.target.value)} placeholder="(sAMAccountName={{username}})"
              className="font-mono" />
            <p className="text-xs text-slate-400 mt-1">Use {'{{username}}'} as placeholder for the login username</p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Username Attribute</label>
              <Input disabled={!canWrite} value={config.usernameAttribute} onChange={e => updateField('usernameAttribute', e.target.value)}
                className="font-mono" />
              <p className="text-xs text-slate-400 mt-1">AD: sAMAccountName, OpenLDAP: uid</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Group Attribute</label>
              <Input disabled={!canWrite} value={config.groupAttribute} onChange={e => updateField('groupAttribute', e.target.value)}
                className="font-mono" />
            </div>
          </div>
        </div>
      </div>

      {/* Attribute Mapping */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" /></svg>
            Attribute Mapping
          </h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
              <Input disabled={!canWrite} value={config.fullNameAttribute} onChange={e => updateField('fullNameAttribute', e.target.value)}
                className="font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <Input disabled={!canWrite} value={config.emailAttribute} onChange={e => updateField('emailAttribute', e.target.value)}
                className="font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Department</label>
              <Input disabled={!canWrite} value={config.departmentAttribute} onChange={e => updateField('departmentAttribute', e.target.value)}
                className="font-mono" />
            </div>
          </div>
          <div className="mt-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" disabled={!canWrite} checked={config.syncAttributes} onChange={e => updateField('syncAttributes', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-green-600 focus:ring-brand-600/15" />
              <span className="text-sm text-slate-700">Sync attributes on every login</span>
            </label>
          </div>
        </div>
      </div>

      {/* Group-to-Role Mapping */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2">
              <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              Group-to-Role Mapping
            </h3>
            <button onClick={addRoleMapping} disabled={!canWrite} className="disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-green-50 text-green-700 rounded-lg hover:bg-green-100">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
              Add Mapping
            </button>
          </div>
        </div>
        <div className="p-6 space-y-3">
          {config.roleMappings.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-4">No group mappings configured. Users will be assigned the default role.</p>
          ) : (
            config.roleMappings.map((mapping, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="flex-1">
                  <Input disabled={!canWrite} value={mapping.ldapGroup} onChange={e => updateRoleMapping(i, 'ldapGroup', e.target.value)} placeholder="CN=Admins,OU=Groups,DC=company,DC=com"
                    className="font-mono" />
                </div>
                <svg className="w-5 h-5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                <Select disabled={!canWrite} value={mapping.role} onChange={e => updateRoleMapping(i, 'role', e.target.value)}
                  className="w-48">
                  {rolesData?.map(r => <option key={r.name} value={r.name}>{r.displayName}</option>)}
                </Select>
                <button onClick={() => removeRoleMapping(i)} disabled={!canWrite} className="disabled:opacity-50 disabled:cursor-not-allowed p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
            ))
          )}
          <div className="pt-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Default Role (when no group matches)</label>
            <Select disabled={!canWrite} value={config.defaultRole} onChange={e => updateField('defaultRole', e.target.value)}
              className="w-64">
              {rolesData?.map(r => <option key={r.name} value={r.name}>{r.displayName}</option>)}
            </Select>
          </div>
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end gap-3 pb-6">
        <Link to="/config">
          <button className="px-5 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
        </Link>
        <button onClick={handleSave} disabled={saving || !canWrite || !dirty}
          title={!canWrite ? 'CONFIG_UPDATE permission required' : undefined}
          className="inline-flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-xl text-sm font-medium hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 shadow-lg">
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={() => { reauth.cancel(); setSaving(false); }}
        actionLabel={reauth.pendingActionLabel ?? 'Update LDAP Configuration'}
      />
    </div>
  );
}
