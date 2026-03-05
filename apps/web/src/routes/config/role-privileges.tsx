import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { FEATURE_PRIVILEGES, FEATURE_PRIVILEGE_CATEGORIES } from '@digilog/shared';
import type { RoleData } from '@digilog/shared';

// Default icon for roles without a specific icon mapping


const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  'User Management': { bg: 'from-blue-500/10 to-indigo-500/10', border: 'border-blue-200', text: 'text-blue-700', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  'System': { bg: 'from-purple-500/10 to-pink-500/10', border: 'border-purple-200', text: 'text-purple-700', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  'Entity Management': { bg: 'from-teal-500/10 to-emerald-500/10', border: 'border-teal-200', text: 'text-teal-700', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
};

// Fallback for any category not explicitly styled — prevents crash when new categories are added
const DEFAULT_CATEGORY_COLOR = { bg: 'from-slate-500/10 to-gray-500/10', border: 'border-slate-200', text: 'text-slate-700', icon: 'M4 6h16M4 12h16M4 18h16' };
const getCategoryColor = (category: string) => CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLOR;

const DEFAULT_ROLE_ICON = 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z';

export function RolePrivilegesPage() {
  const [selectedRole, setSelectedRole] = useState<string>('ADMIN');
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Fetch dynamic roles from API — always revalidate on mount so newly created roles appear
  const { data: rolesData } = useSWR<RoleData[]>('/api/roles/active', { revalidateOnMount: true, dedupingInterval: 0 });

  // Build selectable roles list (all except SUPER_ADMIN), sorted by hierarchy level descending
  const selectableRoles = useMemo(() => {
    if (!rolesData) return [];
    return rolesData
      .filter(r => r.name !== 'SUPER_ADMIN')
      .sort((a, b) => b.hierarchyLevel - a.hierarchyLevel);
  }, [rolesData]);

  const { data: roleConfig, isLoading } = useSWR(`/api/config/roles/${selectedRole}`, {
    onSuccess: (data) => {
      setPermissions(data.permissions || {});
      setDirty(false);
    },
  });

  const togglePermission = (featureId: string) => {
    setPermissions(prev => ({
      ...prev,
      [featureId]: !prev[featureId],
    }));
    setDirty(true);
  };

  const toggleCategory = (category: string, value: boolean) => {
    const categoryFeatures = FEATURE_PRIVILEGE_CATEGORIES[category];
    const updates: Record<string, boolean> = {};
    categoryFeatures.forEach(f => {
      updates[f.id] = value;
    });
    setPermissions(prev => ({ ...prev, ...updates }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/api/config/roles/${selectedRole}`, {
        permissions,
        sidebarItems: roleConfig?.sidebarItems || [],
        homeWidgets: roleConfig?.homeWidgets || [],
      });
      mutate(`/api/config/roles/${selectedRole}`);
      setDirty(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const isCategoryFullyEnabled = (category: string) => {
    return FEATURE_PRIVILEGE_CATEGORIES[category].every(f => permissions[f.id]);
  };

  const isCategoryPartiallyEnabled = (category: string) => {
    const enabled = FEATURE_PRIVILEGE_CATEGORIES[category].filter(f => permissions[f.id]).length;
    return enabled > 0 && enabled < FEATURE_PRIVILEGE_CATEGORIES[category].length;
  };

  const enabledCount = Object.values(permissions).filter(Boolean).length;
  const enabledPercentage = Math.round((enabledCount / FEATURE_PRIVILEGES.length) * 100);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Enhanced Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-500 via-orange-600 to-red-600 p-6 text-white shadow-2xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMiIvPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link
              to="/config"
              className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all duration-200 border border-white/10"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                  <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <div>
                  <h1 className="text-2xl font-bold">Role Privileges</h1>
                  <p className="text-amber-100/80 text-sm">Configure feature permissions for each role</p>
                </div>
              </div>
            </div>
          </div>
          {dirty && (
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-white text-orange-600 hover:bg-orange-50 shadow-lg font-semibold"
            >
              {saving ? (
                <>
                  <svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save Changes
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Role Selection Card */}
      <Card className="border-0 shadow-xl bg-gradient-to-br from-white via-white to-slate-50/50 overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-amber-500 via-orange-500 to-red-500" />
        <CardContent className="p-6">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <div>
              <h3 className="font-bold text-slate-800">Select Role to Configure</h3>
              <p className="text-xs text-slate-500">Choose a role to manage its permissions</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
            {selectableRoles.map((role) => {
              const color = role.color || '#64748b';
              const roleGradient = 'from-slate-500 to-slate-600';
              return (
                <button
                  key={role.name}
                  onClick={() => { setSelectedRole(role.name); setDirty(false); }}
                  className={`relative group p-4 rounded-2xl border-2 transition-all duration-300 ${
                    selectedRole === role.name
                      ? 'border-transparent shadow-xl scale-[1.02]'
                      : 'border-slate-200 hover:border-slate-300 hover:shadow-lg'
                  }`}
                >
                  {selectedRole === role.name && (
                    <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${roleGradient} opacity-10`} />
                  )}
                  <div className="relative">
                    <div
                      className={`w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3 transition-all ${
                        selectedRole === role.name
                          ? 'text-white shadow-lg'
                          : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                      }`}
                      style={selectedRole === role.name ? { background: color } : undefined}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={DEFAULT_ROLE_ICON} />
                      </svg>
                    </div>
                    <p className={`text-sm font-semibold text-center ${
                      selectedRole === role.name ? 'text-slate-800' : 'text-slate-600'
                    }`}>
                      {role.displayName}
                    </p>
                    {selectedRole === role.name && (
                      <div className="absolute -top-1 -right-1">
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center shadow-lg"
                          style={{ background: color }}
                        >
                          <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>

          {/* Super Admin Notice */}
          <div className="mt-5 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/50">
            <div className="flex items-center gap-3 text-amber-800">
              <div className="p-2 rounded-lg bg-amber-100">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="text-sm">
                <span className="font-semibold">Note:</span> Super Admin has all permissions by default and cannot be modified.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Selected Role Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="h-1" style={{ background: selectableRoles.find(r => r.name === selectedRole)?.color || '#64748b' }} />
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg"
                style={{ background: selectableRoles.find(r => r.name === selectedRole)?.color || '#64748b' }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={DEFAULT_ROLE_ICON} />
                </svg>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Selected Role</p>
                <p className="text-xl font-bold text-slate-800">{selectableRoles.find(r => r.name === selectedRole)?.displayName || selectedRole}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-emerald-500 to-green-500" />
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white shadow-lg">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Enabled</p>
                <p className="text-xl font-bold text-slate-800">{enabledCount} <span className="text-sm font-normal text-slate-400">/ {FEATURE_PRIVILEGES.length}</span></p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-0 shadow-lg overflow-hidden">
          <div className="h-1 bg-gradient-to-r from-blue-500 to-indigo-500" />
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white shadow-lg">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Access Level</p>
                  <p className="text-xl font-bold text-slate-800">{enabledPercentage}%</p>
                </div>
              </div>
              <div className="w-16 h-16">
                <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                  <path
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="3"
                  />
                  <path
                    d="M18 2.0845
                      a 15.9155 15.9155 0 0 1 0 31.831
                      a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="url(#gradient)"
                    strokeWidth="3"
                    strokeDasharray={`${enabledPercentage}, 100`}
                    strokeLinecap="round"
                  />
                  <defs>
                    <linearGradient id="gradient">
                      <stop offset="0%" stopColor="#3b82f6" />
                      <stop offset="100%" stopColor="#6366f1" />
                    </linearGradient>
                  </defs>
                </svg>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Permissions Grid */}
      <Card className="border-0 shadow-xl overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-16 text-center">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-amber-500 to-orange-600 mb-4 animate-pulse">
                <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
              </div>
              <p className="text-slate-600 font-medium">Loading permissions...</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {Object.entries(FEATURE_PRIVILEGE_CATEGORIES).map(([category, features]) => {
                const categoryConfig = getCategoryColor(category);
                const enabledInCategory = features.filter(f => permissions[f.id]).length;

                return (
                  <div key={category} className="p-6">
                    {/* Category Header */}
                    <div className="flex items-center justify-between mb-5">
                      <div className="flex items-center gap-3">
                        <div className={`p-2.5 rounded-xl bg-gradient-to-br ${categoryConfig.bg} ${categoryConfig.border} border`}>
                          <svg className={`w-5 h-5 ${categoryConfig.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={categoryConfig.icon} />
                          </svg>
                        </div>
                        <div>
                          <h3 className="font-bold text-slate-800">{category}</h3>
                          <p className="text-xs text-slate-500">
                            {enabledInCategory} of {features.length} permissions enabled
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleCategory(category, true)}
                          disabled={isCategoryFullyEnabled(category)}
                          className="rounded-lg text-xs hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200"
                        >
                          <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Enable All
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => toggleCategory(category, false)}
                          disabled={!isCategoryPartiallyEnabled(category) && !isCategoryFullyEnabled(category)}
                          className="rounded-lg text-xs hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                        >
                          <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                          Disable All
                        </Button>
                      </div>
                    </div>

                    {/* Features Grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {features.map((feature) => (
                        <label
                          key={feature.id}
                          className={`group relative flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer ${
                            permissions[feature.id]
                              ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200 shadow-md'
                              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={permissions[feature.id] || false}
                            onChange={() => togglePermission(feature.id)}
                            className="sr-only"
                          />

                          {/* Custom Checkbox */}
                          <div className={`flex-shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                            permissions[feature.id]
                              ? 'bg-gradient-to-br from-emerald-500 to-green-600 border-emerald-500 shadow-md'
                              : 'bg-white border-slate-300 group-hover:border-slate-400'
                          }`}>
                            {permissions[feature.id] && (
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>

                          <span className={`flex-1 text-sm font-medium transition-colors ${
                            permissions[feature.id] ? 'text-emerald-800' : 'text-slate-600'
                          }`}>
                            {feature.label}
                          </span>

                          {permissions[feature.id] && (
                            <span className="flex-shrink-0 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 border border-amber-100/50 p-5">
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-full blur-3xl" />
        <div className="relative flex items-start gap-4">
          <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-amber-900 mb-1">Security Notice</h3>
            <p className="text-sm text-amber-700">
              Role permissions determine what actions users can perform in the application.
              Changes take effect immediately for all users with the selected role.
            </p>
            <div className="flex items-center gap-4 mt-3">
              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>21 CFR Part 11 compliant</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-amber-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>All changes are audit logged</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
