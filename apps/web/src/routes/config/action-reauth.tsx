import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { REAUTH_ACTIONS, REAUTH_ACTION_CATEGORIES } from '@digilog/shared';
import type { ReauthAction, ReauthActionCategory } from '@digilog/shared';
import type { RoleData } from '@digilog/shared';

type ActionReauthConfig = Record<string, string[]>;

const CATEGORY_ICONS: Record<ReauthActionCategory, string> = {
  'User Management': 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
  'Configuration': 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  'Role Management': 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  'Backup': 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
  'Entity Management': 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
};

const CATEGORY_COLORS: Record<ReauthActionCategory, string> = {
  'User Management': 'from-blue-500 to-indigo-600',
  'Configuration': 'from-purple-500 to-pink-600',
  'Role Management': 'from-amber-500 to-orange-600',
  'Backup': 'from-red-500 to-rose-600',
  'Entity Management': 'from-emerald-500 to-teal-600',
};

// Group actions by category
const actionsByCategory = REAUTH_ACTION_CATEGORIES.map((category) => ({
  category,
  actions: (Object.entries(REAUTH_ACTIONS) as [ReauthAction, { label: string; category: string }][])
    .filter(([, v]) => v.category === category)
    .map(([key, v]) => ({ key, label: v.label })),
}));

