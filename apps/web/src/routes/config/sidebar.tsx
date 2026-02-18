import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api-client';
import { SIDEBAR_ITEMS } from '@digilog/shared';
import type { RoleData } from '@digilog/shared';

interface User {
  id: string;
  username: string;
  fullName: string;
  role: string;
  status: string;
}

export function SidebarConfigPage() {
  const [activeTab, setActiveTab] = useState<'role' | 'user'>('role');
  const [selectedRole, setSelectedRole] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [enabledItems, setEnabledItems] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
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

  // Fetch users list
  const { data: usersData, isLoading: loadingUsers } = useSWR('/api/users?limit=100');

  // Fetch role config - use revalidateOnMount to force fresh data
  const { data: roleConfig, isLoading: loadingRoleConfig, isValidating: validatingRoleConfig } = useSWR(
    activeTab === 'role' ? `/api/config/roles/${selectedRole}` : null,
    {
      revalidateOnMount: true,
      dedupingInterval: 0, // Disable deduping to always fetch fresh data
      onSuccess: (data) => {
        setEnabledItems(data.sidebarItems || SIDEBAR_ITEMS.map(i => i.id));
        setDirty(false);
        setIsTransitioning(false);
      },
    }
  );

  // Fetch user config
  const { data: userConfig, isLoading: loadingUserConfig, isValidating: validatingUserConfig } = useSWR(
    activeTab === 'user' && selectedUser ? `/api/config/users/${selectedUser.id}` : null,
    {
      revalidateOnMount: true,
      dedupingInterval: 0,
      onSuccess: (data) => {
        setEnabledItems(data.sidebarItems || []);
        setDirty(false);
        setIsTransitioning(false);
      },
    }
  );

  // Handle role change - clear items immediately and set transitioning state
  const handleRoleChange = useCallback((role: string) => {
    if (role !== selectedRole) {
      setIsTransitioning(true);
      setEnabledItems([]); // Clear immediately to prevent showing stale data
      setDirty(false);
      setSelectedRole(role);
    }
  }, [selectedRole]);

  // Handle user change - clear items immediately
  const handleUserChange = useCallback((user: User) => {
    if (user.id !== selectedUser?.id) {
      setIsTransitioning(true);
      setEnabledItems([]);
      setDirty(false);
      setSelectedUser(user);
    }
  }, [selectedUser]);

  // Handle tab change - clear items immediately
  const handleTabChange = useCallback((tab: 'role' | 'user') => {
    if (tab !== activeTab) {
      setIsTransitioning(true);
      setEnabledItems([]);
      setDirty(false);
      setActiveTab(tab);
      // Reset selections when switching tabs
      if (tab === 'role') {
        setSelectedUser(null);
      }
    }
  }, [activeTab]);

  const toggleItem = (itemId: string) => {
    setEnabledItems(prev => {
      if (prev.includes(itemId)) {
        return prev.filter(id => id !== itemId);
      }
      return [...prev, itemId];
    });
    setDirty(true);
  };

  const handleSaveRole = async () => {
    setSaving(true);
    try {
      await api.put(`/api/config/roles/${selectedRole}`, {
        sidebarItems: enabledItems,
        homeWidgets: roleConfig?.homeWidgets || [],
        permissions: roleConfig?.permissions || {},
      });
      mutate(`/api/config/roles/${selectedRole}`);
      setDirty(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUser = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await api.put(`/api/config/users/${selectedUser.id}`, {
        sidebarItems: enabledItems,
        homeWidgets: userConfig?.homeWidgets || [],
        permissions: userConfig?.permissions || {},
      });
      mutate(`/api/config/users/${selectedUser.id}`);
      setDirty(false);
    } catch (error) {
      console.error('Failed to save:', error);
    } finally {
      setSaving(false);
    }
  };

  const enableAll = () => {
    setEnabledItems(SIDEBAR_ITEMS.map(i => i.id));
    setDirty(true);
  };

  const disableAll = () => {
    setEnabledItems([]);
    setDirty(true);
  };

  const resetUserToRoleDefault = async () => {
    if (!selectedUser) return;
    setSaving(true);
    try {
      await api.put(`/api/config/users/${selectedUser.id}`, {
        sidebarItems: [],
        homeWidgets: [],
        permissions: {},
      });
      mutate(`/api/config/users/${selectedUser.id}`);
      setEnabledItems([]);
      setDirty(false);
    } catch (error) {
      console.error('Failed to clear:', error);
    } finally {
      setSaving(false);
    }
  };

  // Filter users by search query
  const filteredUsers = usersData?.data?.filter((user: User) =>
    user.username.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.fullName.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Consider loading if either initial load, revalidating, or transitioning
  const isLoading = activeTab === 'role'
    ? (loadingRoleConfig || validatingRoleConfig || isTransitioning)
    : (loadingUserConfig || validatingUserConfig || isTransitioning);
  const handleSave = activeTab === 'role' ? handleSaveRole : handleSaveUser;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/config" className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </div>
              Sidebar Configuration
            </h1>
            <p className="text-sm text-slate-500 mt-1">Configure sidebar menu items by role or for specific users</p>
          </div>
        </div>
        {dirty && (activeTab === 'role' || selectedUser) && (
          <Button onClick={handleSave} disabled={saving}>
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

      {/* Tab Selection */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-soft overflow-hidden">
        <div className="flex border-b border-slate-200">
          <button
            onClick={() => handleTabChange('role')}
            className={`flex-1 px-6 py-4 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === 'role'
                ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-500'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Configure by Role
          </button>
          <button
            onClick={() => handleTabChange('user')}
            className={`flex-1 px-6 py-4 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              activeTab === 'user'
                ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-500'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            Configure by User
          </button>
        </div>

        {/* Tab Content */}
        <div className="p-6">
          {activeTab === 'role' ? (
            /* Role-wise Configuration */
            <div className="space-y-6">
              {/* Role Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Select Role</label>
                <div className="flex flex-wrap gap-2">
                  {allRoles.map((role) => (
                    <button
                      key={role.name}
                      onClick={() => handleRoleChange(role.name)}
                      disabled={isTransitioning}
                      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all text-white shadow-md ${
                        selectedRole === role.name
                          ? role.color + ' ring-2 ring-offset-2 ring-violet-400'
                          : 'bg-slate-100 !text-slate-600 hover:bg-slate-200 !shadow-none'
                      } ${isTransitioning ? 'opacity-50 cursor-wait' : ''}`}
                      style={selectedRole === role.name ? undefined : undefined}
                    >
                      {role.displayName}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="text-sm text-slate-600">
                  <span className="font-semibold text-violet-600">{enabledItems.length}</span>
                  <span> / {SIDEBAR_ITEMS.length} items enabled for </span>
                  <span className="font-semibold">{allRoles.find(r => r.name === selectedRole)?.displayName || selectedRole}</span>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={enableAll}>Enable All</Button>
                  <Button variant="outline" size="sm" onClick={disableAll}>Disable All</Button>
                </div>
              </div>

              {/* Sidebar Items Grid */}
              {isLoading ? (
                <div className="p-8 text-center">
                  <svg className="w-6 h-6 animate-spin mx-auto mb-2 text-violet-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                  <p className="text-slate-500">Loading configuration...</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {SIDEBAR_ITEMS.map((item) => {
                    const isEnabled = enabledItems.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => toggleItem(item.id)}
                        className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
                          isEnabled
                            ? 'bg-violet-50 border-violet-300 shadow-md'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                        }`}
                      >
                        <div className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center transition-all ${
                          isEnabled
                            ? 'bg-violet-500 text-white'
                            : 'bg-slate-200 text-slate-400'
                        }`}>
                          {isEnabled ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                          )}
                        </div>
                        <div className="flex items-start gap-3">
                          <span className="text-2xl">{item.icon}</span>
                          <div>
                            <h4 className={`font-semibold ${isEnabled ? 'text-violet-800' : 'text-slate-800'}`}>
                              {item.label}
                            </h4>
                            <p className={`text-sm mt-1 ${isEnabled ? 'text-violet-600' : 'text-slate-500'}`}>
                              {item.description}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* User-wise Configuration */
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* User Selection Panel */}
              <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-200 bg-white">
                  <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-3">
                    <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Select User
                  </h3>
                  <div className="relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <Input
                      placeholder="Search users..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9 text-sm"
                    />
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {loadingUsers ? (
                    <div className="p-6 text-center text-slate-500">
                      <svg className="w-5 h-5 animate-spin mx-auto mb-2" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      Loading users...
                    </div>
                  ) : filteredUsers.length === 0 ? (
                    <div className="p-6 text-center text-slate-400 text-sm">
                      No users found
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {filteredUsers.map((user: User) => (
                        <div
                          key={user.id}
                          onClick={() => handleUserChange(user)}
                          className={`p-3 cursor-pointer transition-colors ${
                            selectedUser?.id === user.id
                              ? 'bg-violet-100'
                              : 'bg-white hover:bg-slate-50'
                          } ${isTransitioning ? 'opacity-50 cursor-wait' : ''}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                              selectedUser?.id === user.id
                                ? 'bg-violet-500 text-white'
                                : 'bg-slate-200 text-slate-600'
                            }`}>
                              {user.fullName.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-slate-800 truncate text-sm">{user.fullName}</p>
                              <p className="text-xs text-slate-500 truncate">{user.username}</p>
                            </div>
                            <Badge variant="secondary" className="text-xs">
                              {allRoles.find(r => r.name === user.role)?.displayName || user.role}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* User Configuration Panel */}
              <div className="lg:col-span-2">
                {!selectedUser ? (
                  <div className="h-full flex items-center justify-center p-12 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
                    <div className="text-center">
                      <div className="p-4 rounded-2xl bg-slate-100 inline-block mb-4">
                        <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                      </div>
                      <p className="text-slate-600 font-medium">Select a user to configure</p>
                      <p className="text-sm text-slate-400 mt-1">Choose a user from the list to customize their sidebar</p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Selected User Info */}
                    <div className="p-4 bg-violet-50 rounded-xl border border-violet-200 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-violet-500 text-white flex items-center justify-center font-bold">
                          {selectedUser.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-violet-800">{selectedUser.fullName}</p>
                          <p className="text-sm text-violet-600">{selectedUser.username} • {allRoles.find(r => r.name === selectedUser.role)?.displayName || selectedUser.role}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={enableAll}>Enable All</Button>
                        <Button variant="outline" size="sm" onClick={disableAll}>Disable All</Button>
                        <Button variant="outline" size="sm" onClick={resetUserToRoleDefault} className="text-amber-600 hover:text-amber-700">
                          Reset to Role Default
                        </Button>
                      </div>
                    </div>

                    {/* Items Grid */}
                    {isLoading ? (
                      <div className="p-8 text-center">
                        <svg className="w-6 h-6 animate-spin mx-auto mb-2 text-violet-500" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                        <p className="text-slate-500">Loading configuration...</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {SIDEBAR_ITEMS.map((item) => {
                          const isEnabled = enabledItems.includes(item.id);
                          return (
                            <div
                              key={item.id}
                              onClick={() => toggleItem(item.id)}
                              className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                                isEnabled
                                  ? 'bg-violet-50 border-violet-300 shadow-sm'
                                  : 'bg-white border-slate-200 hover:border-slate-300'
                              }`}
                            >
                              <span className="text-xl">{item.icon}</span>
                              <span className={`flex-1 font-medium text-sm ${isEnabled ? 'text-violet-800' : 'text-slate-600'}`}>
                                {item.label}
                              </span>
                              <div className={`w-5 h-5 rounded-full flex items-center justify-center ${
                                isEnabled
                                  ? 'bg-violet-500 text-white'
                                  : 'bg-slate-200 text-slate-400'
                              }`}>
                                {isEnabled ? (
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                                  </svg>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Info Box */}
                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="text-sm text-amber-800">
                          <p className="font-medium">User-specific override</p>
                          <p className="mt-1 text-amber-700">
                            This configuration will override the role-based defaults for this user.
                            {enabledItems.length === 0 && ' Currently using role defaults.'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Summary */}
                    <div className="text-sm text-slate-600">
                      <span className="font-semibold text-violet-600">{enabledItems.length}</span>
                      <span> / {SIDEBAR_ITEMS.length} items enabled</span>
                      {enabledItems.length === 0 && (
                        <span className="text-slate-400 ml-2">(Using role defaults)</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
