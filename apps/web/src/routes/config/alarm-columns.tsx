import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { ALARM_COLUMN_DEFINITIONS, ALL_ALARM_COLUMN_IDS } from '@digilog/shared';
import type { RoleData } from '@digilog/shared';

export function AlarmColumnsConfigPage() {
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [enabledColumns, setEnabledColumns] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Fetch dynamic roles from API
  const { data: rolesData } = useSWR<RoleData[]>('/api/roles/active', { revalidateOnMount: true, dedupingInterval: 0 });
  const allRoles = rolesData || [];

  // Set default selected role when roles load
  useEffect(() => {
    if (allRoles.length > 0 && !selectedRole) {
      const admin = allRoles.find(r => r.name === 'ADMIN');
      setSelectedRole(admin?.name || allRoles[0].name);
    }
  }, [allRoles, selectedRole]);

  // Fetch full alarm-columns config
  const { data: alarmColumnsConfig } = useSWR<Record<string, string[]>>(
    '/api/config/alarm-columns',
    { revalidateOnMount: true, dedupingInterval: 0 }
  );

  // Update enabled columns when role or config changes
  useEffect(() => {
    if (selectedRole && alarmColumnsConfig !== undefined) {
      const roleColumns = alarmColumnsConfig[selectedRole];
      setEnabledColumns(roleColumns ?? ALL_ALARM_COLUMN_IDS);
      setDirty(false);
      setIsTransitioning(false);
    }
  }, [selectedRole, alarmColumnsConfig]);

  const handleRoleChange = useCallback((role: string) => {
    if (role !== selectedRole) {
      setIsTransitioning(true);
      setEnabledColumns([]);
      setDirty(false);
      setSelectedRole(role);
    }
  }, [selectedRole]);

  const toggleColumn = (colId: string) => {
    setEnabledColumns(prev => {
      if (prev.includes(colId)) {
        return prev.filter(id => id !== colId);
      }
      return [...prev, colId];
    });
    setDirty(true);
  };

  const enableAll = () => {
    setEnabledColumns(ALL_ALARM_COLUMN_IDS);
    setDirty(true);
  };

  const disableAll = () => {
    setEnabledColumns([]);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = { ...(alarmColumnsConfig ?? {}), [selectedRole]: enabledColumns };
      await api.put('/api/config/alarm-columns', updated);
      mutate('/api/config/alarm-columns');
      setDirty(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const isLoading = isTransitioning;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/config" className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 transition-colors">
            <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="p-3 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-600 shadow-lg shadow-rose-500/25">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Alarm Column Visibility</h1>
            <p className="text-sm text-slate-500 mt-0.5">Configure which alarm columns are visible per role</p>
          </div>
        </div>
      </div>

      {/* Role Selector */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <h2 className="text-sm font-semibold text-slate-700">Select Role</h2>
        </div>
        <div className="p-6">
          <div className="flex flex-wrap gap-2">
            {allRoles.map((role) => (
              <button
                key={role.name}
                onClick={() => handleRoleChange(role.name)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  selectedRole === role.name
                    ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white shadow-lg shadow-rose-500/25'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {role.displayName || role.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Column Grid */}
      {selectedRole && (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-700">
                Alarm Columns for{' '}
                <Badge className="bg-gradient-to-r from-rose-500 to-pink-600 text-white text-xs border-0 ml-1">
                  {allRoles.find(r => r.name === selectedRole)?.displayName || selectedRole}
                </Badge>
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                {enabledColumns.length} of {ALARM_COLUMN_DEFINITIONS.length} columns visible
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={enableAll} className="text-xs">
                Enable All
              </Button>
              <Button variant="outline" size="sm" onClick={disableAll} className="text-xs">
                Disable All
              </Button>
            </div>
          </div>
          <div className="p-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-8 h-8 border-4 border-slate-200 border-t-rose-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ALARM_COLUMN_DEFINITIONS.map((col) => {
                  const isEnabled = enabledColumns.includes(col.id);
                  return (
                    <div
                      key={col.id}
                      onClick={() => toggleColumn(col.id)}
                      className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
                        isEnabled
                          ? 'bg-rose-50 border-rose-300 shadow-md'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h3 className={`text-sm font-semibold ${isEnabled ? 'text-rose-700' : 'text-slate-600'}`}>
                            {col.label}
                          </h3>
                          <p className="text-xs text-slate-500 mt-1">{col.description}</p>
                        </div>
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ml-3 ${
                          isEnabled
                            ? 'bg-gradient-to-r from-rose-500 to-pink-600 text-white'
                            : 'bg-slate-200 text-transparent'
                        }`}>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Save Button */}
            {dirty && (
              <div className="flex items-center justify-end mt-6 pt-4 border-t border-slate-100">
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white shadow-lg shadow-rose-500/25 gap-2"
                >
                  {saving ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      Saving...
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
