import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { useSWRConfig } from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { FEATURE_PRIVILEGES, FEATURE_PRIVILEGE_CATEGORIES, SIDEBAR_ITEMS, REAUTH_ACTIONS, REAUTH_ACTION_CATEGORIES } from '@digilog/shared';
import type { RoleData, ReauthAction, ReauthActionCategory } from '@digilog/shared';
import { PRESET_COLORS } from './roles-components/role-color-picker';
import { RoleTable } from './roles-components/role-table';
import { RoleFormDialog } from './roles-components/role-form-dialog';
import type { RoleFormData } from './roles-components/role-form-dialog';
import { RoleDeleteDialog } from './roles-components/role-delete-dialog';

// ── Permission tab constants ──
const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  'User Management': { bg: 'from-blue-500/10 to-indigo-500/10', border: 'border-blue-200', text: 'text-blue-700', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
  'System': { bg: 'from-purple-500/10 to-pink-500/10', border: 'border-purple-200', text: 'text-purple-700', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z' },
  'Entity Management': { bg: 'from-teal-500/10 to-emerald-500/10', border: 'border-teal-200', text: 'text-teal-700', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
  'Entity Templates': { bg: 'from-emerald-500/10 to-green-500/10', border: 'border-emerald-200', text: 'text-emerald-700', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z' },
  'Entity Relationships': { bg: 'from-cyan-500/10 to-sky-500/10', border: 'border-cyan-200', text: 'text-cyan-700', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
  'Entity Identifiers': { bg: 'from-sky-500/10 to-blue-500/10', border: 'border-sky-200', text: 'text-sky-700', icon: 'M7 20l4-16m2 16l4-16M6 9h14M4 15h14' },
  'Rule Chains': { bg: 'from-violet-500/10 to-fuchsia-500/10', border: 'border-violet-200', text: 'text-violet-700', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
  'Alarms': { bg: 'from-rose-500/10 to-red-500/10', border: 'border-rose-200', text: 'text-rose-700', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
  'Checklists': { bg: 'from-lime-500/10 to-green-500/10', border: 'border-lime-200', text: 'text-lime-700', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2' },
  'UNS': { bg: 'from-orange-500/10 to-amber-500/10', border: 'border-orange-200', text: 'text-orange-700', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6z' },
  'Debug Traces': { bg: 'from-gray-500/10 to-zinc-500/10', border: 'border-gray-200', text: 'text-gray-700', icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
};
const DEFAULT_CATEGORY_COLOR = { bg: 'from-slate-500/10 to-gray-500/10', border: 'border-slate-200', text: 'text-slate-700', icon: 'M4 6h16M4 12h16M4 18h16' };
const getCategoryColor = (category: string) => CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLOR;
const DEFAULT_ROLE_ICON = 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z';

// ── Re-auth tab constants ──
const REAUTH_CATEGORY_META: Record<ReauthActionCategory, { gradient: string; bgLight: string; icon: string; description: string }> = {
  'User Management': {
    gradient: 'from-blue-600 to-indigo-600',
    bgLight: 'bg-blue-50 border-blue-200 text-blue-700',
    icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z',
    description: 'Account creation, modification, and access control',
  },
  'Configuration': {
    gradient: 'from-purple-600 to-pink-600',
    bgLight: 'bg-purple-50 border-purple-200 text-purple-700',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    description: 'System policy and security settings',
  },
  'Role Management': {
    gradient: 'from-amber-500 to-orange-600',
    bgLight: 'bg-amber-50 border-amber-200 text-amber-700',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
    description: 'Role creation, editing, and deletion',
  },
  'Backup': {
    gradient: 'from-red-500 to-rose-600',
    bgLight: 'bg-red-50 border-red-200 text-red-700',
    icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
    description: 'Database export and restore operations',
  },
  'Entity Management': {
    gradient: 'from-emerald-500 to-teal-600',
    bgLight: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    description: 'Entity CRUD, templates, relationships, and identifiers',
  },
  'Alarms': {
    gradient: 'from-yellow-500 to-amber-600',
    bgLight: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9',
    description: 'Alarm acknowledgment and clearance',
  },
  'Checklist': {
    gradient: 'from-cyan-500 to-blue-600',
    bgLight: 'bg-cyan-50 border-cyan-200 text-cyan-700',
    icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4',
    description: 'Checklist submission, review, and approval',
  },
  'Rule Chain': {
    gradient: 'from-violet-500 to-purple-600',
    bgLight: 'bg-violet-50 border-violet-200 text-violet-700',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    description: 'Rule chain automation management',
  },
  'Connectivity': {
    gradient: 'from-sky-500 to-cyan-600',
    bgLight: 'bg-sky-50 border-sky-200 text-sky-700',
    icon: 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0',
    description: 'Device credential management',
  },
  'UNS': {
    gradient: 'from-slate-500 to-gray-600',
    bgLight: 'bg-slate-50 border-slate-200 text-slate-700',
    icon: 'M4 6h16M4 12h16M4 18h7',
    description: 'Unified Namespace configuration',
  },
  'Help': {
    gradient: 'from-lime-500 to-green-600',
    bgLight: 'bg-lime-50 border-lime-200 text-lime-700',
    icon: 'M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    description: 'Help article management',
  },
  'Retention': {
    gradient: 'from-orange-500 to-red-600',
    bgLight: 'bg-orange-50 border-orange-200 text-orange-700',
    icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    description: 'Data retention policies and execution',
  },
  'System Config': {
    gradient: 'from-fuchsia-500 to-pink-600',
    bgLight: 'bg-fuchsia-50 border-fuchsia-200 text-fuchsia-700',
    icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01',
    description: 'Server and system-level configuration',
  },
};

// Group reauth actions by category
const reauthActionsByCategory = REAUTH_ACTION_CATEGORIES.map((category) => ({
  category,
  actions: (Object.entries(REAUTH_ACTIONS) as [ReauthAction, { label: string; category: string }][])
    .filter(([, v]) => v.category === category)
    .map(([key, v]) => ({ key, label: v.label })),
})).filter(g => g.actions.length > 0);

interface User {
  id: string;
  username: string;
  fullName: string;
  role: string;
  status: string;
}

type TabId = 'roles' | 'permissions' | 'sidebar' | 'reauth';

export function RoleAccessPage() {
  const { user } = useAuth();
  const { mutate } = useSWRConfig();
  const [activeTab, setActiveTab] = useState<TabId>('roles');

  // ── Shared data fetches ──
  const { data: roles, isLoading: rolesLoading } = useSWR<RoleData[]>('/api/roles', { revalidateOnMount: true, dedupingInterval: 0 });
  const { data: activeRoles } = useSWR<RoleData[]>('/api/roles/active', { revalidateOnMount: true, dedupingInterval: 0 });

  const isSuperAdmin = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('ROLE_MANAGE') ?? false);

  // ── Roles tab state ──
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedRoleForEdit, setSelectedRoleForEdit] = useState<RoleData | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RoleData | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [formData, setFormData] = useState<RoleFormData>({
    name: '', displayName: '', description: '', hierarchyLevel: 1,
    color: PRESET_COLORS[0].value, permissions: [],
  });

  // ── Permissions tab state ──
  const [permSelectedRole, setPermSelectedRole] = useState<string>('ADMIN');
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [permSaving, setPermSaving] = useState(false);
  const [permDirty, setPermDirty] = useState(false);

  const selectableRoles = useMemo(() => {
    if (!activeRoles) return [];
    return activeRoles.filter(r => r.name !== 'SUPER_ADMIN').sort((a, b) => b.hierarchyLevel - a.hierarchyLevel);
  }, [activeRoles]);

  const { data: roleConfig, isLoading: permLoading } = useSWR(
    activeTab === 'permissions' ? `/api/config/roles/${permSelectedRole}` : null,
    { onSuccess: (data) => { setPermissions(data.permissions || {}); setPermDirty(false); } }
  );

  // ── Sidebar tab state ──
  const [sidebarSubTab, setSidebarSubTab] = useState<'role' | 'user'>('role');
  const [sidebarSelectedRole, setSidebarSelectedRole] = useState<string>('');
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [enabledItems, setEnabledItems] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sidebarSaving, setSidebarSaving] = useState(false);
  const [sidebarDirty, setSidebarDirty] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const allRoles = activeRoles || [];

  useEffect(() => {
    if (allRoles.length > 0 && !sidebarSelectedRole) {
      const admin = allRoles.find(r => r.name === 'ADMIN');
      setSidebarSelectedRole(admin?.name || allRoles[0].name);
    }
  }, [allRoles, sidebarSelectedRole]);

  const { data: usersData, isLoading: loadingUsers } = useSWR(activeTab === 'sidebar' ? '/api/users' : null);

  const { data: sidebarRoleConfig, isLoading: loadingSidebarRoleConfig, isValidating: validatingSidebarRoleConfig } = useSWR(
    activeTab === 'sidebar' && sidebarSubTab === 'role' && sidebarSelectedRole ? `/api/config/roles/${sidebarSelectedRole}` : null,
    {
      revalidateOnMount: true, dedupingInterval: 0,
      onSuccess: (data) => { setEnabledItems(data.sidebarItems || SIDEBAR_ITEMS.map(i => i.id)); setSidebarDirty(false); setIsTransitioning(false); },
    }
  );

  const { data: userConfig, isLoading: loadingUserConfig, isValidating: validatingUserConfig } = useSWR(
    activeTab === 'sidebar' && sidebarSubTab === 'user' && selectedUser ? `/api/config/users/${selectedUser.id}` : null,
    {
      revalidateOnMount: true, dedupingInterval: 0,
      onSuccess: (data) => { setEnabledItems(data.sidebarItems || []); setSidebarDirty(false); setIsTransitioning(false); },
    }
  );

  // ── Re-auth tab state ──
  const { data: reauthConfig, isLoading: reauthLoading } = useSWR<Record<string, string[]>>(
    activeTab === 'reauth' ? '/api/config/action-reauth' : null,
    { revalidateOnMount: true, dedupingInterval: 0 }
  );
  const [reauthLocalConfig, setReauthLocalConfig] = useState<Record<string, string[]> | null>(null);
  const [reauthSaving, setReauthSaving] = useState(false);
  const [reauthSearch, setReauthSearch] = useState('');
  const [reauthCollapsed, setReauthCollapsed] = useState<Set<string>>(new Set());
  const [reauthRoleFilter, setReauthRoleFilter] = useState<string>('all');
  const [reauthSaveMessage, setReauthSaveMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // ── Re-auth computed values ──
  const reauthCurrentConfig = reauthLocalConfig ?? reauthConfig ?? {};
  const reauthHasChanges = reauthLocalConfig !== null;

  const reauthVisibleRoles = useMemo(() => {
    if (reauthRoleFilter === 'all') return selectableRoles;
    return selectableRoles.filter(r => r.name === reauthRoleFilter);
  }, [selectableRoles, reauthRoleFilter]);

  const reauthFilteredActionsByCategory = useMemo(() => {
    if (!reauthSearch.trim()) return reauthActionsByCategory;
    const q = reauthSearch.toLowerCase();
    return reauthActionsByCategory.map(g => ({
      ...g,
      actions: g.actions.filter(a => a.label.toLowerCase().includes(q) || a.key.toLowerCase().includes(q) || g.category.toLowerCase().includes(q)),
    })).filter(g => g.actions.length > 0);
  }, [reauthSearch]);

  const reauthStats = useMemo(() => {
    const totalActions = Object.keys(REAUTH_ACTIONS).length;
    const configuredActions = Object.keys(reauthCurrentConfig).filter(k => (reauthCurrentConfig[k]?.length ?? 0) > 0).length;
    const totalChecks = Object.values(reauthCurrentConfig).reduce((sum, arr) => sum + (arr?.length ?? 0), 0);
    const categoryStats = reauthActionsByCategory.map(g => {
      const configured = g.actions.filter(a => (reauthCurrentConfig[a.key]?.length ?? 0) > 0).length;
      return { category: g.category, total: g.actions.length, configured };
    });
    return { totalActions, configuredActions, totalChecks, categoryStats };
  }, [reauthCurrentConfig]);

  const reauthIsChecked = useCallback((action: string, role: string): boolean => {
    return reauthCurrentConfig[action]?.includes(role) ?? false;
  }, [reauthCurrentConfig]);

  const reauthToggleAction = useCallback((action: string, role: string) => {
    const updated = { ...reauthCurrentConfig };
    const currentRoles = updated[action] ?? [];
    if (currentRoles.includes(role)) {
      updated[action] = currentRoles.filter(r => r !== role);
      if (updated[action].length === 0) delete updated[action];
    } else {
      updated[action] = [...currentRoles, role];
    }
    setReauthLocalConfig(updated);
    setReauthSaveMessage(null);
  }, [reauthCurrentConfig]);

  const reauthSelectAllCategory = useCallback((category: ReauthActionCategory) => {
    const updated = { ...reauthCurrentConfig };
    const categoryActions = reauthActionsByCategory.find(c => c.category === category)?.actions ?? [];
    const targetRoles = reauthVisibleRoles.map(r => r.name);
    for (const { key } of categoryActions) {
      const existing = new Set(updated[key] ?? []);
      targetRoles.forEach(r => existing.add(r));
      updated[key] = Array.from(existing);
    }
    setReauthLocalConfig(updated);
    setReauthSaveMessage(null);
  }, [reauthCurrentConfig, reauthVisibleRoles]);

  const reauthClearCategory = useCallback((category: ReauthActionCategory) => {
    const updated = { ...reauthCurrentConfig };
    const categoryActions = reauthActionsByCategory.find(c => c.category === category)?.actions ?? [];
    const targetRoles = new Set(reauthVisibleRoles.map(r => r.name));
    for (const { key } of categoryActions) {
      if (updated[key]) {
        updated[key] = updated[key].filter(r => !targetRoles.has(r));
        if (updated[key].length === 0) delete updated[key];
      }
    }
    setReauthLocalConfig(updated);
    setReauthSaveMessage(null);
  }, [reauthCurrentConfig, reauthVisibleRoles]);

  const reauthSelectAllRole = useCallback((roleName: string) => {
    const updated = { ...reauthCurrentConfig };
    for (const action of Object.keys(REAUTH_ACTIONS)) {
      const existing = new Set(updated[action] ?? []);
      existing.add(roleName);
      updated[action] = Array.from(existing);
    }
    setReauthLocalConfig(updated);
    setReauthSaveMessage(null);
  }, [reauthCurrentConfig]);

  const reauthClearRole = useCallback((roleName: string) => {
    const updated = { ...reauthCurrentConfig };
    for (const action of Object.keys(updated)) {
      updated[action] = (updated[action] ?? []).filter(r => r !== roleName);
      if (updated[action].length === 0) delete updated[action];
    }
    setReauthLocalConfig(updated);
    setReauthSaveMessage(null);
  }, [reauthCurrentConfig]);

  const reauthToggleCategory = useCallback((category: string) => {
    setReauthCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }, []);

  const handleReauthSave = async () => {
    setReauthSaving(true);
    setReauthSaveMessage(null);
    try {
      await api.put('/api/config/action-reauth', reauthCurrentConfig);
      mutate('/api/config/action-reauth');
      mutate('/api/config/action-reauth/my-actions');
      setReauthLocalConfig(null);
      setReauthSaveMessage({ type: 'success', text: 'Action re-authentication settings saved successfully.' });
    } catch (err: any) {
      setReauthSaveMessage({ type: 'error', text: err.message ?? 'Failed to save settings.' });
    } finally {
      setReauthSaving(false);
    }
  };

  const handleReauthReset = () => {
    setReauthLocalConfig(null);
    setReauthSaveMessage(null);
  };

  const reauthGetRoleConfiguredCount = (roleName: string) => {
    return Object.values(reauthCurrentConfig).filter(arr => arr?.includes(roleName)).length;
  };

  // ── Roles tab handlers ──
  const resetForm = () => {
    setFormData({ name: '', displayName: '', description: '', hierarchyLevel: 1, color: PRESET_COLORS[0].value, permissions: [] });
    setError('');
  };
  const openCreateDialog = () => { resetForm(); setShowCreateDialog(true); };
  const openEditDialog = (role: RoleData) => {
    setSelectedRoleForEdit(role);
    setFormData({ name: role.name, displayName: role.displayName, description: role.description || '', hierarchyLevel: role.hierarchyLevel, color: role.color, permissions: role.permissions });
    setShowEditDialog(true);
  };
  const handleCreate = async () => {
    if (!formData.name || !formData.displayName) { setError('Name and Display Name are required'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/api/roles', { name: formData.name.toUpperCase().replace(/\s+/g, '_'), displayName: formData.displayName, description: formData.description, hierarchyLevel: formData.hierarchyLevel, color: formData.color, permissions: formData.permissions });
      mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/roles'));
      setShowCreateDialog(false); resetForm();
    } catch (err: any) { setError(err.message || 'Failed to create role'); } finally { setSaving(false); }
  };
  const handleUpdate = async () => {
    if (!selectedRoleForEdit) return;
    setSaving(true); setError('');
    try {
      await api.put(`/api/roles/${selectedRoleForEdit.name}`, { displayName: formData.displayName, description: formData.description, hierarchyLevel: formData.hierarchyLevel, color: formData.color, permissions: formData.permissions });
      mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/roles'));
      setShowEditDialog(false); setSelectedRoleForEdit(null);
    } catch (err: any) { setError(err.message || 'Failed to update role'); } finally { setSaving(false); }
  };
  const openDeleteDialog = (role: RoleData) => { setDeleteTarget(role); setDeleteError(''); setShowDeleteDialog(true); };
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError('');
    try {
      await api.delete(`/api/roles/${deleteTarget.name}`);
      mutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/roles'));
      setShowDeleteDialog(false); setDeleteTarget(null);
    } catch (err: any) { setDeleteError(err.message || 'Failed to delete role'); } finally { setDeleting(false); }
  };

  // ── Permissions tab handlers ──
  const togglePermission = (featureId: string) => { setPermissions(prev => ({ ...prev, [featureId]: !prev[featureId] })); setPermDirty(true); };
  const toggleCategory = (category: string, value: boolean) => {
    const updates: Record<string, boolean> = {};
    FEATURE_PRIVILEGE_CATEGORIES[category].forEach(f => { updates[f.id] = value; });
    setPermissions(prev => ({ ...prev, ...updates })); setPermDirty(true);
  };
  const handlePermSave = async () => {
    setPermSaving(true);
    try {
      await api.put(`/api/config/roles/${permSelectedRole}`, { permissions, sidebarItems: roleConfig?.sidebarItems || [], homeWidgets: roleConfig?.homeWidgets || [] });
      mutate(`/api/config/roles/${permSelectedRole}`); setPermDirty(false);
    } catch (error) { console.error('Failed to save:', error); } finally { setPermSaving(false); }
  };
  const isCategoryFullyEnabled = (category: string) => FEATURE_PRIVILEGE_CATEGORIES[category].every(f => permissions[f.id]);
  const isCategoryPartiallyEnabled = (category: string) => { const e = FEATURE_PRIVILEGE_CATEGORIES[category].filter(f => permissions[f.id]).length; return e > 0 && e < FEATURE_PRIVILEGE_CATEGORIES[category].length; };
  const enabledCount = Object.values(permissions).filter(Boolean).length;
  const enabledPercentage = Math.round((enabledCount / FEATURE_PRIVILEGES.length) * 100);

  // ── Sidebar tab handlers ──
  const handleSidebarRoleChange = useCallback((role: string) => {
    if (role !== sidebarSelectedRole) { setIsTransitioning(true); setEnabledItems([]); setSidebarDirty(false); setSidebarSelectedRole(role); }
  }, [sidebarSelectedRole]);

  const handleUserChange = useCallback((u: User) => {
    if (u.id !== selectedUser?.id) { setIsTransitioning(true); setEnabledItems([]); setSidebarDirty(false); setSelectedUser(u); }
  }, [selectedUser]);

  const handleSidebarSubTabChange = useCallback((tab: 'role' | 'user') => {
    if (tab !== sidebarSubTab) { setIsTransitioning(true); setEnabledItems([]); setSidebarDirty(false); setSidebarSubTab(tab); if (tab === 'role') setSelectedUser(null); }
  }, [sidebarSubTab]);

  const toggleSidebarItem = (itemId: string) => {
    setEnabledItems(prev => prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId]);
    setSidebarDirty(true);
  };
  const enableAllSidebar = () => { setEnabledItems(SIDEBAR_ITEMS.map(i => i.id)); setSidebarDirty(true); };
  const disableAllSidebar = () => { setEnabledItems([]); setSidebarDirty(true); };

  const handleSaveSidebarRole = async () => {
    setSidebarSaving(true);
    try {
      await api.put(`/api/config/roles/${sidebarSelectedRole}`, { sidebarItems: enabledItems, homeWidgets: sidebarRoleConfig?.homeWidgets || [], permissions: sidebarRoleConfig?.permissions || {} });
      mutate(`/api/config/roles/${sidebarSelectedRole}`); setSidebarDirty(false);
    } catch (error) { console.error('Failed to save:', error); } finally { setSidebarSaving(false); }
  };
  const handleSaveSidebarUser = async () => {
    if (!selectedUser) return;
    setSidebarSaving(true);
    try {
      await api.put(`/api/config/users/${selectedUser.id}`, { sidebarItems: enabledItems, homeWidgets: userConfig?.homeWidgets || [], permissions: userConfig?.permissions || {} });
      mutate(`/api/config/users/${selectedUser.id}`); setSidebarDirty(false);
    } catch (error) { console.error('Failed to save:', error); } finally { setSidebarSaving(false); }
  };
  const resetUserToRoleDefault = async () => {
    if (!selectedUser) return;
    setSidebarSaving(true);
    try {
      await api.put(`/api/config/users/${selectedUser.id}`, { sidebarItems: [], homeWidgets: [], permissions: {} });
      mutate(`/api/config/users/${selectedUser.id}`); setEnabledItems([]); setSidebarDirty(false);
    } catch (error) { console.error('Failed to clear:', error); } finally { setSidebarSaving(false); }
  };

  const filteredUsers = usersData?.data?.filter((u: User) =>
    u.username.toLowerCase().includes(searchQuery.toLowerCase()) || u.fullName.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  const sidebarIsLoading = sidebarSubTab === 'role'
    ? (loadingSidebarRoleConfig || validatingSidebarRoleConfig || isTransitioning)
    : (loadingUserConfig || validatingUserConfig || isTransitioning);
  const handleSaveSidebar = sidebarSubTab === 'role' ? handleSaveSidebarRole : handleSaveSidebarUser;

  // ── Tab definitions ──
  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'roles', label: 'Roles', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
    { id: 'permissions', label: 'Permissions', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
    { id: 'sidebar', label: 'Sidebar', icon: 'M4 6h16M4 12h16M4 18h7' },
    { id: 'reauth', label: 'Re-auth', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500 via-purple-600 to-indigo-600 p-6 text-white shadow-2xl">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxwYXRoIGQ9Ik0zNiAxOGMzLjMxNCAwIDYgMi42ODYgNiA2cy0yLjY4NiA2LTYgNi02LTIuNjg2LTYtNiAyLjY4Ni02IDYtNiIgc3Ryb2tlPSJyZ2JhKDI1NSwyNTUsMjU1LDAuMSkiIHN0cm9rZS13aWR0aD0iMiIvPjwvZz48L3N2Zz4=')] opacity-30" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/config" className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm transition-all duration-200 border border-white/10">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="flex items-center gap-3 mb-1">
              <div className="p-3 rounded-xl bg-white/20 backdrop-blur-sm shadow-lg">
                <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold">Role & Access Configuration</h1>
                <p className="text-purple-100/80 text-sm">Manage roles, permissions, sidebar visibility, and re-authentication</p>
              </div>
            </div>
          </div>
          {/* Context-sensitive header action */}
          {activeTab === 'roles' && isSuperAdmin && (
            <Button onClick={openCreateDialog} className="bg-white text-purple-600 hover:bg-purple-50 shadow-lg font-semibold">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Create Role
            </Button>
          )}
          {activeTab === 'permissions' && permDirty && (
            <Button onClick={handlePermSave} disabled={permSaving} className="bg-white text-purple-600 hover:bg-purple-50 shadow-lg font-semibold">
              {permSaving ? (
                <><svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Saving...</>
              ) : (
                <><svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Save Changes</>
              )}
            </Button>
          )}
          {activeTab === 'sidebar' && sidebarDirty && (sidebarSubTab === 'role' || selectedUser) && (
            <Button onClick={handleSaveSidebar} disabled={sidebarSaving} className="bg-white text-purple-600 hover:bg-purple-50 shadow-lg font-semibold">
              {sidebarSaving ? (
                <><svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Saving...</>
              ) : (
                <><svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Save Changes</>
              )}
            </Button>
          )}
          {activeTab === 'reauth' && reauthHasChanges && (
            <div className="flex items-center gap-2">
              <Button onClick={handleReauthReset} variant="outline" className="bg-white/10 text-white border-white/20 hover:bg-white/20 font-semibold">
                Discard
              </Button>
              <Button onClick={handleReauthSave} disabled={reauthSaving} className="bg-white text-purple-600 hover:bg-purple-50 shadow-lg font-semibold">
                {reauthSaving ? (
                  <><svg className="w-4 h-4 mr-2 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Saving...</>
                ) : (
                  <><svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Save Changes</>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-soft overflow-hidden">
        <div className="flex border-b border-slate-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 px-6 py-4 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
                activeTab === tab.id
                  ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-500'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={tab.icon} />
              </svg>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ═══════════════════ ROLES TAB ═══════════════════ */}
      {activeTab === 'roles' && (
        <>
          <RoleTable roles={roles} isLoading={rolesLoading} isSuperAdmin={isSuperAdmin} onEdit={openEditDialog} onDelete={openDeleteDialog} />

          {/* Info Banner */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-50 via-indigo-50 to-blue-50 border border-purple-100/50 p-5">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg shadow-purple-500/25">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              </div>
              <div>
                <h3 className="font-bold text-purple-900 mb-1">Role Hierarchy</h3>
                <p className="text-sm text-purple-700">
                  Users can only create or manage users with roles of equal or lower hierarchy level.
                  System roles (marked with the System badge) cannot be deleted but their permissions can be customized.
                </p>
              </div>
            </div>
          </div>

          <RoleFormDialog open={showCreateDialog} onClose={() => setShowCreateDialog(false)} title="Create New Role" formData={formData} setFormData={setFormData} error={error} saving={saving} onSubmit={handleCreate} isEdit={false} />
          <RoleDeleteDialog open={showDeleteDialog} role={deleteTarget} error={deleteError} deleting={deleting} onClose={() => setShowDeleteDialog(false)} onDelete={handleDelete} />
          <RoleFormDialog open={showEditDialog} onClose={() => setShowEditDialog(false)} title={`Edit Role: ${selectedRoleForEdit?.displayName}`} formData={formData} setFormData={setFormData} error={error} saving={saving} onSubmit={handleUpdate} isEdit={true} isSystem={selectedRoleForEdit?.isSystem} />
        </>
      )}

      {/* ═══════════════════ PERMISSIONS TAB ═══════════════════ */}
      {activeTab === 'permissions' && (
        <>
          {/* Role Selection Card */}
          <Card className="border-0 shadow-xl bg-gradient-to-br from-white via-white to-slate-50/50 overflow-hidden">
            <div className="h-1 bg-gradient-to-r from-violet-500 via-purple-500 to-indigo-500" />
            <CardContent className="p-6">
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">Select Role to Configure</h3>
                  <p className="text-xs text-slate-500">Choose a role to manage its permissions</p>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                {selectableRoles.map((role) => {
                  const color = role.color || '#64748b';
                  return (
                    <button key={role.name} onClick={() => { setPermSelectedRole(role.name); setPermDirty(false); }}
                      className={`relative group p-4 rounded-2xl border-2 transition-all duration-300 ${
                        permSelectedRole === role.name ? 'border-transparent shadow-xl scale-[1.02]' : 'border-slate-200 hover:border-slate-300 hover:shadow-lg'
                      }`}>
                      {permSelectedRole === role.name && <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-slate-500 to-slate-600 opacity-10" />}
                      <div className="relative">
                        <div className={`w-12 h-12 mx-auto rounded-xl flex items-center justify-center mb-3 transition-all ${
                          permSelectedRole === role.name ? 'text-white shadow-lg' : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200'
                        }`} style={permSelectedRole === role.name ? { background: color } : undefined}>
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={DEFAULT_ROLE_ICON} /></svg>
                        </div>
                        <p className={`text-sm font-semibold text-center ${permSelectedRole === role.name ? 'text-slate-800' : 'text-slate-600'}`}>{role.displayName}</p>
                        {permSelectedRole === role.name && (
                          <div className="absolute -top-1 -right-1">
                            <div className="w-5 h-5 rounded-full flex items-center justify-center shadow-lg" style={{ background: color }}>
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            </div>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="mt-5 p-4 rounded-xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200/50">
                <div className="flex items-center gap-3 text-amber-800">
                  <div className="p-2 rounded-lg bg-amber-100"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg></div>
                  <div className="text-sm"><span className="font-semibold">Note:</span> Super Admin has all permissions by default and cannot be modified.</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="border-0 shadow-lg overflow-hidden">
              <div className="h-1" style={{ background: selectableRoles.find(r => r.name === permSelectedRole)?.color || '#64748b' }} />
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-lg" style={{ background: selectableRoles.find(r => r.name === permSelectedRole)?.color || '#64748b' }}>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={DEFAULT_ROLE_ICON} /></svg>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Selected Role</p>
                    <p className="text-xl font-bold text-slate-800">{selectableRoles.find(r => r.name === permSelectedRole)?.displayName || permSelectedRole}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card className="border-0 shadow-lg overflow-hidden">
              <div className="h-1 bg-gradient-to-r from-emerald-500 to-green-500" />
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center text-white shadow-lg">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
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
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">Access Level</p>
                      <p className="text-xl font-bold text-slate-800">{enabledPercentage}%</p>
                    </div>
                  </div>
                  <div className="w-16 h-16">
                    <svg viewBox="0 0 36 36" className="w-full h-full transform -rotate-90">
                      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="#e2e8f0" strokeWidth="3" />
                      <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="url(#perm-gradient)" strokeWidth="3" strokeDasharray={`${enabledPercentage}, 100`} strokeLinecap="round" />
                      <defs><linearGradient id="perm-gradient"><stop offset="0%" stopColor="#3b82f6" /><stop offset="100%" stopColor="#6366f1" /></linearGradient></defs>
                    </svg>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Permissions Grid */}
          <Card className="border-0 shadow-xl overflow-hidden">
            <CardContent className="p-0">
              {permLoading ? (
                <div className="p-16 text-center">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 mb-4 animate-pulse">
                    <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
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
                        <div className="flex items-center justify-between mb-5">
                          <div className="flex items-center gap-3">
                            <div className={`p-2.5 rounded-xl bg-gradient-to-br ${categoryConfig.bg} ${categoryConfig.border} border`}>
                              <svg className={`w-5 h-5 ${categoryConfig.text}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={categoryConfig.icon} /></svg>
                            </div>
                            <div>
                              <h3 className="font-bold text-slate-800">{category}</h3>
                              <p className="text-xs text-slate-500">{enabledInCategory} of {features.length} permissions enabled</p>
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => toggleCategory(category, true)} disabled={isCategoryFullyEnabled(category)} className="rounded-lg text-xs hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200">
                              <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Enable All
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => toggleCategory(category, false)} disabled={!isCategoryPartiallyEnabled(category) && !isCategoryFullyEnabled(category)} className="rounded-lg text-xs hover:bg-red-50 hover:text-red-600 hover:border-red-200">
                              <svg className="w-3.5 h-3.5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>Disable All
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                          {features.map((feature) => (
                            <label key={feature.id} className={`group relative flex items-center gap-4 p-4 rounded-xl border-2 transition-all duration-200 cursor-pointer ${
                              permissions[feature.id] ? 'bg-gradient-to-r from-emerald-50 to-green-50 border-emerald-200 shadow-md' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                            }`}>
                              <input type="checkbox" checked={permissions[feature.id] || false} onChange={() => togglePermission(feature.id)} className="sr-only" />
                              <div className={`flex-shrink-0 w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all ${
                                permissions[feature.id] ? 'bg-gradient-to-br from-emerald-500 to-green-600 border-emerald-500 shadow-md' : 'bg-white border-slate-300 group-hover:border-slate-400'
                              }`}>
                                {permissions[feature.id] && <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                              </div>
                              <span className={`flex-1 text-sm font-medium transition-colors ${permissions[feature.id] ? 'text-emerald-800' : 'text-slate-600'}`}>{feature.label}</span>
                              {permissions[feature.id] && <span className="flex-shrink-0 w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
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

          {/* Security Notice */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-50 via-orange-50 to-red-50 border border-amber-100/50 p-5">
            <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-full blur-3xl" />
            <div className="relative flex items-start gap-4">
              <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-lg shadow-amber-500/25">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              </div>
              <div>
                <h3 className="font-bold text-amber-900 mb-1">Security Notice</h3>
                <p className="text-sm text-amber-700">Role permissions determine what actions users can perform. Changes take effect immediately for all users with the selected role.</p>
                <div className="flex items-center gap-4 mt-3">
                  <div className="flex items-center gap-1.5 text-xs text-amber-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                    <span>21 CFR Part 11 compliant</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-amber-600">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                    <span>All changes are audit logged</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════════ SIDEBAR TAB ═══════════════════ */}
      {activeTab === 'sidebar' && (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-soft overflow-hidden">
          {/* Inner tabs: Role / User */}
          <div className="flex border-b border-slate-200">
            <button onClick={() => handleSidebarSubTabChange('role')} className={`flex-1 px-6 py-4 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              sidebarSubTab === 'role' ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-500' : 'text-slate-600 hover:bg-slate-50'
            }`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
              Configure by Role
            </button>
            <button onClick={() => handleSidebarSubTabChange('user')} className={`flex-1 px-6 py-4 text-sm font-medium transition-all flex items-center justify-center gap-2 ${
              sidebarSubTab === 'user' ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-500' : 'text-slate-600 hover:bg-slate-50'
            }`}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
              Configure by User
            </button>
          </div>

          <div className="p-6">
            {sidebarSubTab === 'role' ? (
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Select Role</label>
                  <div className="flex flex-wrap gap-2">
                    {allRoles.map((role) => (
                      <button key={role.name} onClick={() => handleSidebarRoleChange(role.name)} disabled={isTransitioning}
                        className={`px-4 py-2 rounded-xl text-sm font-medium transition-all text-white shadow-md ${
                          sidebarSelectedRole === role.name ? role.color + ' ring-2 ring-offset-2 ring-violet-400' : 'bg-slate-100 !text-slate-600 hover:bg-slate-200 !shadow-none'
                        } ${isTransitioning ? 'opacity-50 cursor-wait' : ''}`}>
                        {role.displayName}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="text-sm text-slate-600">
                    <span className="font-semibold text-violet-600">{enabledItems.length}</span>
                    <span> / {SIDEBAR_ITEMS.length} items enabled for </span>
                    <span className="font-semibold">{allRoles.find(r => r.name === sidebarSelectedRole)?.displayName || sidebarSelectedRole}</span>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={enableAllSidebar}>Enable All</Button>
                    <Button variant="outline" size="sm" onClick={disableAllSidebar}>Disable All</Button>
                  </div>
                </div>

                {sidebarIsLoading ? (
                  <div className="p-8 text-center">
                    <svg className="w-6 h-6 animate-spin mx-auto mb-2 text-violet-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    <p className="text-slate-500">Loading configuration...</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {SIDEBAR_ITEMS.map((item) => {
                      const isEnabled = enabledItems.includes(item.id);
                      return (
                        <div key={item.id} onClick={() => toggleSidebarItem(item.id)} className={`relative p-4 rounded-xl border-2 transition-all cursor-pointer ${
                          isEnabled ? 'bg-violet-50 border-violet-300 shadow-md' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
                        }`}>
                          <div className={`absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center transition-all ${isEnabled ? 'bg-violet-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                            {isEnabled ? (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                            ) : (
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                            )}
                          </div>
                          <div className="flex items-start gap-3">
                            <span className="text-2xl">{item.icon}</span>
                            <div>
                              <h4 className={`font-semibold ${isEnabled ? 'text-violet-800' : 'text-slate-800'}`}>{item.label}</h4>
                              <p className={`text-sm mt-1 ${isEnabled ? 'text-violet-600' : 'text-slate-500'}`}>{item.description}</p>
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
                      <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      Select User
                    </h3>
                    <div className="relative">
                      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                      <Input placeholder="Search users..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9 text-sm" />
                    </div>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {loadingUsers ? (
                      <div className="p-6 text-center text-slate-500">
                        <svg className="w-5 h-5 animate-spin mx-auto mb-2" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                        Loading users...
                      </div>
                    ) : filteredUsers.length === 0 ? (
                      <div className="p-6 text-center text-slate-400 text-sm">No users found</div>
                    ) : (
                      <div className="divide-y divide-slate-200">
                        {filteredUsers.map((u: User) => (
                          <div key={u.id} onClick={() => handleUserChange(u)} className={`p-3 cursor-pointer transition-colors ${
                            selectedUser?.id === u.id ? 'bg-violet-100' : 'bg-white hover:bg-slate-50'
                          } ${isTransitioning ? 'opacity-50 cursor-wait' : ''}`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${
                                selectedUser?.id === u.id ? 'bg-violet-500 text-white' : 'bg-slate-200 text-slate-600'
                              }`}>{u.fullName.charAt(0).toUpperCase()}</div>
                              <div className="flex-1 min-w-0">
                                <p className="font-medium text-slate-800 truncate text-sm">{u.fullName}</p>
                                <p className="text-xs text-slate-500 truncate">{u.username}</p>
                              </div>
                              <Badge variant="secondary" className="text-xs">{allRoles.find(r => r.name === u.role)?.displayName || u.role}</Badge>
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
                          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                        </div>
                        <p className="text-slate-600 font-medium">Select a user to configure</p>
                        <p className="text-sm text-slate-400 mt-1">Choose a user from the list to customize their sidebar</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="p-4 bg-violet-50 rounded-xl border border-violet-200 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-violet-500 text-white flex items-center justify-center font-bold">{selectedUser.fullName.charAt(0).toUpperCase()}</div>
                          <div>
                            <p className="font-semibold text-violet-800">{selectedUser.fullName}</p>
                            <p className="text-sm text-violet-600">{selectedUser.username} &bull; {allRoles.find(r => r.name === selectedUser.role)?.displayName || selectedUser.role}</p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={enableAllSidebar}>Enable All</Button>
                          <Button variant="outline" size="sm" onClick={disableAllSidebar}>Disable All</Button>
                          <Button variant="outline" size="sm" onClick={resetUserToRoleDefault} className="text-amber-600 hover:text-amber-700">Reset to Role Default</Button>
                        </div>
                      </div>

                      {sidebarIsLoading ? (
                        <div className="p-8 text-center">
                          <svg className="w-6 h-6 animate-spin mx-auto mb-2 text-violet-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                          <p className="text-slate-500">Loading configuration...</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {SIDEBAR_ITEMS.map((item) => {
                            const isEnabled = enabledItems.includes(item.id);
                            return (
                              <div key={item.id} onClick={() => toggleSidebarItem(item.id)} className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all cursor-pointer ${
                                isEnabled ? 'bg-violet-50 border-violet-300 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300'
                              }`}>
                                <span className="text-xl">{item.icon}</span>
                                <span className={`flex-1 font-medium text-sm ${isEnabled ? 'text-violet-800' : 'text-slate-600'}`}>{item.label}</span>
                                <div className={`w-5 h-5 rounded-full flex items-center justify-center ${isEnabled ? 'bg-violet-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                                  {isEnabled ? (
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
                                  ) : (
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
                        <div className="flex items-start gap-3">
                          <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          <div className="text-sm text-amber-800">
                            <p className="font-medium">User-specific override</p>
                            <p className="mt-1 text-amber-700">This configuration will override the role-based defaults for this user.{enabledItems.length === 0 && ' Currently using role defaults.'}</p>
                          </div>
                        </div>
                      </div>

                      <div className="text-sm text-slate-600">
                        <span className="font-semibold text-violet-600">{enabledItems.length}</span>
                        <span> / {SIDEBAR_ITEMS.length} items enabled</span>
                        {enabledItems.length === 0 && <span className="text-slate-400 ml-2">(Using role defaults)</span>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════ RE-AUTH TAB ═══════════════════ */}
      {activeTab === 'reauth' && (
        <>
          {reauthLoading ? (
            <div className="flex items-center justify-center h-64">
              <div className="flex flex-col items-center gap-3 text-slate-500">
                <div className="relative">
                  <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-red-500 animate-spin" />
                </div>
                <p className="text-sm font-medium">Loading re-authentication configuration...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Stats Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-blue-50">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-slate-800">{reauthStats.totalActions}</p>
                      <p className="text-xs text-slate-500">Total Actions</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-emerald-50">
                      <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-emerald-700">{reauthStats.configuredActions}</p>
                      <p className="text-xs text-slate-500">Actions Configured</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-purple-50">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-purple-700">{reauthStats.totalChecks}</p>
                      <p className="text-xs text-slate-500">Total Checks</p>
                    </div>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-orange-50">
                      <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-orange-700">{selectableRoles.length}</p>
                      <p className="text-xs text-slate-500">Roles</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Info Banner */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200/60 p-4">
                <div className="flex items-start gap-3">
                  <div className="p-1.5 rounded-lg bg-blue-100 flex-shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="text-sm text-blue-700">
                    <p className="font-semibold">How it works</p>
                    <p className="mt-1 text-blue-600">
                      When a checked action is performed by a user with the corresponding role, they will be prompted to
                      re-enter their password before the action executes. This adds an extra layer of security for sensitive operations.
                    </p>
                  </div>
                </div>
              </div>

              {/* Save Message */}
              {reauthSaveMessage && (
                <div className={`rounded-xl border p-4 text-sm flex items-center gap-2 ${
                  reauthSaveMessage.type === 'success'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                    : 'bg-red-50 border-red-200 text-red-700'
                }`}>
                  <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d={reauthSaveMessage.type === 'success'
                        ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                        : 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}
                    />
                  </svg>
                  <span className="font-medium">{reauthSaveMessage.text}</span>
                </div>
              )}

              {/* Toolbar: Search + Role Filter */}
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <Input
                    type="text"
                    placeholder="Search actions..."
                    value={reauthSearch}
                    onChange={e => setReauthSearch(e.target.value)}
                    className="pl-10 h-10 bg-white"
                  />
                  {reauthSearch && (
                    <button
                      onClick={() => setReauthSearch('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-sm text-slate-500 whitespace-nowrap">Filter Role:</label>
                  <select
                    value={reauthRoleFilter}
                    onChange={e => setReauthRoleFilter(e.target.value)}
                    className="h-10 px-3 pr-8 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 cursor-pointer appearance-none"
                    style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '16px' }}
                  >
                    <option value="all">All Roles ({selectableRoles.length})</option>
                    {selectableRoles.map(r => (
                      <option key={r.name} value={r.name}>{r.displayName} ({reauthGetRoleConfiguredCount(r.name)} configured)</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Matrix Table */}
              <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40">
                <div className="overflow-x-auto rounded-2xl">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-200" style={{ background: 'linear-gradient(to right, #f8fafc, #f1f5f9)' }}>
                        <th className="text-left px-5 pt-4 pb-3 text-xs font-semibold text-slate-500 uppercase tracking-wider" style={{ minWidth: reauthVisibleRoles.length > 3 ? '240px' : '300px' }}>
                          Action
                        </th>
                        {reauthVisibleRoles.map(role => (
                          <th key={role.name} className="px-2 pt-4 pb-3 text-center" style={{ minWidth: reauthVisibleRoles.length > 3 ? '105px' : '140px' }}>
                            <div className="flex flex-col items-center gap-1">
                              <div
                                className={`inline-flex items-center rounded-lg font-bold text-white shadow-sm whitespace-nowrap ${reauthVisibleRoles.length > 3 ? 'px-2 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'} ${role.color || 'bg-slate-500'}`}
                              >
                                {role.displayName}
                              </div>
                              <span className="text-[10px] text-slate-400 font-medium tabular-nums whitespace-nowrap">
                                {reauthGetRoleConfiguredCount(role.name)} / {reauthStats.totalActions}
                              </span>
                              <div className="flex gap-1">
                                <button
                                  onClick={() => reauthSelectAllRole(role.name)}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors"
                                >
                                  All
                                </button>
                                <button
                                  onClick={() => reauthClearRole(role.name)}
                                  className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 hover:bg-slate-200 font-medium transition-colors"
                                >
                                  None
                                </button>
                              </div>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {reauthFilteredActionsByCategory.map(({ category, actions }) => {
                        const meta = REAUTH_CATEGORY_META[category as ReauthActionCategory];
                        const isCollapsed = reauthCollapsed.has(category);
                        const catStat = reauthStats.categoryStats.find(s => s.category === category);

                        return (
                          <ReauthCategorySection
                            key={category}
                            category={category as ReauthActionCategory}
                            actions={actions}
                            roles={reauthVisibleRoles}
                            meta={meta}
                            isCollapsed={isCollapsed}
                            onToggleCollapse={() => reauthToggleCategory(category)}
                            isChecked={reauthIsChecked}
                            onToggle={reauthToggleAction}
                            onSelectAll={() => reauthSelectAllCategory(category as ReauthActionCategory)}
                            onClear={() => reauthClearCategory(category as ReauthActionCategory)}
                            configuredCount={catStat?.configured ?? 0}
                            totalCount={catStat?.total ?? 0}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {reauthFilteredActionsByCategory.length === 0 && (
                  <div className="text-center py-12 text-slate-400">
                    <svg className="w-12 h-12 mx-auto mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <p className="font-medium">No actions match "{reauthSearch}"</p>
                    <p className="text-sm mt-1">Try a different search term</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Re-auth Category Section Component ── */

function ReauthCategorySection({
  category,
  actions,
  roles,
  meta,
  isCollapsed,
  onToggleCollapse,
  isChecked,
  onToggle,
  onSelectAll,
  onClear,
  configuredCount,
  totalCount,
}: {
  category: ReauthActionCategory;
  actions: { key: string; label: string }[];
  roles: RoleData[];
  meta: { gradient: string; bgLight: string; icon: string; description: string };
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isChecked: (action: string, role: string) => boolean;
  onToggle: (action: string, role: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
  configuredCount: number;
  totalCount: number;
}) {
  return (
    <>
      {/* Category Header Row */}
      <tr className="bg-gradient-to-r from-slate-50 to-white border-y border-slate-100">
        <td className="px-5 py-3 sticky left-0 bg-gradient-to-r from-slate-50 to-white z-10" colSpan={1}>
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleCollapse}
              className="flex items-center gap-3 flex-1 text-left"
            >
              <div className={`p-1.5 rounded-lg bg-gradient-to-br ${meta.gradient} shadow-sm`}>
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={meta.icon} />
                </svg>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-slate-700">{category}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${meta.bgLight}`}>
                    {configuredCount}/{totalCount}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">{meta.description}</p>
              </div>
              <svg
                className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${isCollapsed ? '' : 'rotate-180'}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            <div className="flex gap-1">
              <button
                onClick={onSelectAll}
                className="text-[10px] px-2 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium transition-colors border border-blue-100"
              >
                Select All
              </button>
              <button
                onClick={onClear}
                className="text-[10px] px-2 py-1 rounded-md bg-slate-50 text-slate-500 hover:bg-slate-100 font-medium transition-colors border border-slate-200"
              >
                Clear
              </button>
            </div>
          </div>
        </td>
        <td colSpan={roles.length} />
      </tr>
      {/* Action Rows (collapsible) */}
      {!isCollapsed && actions.map(({ key, label }, idx) => (
        <tr
          key={key}
          className={`border-b border-slate-50 hover:bg-blue-50/40 transition-colors ${
            idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'
          }`}
        >
          <td className="px-5 py-2.5 sticky left-0 z-10" style={{ background: idx % 2 === 0 ? 'white' : 'rgb(248 250 252 / 0.3)' }}>
            <div className="flex items-center gap-2">
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span className="text-sm text-slate-700 font-medium">{label}</span>
            </div>
          </td>
          {roles.map(role => {
            const checked = isChecked(key, role.name);
            return (
              <td key={role.name} className="px-2 py-2.5 text-center">
                <label className="inline-flex items-center justify-center cursor-pointer group/check">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(key, role.name)}
                      className="sr-only peer"
                    />
                    <div className={`w-5 h-5 rounded-md border-2 transition-all duration-150 flex items-center justify-center
                      ${checked
                        ? 'border-blue-500 bg-blue-500 shadow-sm shadow-blue-500/25'
                        : 'border-slate-300 bg-white group-hover/check:border-slate-400 group-hover/check:bg-slate-50'
                      }`}
                    >
                      {checked && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </div>
                </label>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