export function ActionReauthPage() {
  const { data: config, isLoading: configLoading } = useSWR<ActionReauthConfig>('/api/config/action-reauth');
  const { data: rolesData, isLoading: rolesLoading } = useSWR<RoleData[]>('/api/roles/active');

  const [localConfig, setLocalConfig] = useState<ActionReauthConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Roles to show as columns (all roles including SUPER_ADMIN)
  const roles = useMemo(() => {
    if (!rolesData) return [];
    return rolesData
      .sort((a, b) => b.hierarchyLevel - a.hierarchyLevel);
  }, [rolesData]);

  // Current working config
  const currentConfig = localConfig ?? config ?? {};

  // Track if there are unsaved changes
  const hasChanges = localConfig !== null;

  const isChecked = (action: string, role: string): boolean => {
    return currentConfig[action]?.includes(role) ?? false;
  };

  const toggleAction = (action: string, role: string) => {
    const updated = { ...currentConfig };
    const roles = updated[action] ?? [];
    if (roles.includes(role)) {
      updated[action] = roles.filter((r) => r !== role);
      if (updated[action].length === 0) delete updated[action];
    } else {
      updated[action] = [...roles, role];
    }
    setLocalConfig(updated);
    setSaveMessage(null);
  };

  const selectAllCategory = (category: ReauthActionCategory) => {
    const updated = { ...currentConfig };
    const categoryActions = actionsByCategory.find((c) => c.category === category)?.actions ?? [];
    for (const { key } of categoryActions) {
      updated[key] = roles.map((r) => r.name);
    }
    setLocalConfig(updated);
    setSaveMessage(null);
  };

  const clearCategory = (category: ReauthActionCategory) => {
    const updated = { ...currentConfig };
    const categoryActions = actionsByCategory.find((c) => c.category === category)?.actions ?? [];
    for (const { key } of categoryActions) {
      delete updated[key];
    }
    setLocalConfig(updated);
    setSaveMessage(null);
  };

  const selectAllRole = (roleName: string) => {
    const updated = { ...currentConfig };
    const allActions = Object.keys(REAUTH_ACTIONS);
    for (const action of allActions) {
      const roles = updated[action] ?? [];
      if (!roles.includes(roleName)) {
        updated[action] = [...roles, roleName];
      }
    }
    setLocalConfig(updated);
    setSaveMessage(null);
  };

  const clearRole = (roleName: string) => {
    const updated = { ...currentConfig };
    for (const action of Object.keys(updated)) {
      updated[action] = (updated[action] ?? []).filter((r) => r !== roleName);
      if (updated[action].length === 0) delete updated[action];
    }
    setLocalConfig(updated);
    setSaveMessage(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveMessage(null);
    try {
      await api.put('/api/config/action-reauth', currentConfig);
      mutate('/api/config/action-reauth');
      mutate('/api/config/action-reauth/my-actions');
      setLocalConfig(null);
      setSaveMessage({ type: 'success', text: 'Action re-authentication settings saved successfully.' });
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message ?? 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLocalConfig(null);
    setSaveMessage(null);
  };

  const isLoading = configLoading || rolesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading configuration...
        </div>
      </div>
    );
  }

  // Count total configured actions
  const totalConfigured = Object.keys(currentConfig).filter((k) => (currentConfig[k]?.length ?? 0) > 0).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            to="/config"
            className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:shadow-md transition-all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="p-3 rounded-2xl bg-gradient-to-br from-red-500 to-orange-600 shadow-lg shadow-red-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
              Action Re-authentication
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Configure which actions require password verification per role
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {hasChanges && (
            <Badge className="bg-amber-100 text-amber-700 border-0 animate-pulse">Unsaved Changes</Badge>
          )}
          <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-0">
            {totalConfigured} action{totalConfigured !== 1 ? 's' : ''} configured
          </Badge>
        </div>
      </div>

      {/* Save Message */}
      {saveMessage && (
        <div
          className={`rounded-xl border p-4 text-sm ${
            saveMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d={
                  saveMessage.type === 'success'
                    ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                    : 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
                }
              />
            </svg>
            {saveMessage.text}
          </div>
        </div>
      )}

      {/* Info Banner */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 p-4">
        <div className="flex items-start gap-3">
          <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="text-sm text-blue-700">
            <p className="font-medium">How it works</p>
            <p className="mt-1">
              When a checked action is performed by a user with the corresponding role, they will be prompted to re-enter
              their password before the action is executed. Select the roles that should require re-authentication for each action.
            </p>
          </div>
        </div>
      </div>

      {/* Matrix Table */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
                <th className="text-left px-6 py-4 text-sm font-semibold text-slate-700 min-w-[280px]">Action</th>
                {roles.map((role) => (
                  <th key={role.name} className="px-3 py-4 text-center min-w-[100px]">
                    <div className="flex flex-col items-center gap-2">
                      <Badge
                        className="text-xs border-0 text-white shadow-sm"
                        style={{ background: role.color || '#64748b' }}
                      >
                        {role.displayName}
                      </Badge>
                      <div className="flex gap-1">
                        <button
                          onClick={() => selectAllRole(role.name)}
                          className="text-[10px] text-blue-600 hover:text-blue-800 font-medium hover:underline"
                        >
                          All
                        </button>
                        <span className="text-slate-300">|</span>
                        <button
                          onClick={() => clearRole(role.name)}
                          className="text-[10px] text-slate-400 hover:text-slate-600 font-medium hover:underline"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {actionsByCategory.map(({ category, actions }) => (
                <CategoryGroup
                  key={category}
                  category={category as ReauthActionCategory}
                  actions={actions}
                  roles={roles}
                  isChecked={isChecked}
                  onToggle={toggleAction}
                  onSelectAll={() => selectAllCategory(category as ReauthActionCategory)}
                  onClear={() => clearCategory(category as ReauthActionCategory)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 p-4 shadow-sm sticky bottom-4 border-t border-t-slate-100">
        <p className="text-sm text-slate-500">
          {hasChanges ? 'You have unsaved changes.' : 'All changes saved.'}
        </p>
        <div className="flex gap-3">
          {hasChanges && (
            <Button variant="outline" onClick={handleReset}>
              Discard Changes
            </Button>
          )}
          <Button onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CategoryGroup({
  category,
  actions,
  roles,
  isChecked,
  onToggle,
  onSelectAll,
  onClear,
}: {
  category: ReauthActionCategory;
  actions: { key: string; label: string }[];
  roles: RoleData[];
  isChecked: (action: string, role: string) => boolean;
  onToggle: (action: string, role: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <>
      {/* Category Header */}
      <tr className="bg-slate-50/80 border-y border-slate-100">
        <td className="px-6 py-3" colSpan={1}>
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${CATEGORY_COLORS[category]} shadow-sm`}>
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={CATEGORY_ICONS[category]} />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-700">{category}</span>
            <div className="flex gap-1 ml-2">
              <button
                onClick={onSelectAll}
                className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors"
              >
                Select All
              </button>
              <button
                onClick={onClear}
                className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 font-medium transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </td>
        <td colSpan={roles.length}></td>
      </tr>
      {/* Action Rows */}
      {actions.map(({ key, label }, idx) => (
        <tr
          key={key}
          className={`border-b border-slate-50 hover:bg-blue-50/30 transition-colors ${
            idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
          }`}
        >
          <td className="px-6 py-3">
            <span className="text-sm text-slate-700">{label}</span>
            <span className="text-xs text-slate-400 ml-2 font-mono">{key}</span>
          </td>
          {roles.map((role) => (
            <td key={role.name} className="px-3 py-3 text-center">
              <label className="inline-flex items-center justify-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={isChecked(key, role.name)}
                  onChange={() => onToggle(key, role.name)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500 focus:ring-offset-0 cursor-pointer transition-colors"
                />
              </label>
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
