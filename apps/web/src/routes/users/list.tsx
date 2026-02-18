import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { useFieldLabels } from '@/hooks/use-field-labels';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ReauthDialog } from '@/components/reauth-dialog';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { usePaginationConfig } from '@/hooks/use-pagination-config';
import type { RoleData, PasswordPolicyConfig } from '@digilog/shared';

interface PendingCount {
  count: number;
}

// Default password policy
const defaultPolicy: PasswordPolicyConfig = {
  minLength: 8,
  maxLength: 128,
  requireUppercase: true,
  requireLowercase: true,
  requireNumbers: true,
  requireSpecialChars: true,
  minUppercase: 1,
  minLowercase: 1,
  minNumbers: 1,
  minSpecialChars: 1,
  preventReuseCount: 12,
  cannotBeUserId: true,
  cannotContainUserId: true,
  maxFailedAttempts: 5,
  passwordExpiryDays: 90,
  autoLogoutEnabled: true,
  idleTimeoutMinutes: 15,
  warningMinutes: 2,
};

// Generate password based on policy
function generatePassword(policy: PasswordPolicyConfig): string {
  const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const lowercase = 'abcdefghijklmnopqrstuvwxyz';
  const numbers = '0123456789';
  const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';

  let password = '';
  const allChars: string[] = [];

  if (policy.requireUppercase) {
    for (let i = 0; i < policy.minUppercase; i++) {
      password += uppercase[Math.floor(Math.random() * uppercase.length)];
    }
    allChars.push(...uppercase.split(''));
  }

  if (policy.requireLowercase) {
    for (let i = 0; i < policy.minLowercase; i++) {
      password += lowercase[Math.floor(Math.random() * lowercase.length)];
    }
    allChars.push(...lowercase.split(''));
  }

  if (policy.requireNumbers) {
    for (let i = 0; i < policy.minNumbers; i++) {
      password += numbers[Math.floor(Math.random() * numbers.length)];
    }
    allChars.push(...numbers.split(''));
  }

  if (policy.requireSpecialChars) {
    for (let i = 0; i < policy.minSpecialChars; i++) {
      password += special[Math.floor(Math.random() * special.length)];
    }
    allChars.push(...special.split(''));
  }

  const targetLength = Math.max(policy.minLength, password.length + 4);
  while (password.length < targetLength) {
    password += allChars[Math.floor(Math.random() * allChars.length)];
  }

  return password.split('').sort(() => Math.random() - 0.5).join('');
}

const statusBadge: Record<string, string> = {
  ENABLED: 'bg-gradient-to-r from-emerald-400 to-teal-400 text-white border-0',
  DISABLED: 'bg-gradient-to-r from-red-400 to-rose-400 text-white border-0',
  LOCKED: 'bg-gradient-to-r from-amber-400 to-orange-400 text-white border-0',
  EXPIRED: 'bg-gradient-to-r from-slate-400 to-gray-400 text-white border-0',
};

export function UserListPage() {
  const { user: currentUser } = useAuth();
  const reauth = useReauth();
  const { userLabels } = useFieldLabels();
  const { formatDate, formatTime } = useDatetimeFormat();
  const paginationOptions = usePaginationConfig();
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(paginationOptions[0]);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionDialog, setActionDialog] = useState<{ type: string; userId: string; username: string; fullName?: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteDialog, setBulkDeleteDialog] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [unlockDialog, setUnlockDialog] = useState<{ userId: string; username: string } | null>(null);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [showUnlockPassword, setShowUnlockPassword] = useState(false);
  const [unlockCopied, setUnlockCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search input (300ms)
  useEffect(() => {
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Fetch all active roles
  const { data: rolesData } = useSWR<RoleData[]>('/api/roles/active');

  // Create roleColors map from dynamic roles
  const roleColors = useMemo(() => {
    const colors: Record<string, string> = {};
    rolesData?.forEach(role => {
      colors[role.name] = `${role.color} text-white`;
    });
    return colors;
  }, [rolesData]);

  // Get available roles for filter, excluding SUPER_ADMIN for Admin users
  const availableRoles = useMemo(() => {
    if (!rolesData) return [];
    if (currentUser?.role === 'ADMIN') {
      return rolesData.filter(r => r.name !== 'SUPER_ADMIN');
    }
    return rolesData;
  }, [rolesData, currentUser?.role]);

  // Build query params - filter by role and status on the server
  const params = new URLSearchParams({ page: String(page), limit: String(perPage) });
  if (debouncedSearch) params.set('search', debouncedSearch);
  if (roleFilter) params.set('role', roleFilter);
  if (statusFilter) params.set('status', statusFilter);

  const { data: rawData, mutate } = useSWR(`/api/users?${params}`);
  const { data: pendingData } = useSWR<PendingCount>('/api/users/reset-requests/pending');
  const { data: userStatsData, mutate: mutateStats } = useSWR<{ total: number; enabled: number; disabled: number; locked: number; expired: number }>('/api/users/stats');
  const { data: policyData } = useSWR<PasswordPolicyConfig>('/api/config/password-policy');
  const policy = { ...defaultPolicy, ...policyData };

  // Filter out SUPER_ADMIN users from the list for Admin users (only affects display, not server query)
  const data = rawData ? {
    ...rawData,
    data: currentUser?.role === 'ADMIN'
      ? rawData.data?.filter((u: any) => u.role !== 'SUPER_ADMIN')
      : rawData.data,
  } : null;

  const handleAction = async () => {
    if (!actionDialog) return;
    const actionMap: Record<string, string> = {
      delete: 'DELETE_USER',
      enable: 'ENABLE_USER',
      disable: 'DISABLE_USER',
    };
    const reauthAction = actionMap[actionDialog.type] || actionDialog.type;
    const { userId, type, username } = actionDialog;
    setActionDialog(null);
    setActionMessage(null);

    const actionLabels: Record<string, string> = {
      delete: 'deleted',
      enable: 'enabled',
      disable: 'disabled',
    };

    await reauth.execute(reauthAction, async (password?) => {
      if (type === 'delete') {
        if (password) await apiClient.deleteWithReauth(`/api/users/${userId}`, password);
        else await apiClient.delete(`/api/users/${userId}`);
      } else {
        if (password) await apiClient.postWithReauth(`/api/users/${userId}/${type}`, {}, password);
        else await apiClient.post(`/api/users/${userId}/${type}`, {});
      }
      mutate();
      mutateStats();
      if (type === 'delete') {
        setSelectedIds(prev => {
          const next = new Set(prev);
          next.delete(userId);
          return next;
        });
      }
      setActionMessage({ type: 'success', text: `User "${username}" has been ${actionLabels[type] || type} successfully.` });
      setTimeout(() => setActionMessage(null), 5000);
    }, {
      onError: (err: any) => {
        setActionMessage({ type: 'error', text: err?.message || `Failed to ${type} user "${username}".` });
        setTimeout(() => setActionMessage(null), 5000);
      },
    });
  };

  const isSuperAdmin = currentUser?.role === 'SUPER_ADMIN';

  // Get filtered user list for display
  const displayedUsers = data?.data ?? [];

  // Bulk selection helpers
  const selectableUsers = displayedUsers.filter((u: any) =>
    u.id !== currentUser?.id && u.role !== 'SUPER_ADMIN'
  );
  const allSelected = selectableUsers.length > 0 && selectableUsers.every((u: any) => selectedIds.has(u.id));
  const someSelected = selectableUsers.some((u: any) => selectedIds.has(u.id));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableUsers.map((u: any) => u.id)));
    }
  }, [allSelected, selectableUsers]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedIds);
    setBulkDeleteDialog(false);
    setActionMessage(null);

    await reauth.execute('BULK_DELETE_USERS', async (password?) => {
      if (password) await apiClient.postWithReauth('/api/users/bulk-delete', { userIds: ids }, password);
      else await apiClient.post('/api/users/bulk-delete', { userIds: ids });
      setSelectedIds(new Set());
      mutate();
      mutateStats();
      setActionMessage({ type: 'success', text: `${ids.length} user(s) deleted successfully.` });
      setTimeout(() => setActionMessage(null), 5000);
    }, {
      onError: (err: any) => {
        setActionMessage({ type: 'error', text: err?.message || 'Failed to delete selected users.' });
        setTimeout(() => setActionMessage(null), 5000);
      },
    });
  };

  // Clear selection on page/filter change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, search, roleFilter, statusFilter]);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Action feedback message */}
      {actionMessage && (
        <div
          className={`rounded-xl border p-4 text-sm flex items-center justify-between ${
            actionMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d={actionMessage.type === 'success'
                  ? 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
                  : 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'}
              />
            </svg>
            {actionMessage.text}
          </div>
          <button onClick={() => setActionMessage(null)} className="text-current opacity-60 hover:opacity-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg shadow-blue-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">User Management</h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage system users and their access permissions</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/users/reset-requests">
            <Button variant="outline" className="gap-2 relative border-amber-200 text-amber-700 hover:bg-amber-50">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              Password Resets
              {pendingData && pendingData.count > 0 && (
                <span className="absolute -top-2 -right-2 w-6 h-6 flex items-center justify-center text-xs font-bold bg-gradient-to-r from-red-500 to-rose-500 text-white rounded-full shadow-lg shadow-red-500/30">
                  {pendingData.count}
                </span>
              )}
            </Button>
          </Link>
          <Link to="/users/create">
            <Button className="gap-2 bg-gradient-to-r from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 shadow-lg shadow-blue-500/25">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Create User
            </Button>
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </div>
          <span className="font-semibold text-slate-700">Filter Users</span>
          {(search || roleFilter || statusFilter) && (
            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-700 rounded-full">
              {[search, roleFilter, statusFilter].filter(Boolean).length} active
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[280px]">
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Search</label>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 p-1 rounded-md bg-slate-100 group-focus-within:bg-indigo-100 transition-colors">
                <svg className="w-4 h-4 text-slate-400 group-focus-within:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <Input
                placeholder="Search by name, username, or email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-14 h-12 bg-slate-50/50 border-slate-200 focus:bg-white transition-colors"
              />
            </div>
          </div>
          <div className="flex gap-4">
            <div className="min-w-[200px]">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Role</label>
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-gradient-to-br from-purple-100 to-indigo-100 z-10 pointer-events-none">
                  <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
                <Select
                  value={roleFilter}
                  onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}
                  variant="filled"
                  className="pl-12 h-12"
                >
                  <option value="">All Roles</option>
                  {availableRoles.map((r) => (
                    <option key={r.name} value={r.name}>{r.displayName}</option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="min-w-[180px]">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Status</label>
              <div className="relative group">
                <div className="absolute left-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg bg-gradient-to-br from-emerald-100 to-teal-100 z-10 pointer-events-none">
                  <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <Select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                  variant="filled"
                  className="pl-12 h-12"
                >
                  <option value="">All Statuses</option>
                  {['ENABLED', 'DISABLED', 'LOCKED', 'EXPIRED'].map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </div>
            </div>
            {(search || roleFilter || statusFilter) && (
              <div className="flex items-end">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch('');
                    setRoleFilter('');
                    setStatusFilter('');
                    setPage(1);
                  }}
                  className="h-12 gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear All
                </Button>
              </div>
            )}
          </div>
        </div>
        {/* Active filters display */}
        {(search || roleFilter || statusFilter) && (
          <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-slate-100">
            <span className="text-xs font-medium text-slate-500">Active filters:</span>
            {search && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                "{search}"
                <button onClick={() => { setSearch(''); setPage(1); }} className="hover:text-blue-900">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            )}
            {roleFilter && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-50 text-purple-700 rounded-full text-xs font-medium">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                {rolesData?.find(r => r.name === roleFilter)?.displayName || roleFilter.replace('_', ' ')}
                <button onClick={() => { setRoleFilter(''); setPage(1); }} className="hover:text-purple-900">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            )}
            {statusFilter && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {statusFilter}
                <button onClick={() => { setStatusFilter(''); setPage(1); }} className="hover:text-emerald-900">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Stats Summary */}
      {userStatsData && (
        <div className="grid grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-blue-100">
                <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{userStatsData.total}</p>
                <p className="text-xs text-slate-500">Total Users</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-100">
                <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{userStatsData.enabled}</p>
                <p className="text-xs text-slate-500">Active</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-100">
                <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{userStatsData.locked}</p>
                <p className="text-xs text-slate-500">Locked</p>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-red-100">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                </svg>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-800">{userStatsData.disabled}</p>
                <p className="text-xs text-slate-500">Disabled</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Selection Toolbar */}
      {isSuperAdmin && selectedIds.size > 0 && (
        <div className="bg-gradient-to-r from-red-50 to-rose-50 rounded-2xl border border-red-200 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-red-800">
              {selectedIds.size} user{selectedIds.size !== 1 ? 's' : ''} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedIds(new Set())}
              className="border-red-200 text-red-600 hover:bg-red-50"
            >
              Clear Selection
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteDialog(true)}
              className="gap-2 bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Selected
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-gradient-to-r from-slate-50 to-white border-b border-slate-100">
              {isSuperAdmin && (
                <TableHead className="w-12">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected; }}
                    onChange={toggleSelectAll}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                </TableHead>
              )}
              <TableHead className="font-semibold text-slate-600">{userLabels.fullName}</TableHead>
              <TableHead className="font-semibold text-slate-600">{userLabels.email}</TableHead>
              <TableHead className="font-semibold text-slate-600">{userLabels.role}</TableHead>
              <TableHead className="font-semibold text-slate-600">{userLabels.status}</TableHead>
              <TableHead className="font-semibold text-slate-600">Last Login</TableHead>
              <TableHead className="text-right font-semibold text-slate-600">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayedUsers.map((user: any) => (
              <TableRow key={user.id} className={`hover:bg-slate-50/50 transition-colors ${selectedIds.has(user.id) ? 'bg-blue-50/50' : ''}`}>
                {isSuperAdmin && (
                  <TableCell className="w-12">
                    {user.id !== currentUser?.id && user.role !== 'SUPER_ADMIN' ? (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(user.id)}
                        onChange={() => toggleSelect(user.id)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    ) : (
                      <span className="w-4 h-4 block" />
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#1e3a5f] to-[#3b82f6] flex items-center justify-center text-white font-semibold text-sm shadow-md">
                      {user.fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">{user.fullName}</p>
                      <p className="text-sm text-slate-500 font-mono">@{user.username}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-slate-600">{user.email}</TableCell>
                <TableCell>
                  <Badge className={`${roleColors[user.role] ?? 'bg-slate-500 text-white'} shadow-sm`}>
                    {rolesData?.find(r => r.name === user.role)?.displayName || user.role.replace('_', ' ')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={`${statusBadge[user.status] ?? 'bg-slate-100 text-slate-600'} shadow-sm`}>{user.status}</Badge>
                </TableCell>
                <TableCell>
                  {user.lastLogin ? (
                    <div>
                      <p className="text-slate-600 text-sm">{formatDate(user.lastLogin)}</p>
                      <p className="text-slate-400 text-xs">{formatTime(user.lastLogin)}</p>
                    </div>
                  ) : (
                    <span className="text-slate-400 text-sm">Never</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Link to={`/users/${user.id}`}>
                      <Button variant="outline" size="sm" className="gap-1.5 border-slate-200 hover:bg-slate-50">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        Edit
                      </Button>
                    </Link>
                    {user.status === 'LOCKED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                        onClick={() => {
                          const pwd = generatePassword(policy);
                          setUnlockPassword(pwd);
                          setShowUnlockPassword(false);
                          setUnlockCopied(false);
                          setUnlockDialog({ userId: user.id, username: user.username });
                        }}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                        </svg>
                        Unlock
                      </Button>
                    )}
                    {user.status === 'ENABLED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => setActionDialog({ type: 'disable', userId: user.id, username: user.username })}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                        </svg>
                        Disable
                      </Button>
                    )}
                    {user.status === 'DISABLED' && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                        onClick={() => setActionDialog({ type: 'enable', userId: user.id, username: user.username })}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Enable
                      </Button>
                    )}
                    {/* Delete button - only for SUPER_ADMIN and not for own account */}
                    {isSuperAdmin && user.id !== currentUser?.id && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                        onClick={() => setActionDialog({ type: 'delete', userId: user.id, username: user.username, fullName: user.fullName })}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {displayedUsers.length === 0 && (
              <TableRow>
                <TableCell colSpan={isSuperAdmin ? 7 : 6} className="text-center py-16">
                  <div className="flex flex-col items-center gap-4">
                    <div className="p-4 rounded-2xl bg-slate-100">
                      <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-slate-600 font-semibold">No users found</p>
                      <p className="text-sm text-slate-400 mt-1">Try adjusting your search or filters</p>
                    </div>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="text-slate-500">Rows per page:</span>
            <div className="flex items-center gap-1">
              {paginationOptions.map((opt) => (
                <button
                  key={opt}
                  onClick={() => { setPerPage(opt); setPage(1); }}
                  className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
                    perPage === opt
                      ? 'bg-indigo-500 text-white shadow-sm'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {opt}
                </button>
              ))}
            </div>
            <span className="text-slate-300">|</span>
            <span>
              Page <span className="font-semibold text-slate-800">{data.page}</span> of{' '}
              <span className="font-semibold text-slate-800">{data.totalPages}</span>
              <span className="text-slate-400 ml-2">({data.total.toLocaleString()} total users)</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(1)}
              className="px-3"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-4"
            >
              Previous
            </Button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => {
                let pageNum;
                if (data.totalPages <= 5) {
                  pageNum = i + 1;
                } else if (page <= 3) {
                  pageNum = i + 1;
                } else if (page >= data.totalPages - 2) {
                  pageNum = data.totalPages - 4 + i;
                } else {
                  pageNum = page - 2 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                      pageNum === page
                        ? 'bg-indigo-500 text-white shadow-md'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-4"
            >
              Next
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage(data.totalPages)}
              className="px-3"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
              </svg>
            </Button>
          </div>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={!!actionDialog} onClose={() => setActionDialog(null)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${
              actionDialog?.type === 'delete' ? 'bg-red-100' :
              actionDialog?.type === 'disable' ? 'bg-red-100' : 'bg-emerald-100'
            }`}>
              <svg className={`w-5 h-5 ${
                actionDialog?.type === 'delete' ? 'text-red-600' :
                actionDialog?.type === 'disable' ? 'text-red-600' : 'text-emerald-600'
              }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                {actionDialog?.type === 'enable' && (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                )}
                {actionDialog?.type === 'disable' && (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
                )}
                {actionDialog?.type === 'delete' && (
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                )}
              </svg>
            </div>
            {actionDialog?.type === 'enable' ? 'Enable' :
             actionDialog?.type === 'delete' ? 'Delete' : 'Disable'} User
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-slate-600">
            Are you sure you want to {actionDialog?.type} user <strong className="text-slate-800">{actionDialog?.fullName || actionDialog?.username}</strong>?
          </p>
          {actionDialog?.type === 'disable' && (
            <div className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
              <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm text-red-700">
                This will terminate all active sessions for this user. They will not be able to log in until re-enabled.
              </p>
            </div>
          )}
          {actionDialog?.type === 'delete' && (
            <div className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
              <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div className="text-sm text-red-700">
                <p className="font-semibold">Warning: This action is irreversible!</p>
                <p className="mt-1">This will permanently disable the user account, terminate all active sessions, and the user will not be able to log in. The user data will be retained for audit purposes.</p>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button>
          <Button
            variant={(actionDialog?.type === 'disable' || actionDialog?.type === 'delete') ? 'destructive' : 'default'}
            onClick={handleAction}
            className={(actionDialog?.type === 'disable' || actionDialog?.type === 'delete')
              ? 'bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600'
              : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600'
            }
          >
            {actionDialog?.type === 'enable' && (
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
            {actionDialog?.type === 'disable' && (
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
              </svg>
            )}
            {actionDialog?.type === 'delete' && (
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
            {actionDialog?.type === 'delete' ? 'Delete User' : 'Confirm'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={bulkDeleteDialog} onClose={() => setBulkDeleteDialog(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </div>
            Delete {selectedIds.size} User{selectedIds.size !== 1 ? 's' : ''}
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-slate-600">
            Are you sure you want to delete the following users?
          </p>
          <div className="mt-3 max-h-48 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
            {displayedUsers
              .filter((u: any) => selectedIds.has(u.id))
              .map((u: any) => (
                <div key={u.id} className="flex items-center gap-3 px-4 py-2">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#1e3a5f] to-[#3b82f6] flex items-center justify-center text-white text-xs font-semibold">
                    {u.fullName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-800">{u.fullName}</p>
                    <p className="text-xs text-slate-500">@{u.username}</p>
                  </div>
                </div>
              ))}
          </div>
          <div className="mt-4 flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-red-700">
              <p className="font-semibold">Warning: This action is irreversible!</p>
              <p className="mt-1">All selected accounts will be permanently disabled, their active sessions will be terminated, and they will not be able to log in.</p>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setBulkDeleteDialog(false)}>Cancel</Button>
          <Button
            variant="destructive"
            onClick={handleBulkDelete}
            disabled={bulkDeleting}
            className="bg-gradient-to-r from-red-500 to-rose-500 hover:from-red-600 hover:to-rose-600"
          >
            {bulkDeleting ? 'Deleting...' : `Delete ${selectedIds.size} User${selectedIds.size !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Unlock Account Dialog with Temporary Password */}
      <Dialog open={!!unlockDialog} onClose={() => setUnlockDialog(null)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100">
              <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
              </svg>
            </div>
            Unlock Account
          </DialogTitle>
        </DialogHeader>
        <div className="py-4 space-y-4">
          <p className="text-slate-600">
            Unlock user <strong className="text-slate-800">@{unlockDialog?.username}</strong> with a temporary password. The user must change their password on next login.
          </p>

          <div className="space-y-3">
            <label className="block text-sm font-semibold text-slate-700">Temporary Password</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 relative">
                <input
                  type={showUnlockPassword ? 'text' : 'password'}
                  value={unlockPassword}
                  readOnly
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowUnlockPassword(!showUnlockPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showUnlockPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(unlockPassword);
                    setUnlockCopied(true);
                    setTimeout(() => setUnlockCopied(false), 2000);
                  } catch {
                    const textArea = document.createElement('textarea');
                    textArea.value = unlockPassword;
                    document.body.appendChild(textArea);
                    textArea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textArea);
                    setUnlockCopied(true);
                    setTimeout(() => setUnlockCopied(false), 2000);
                  }
                }}
                className={`gap-1.5 shrink-0 ${unlockCopied ? 'border-emerald-300 text-emerald-600' : ''}`}
              >
                {unlockCopied ? (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setUnlockPassword(generatePassword(policy));
                  setUnlockCopied(false);
                }}
                className="gap-1.5 shrink-0"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Regenerate
              </Button>
            </div>
          </div>

          <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-amber-700">
              Please copy and share this temporary password with the user securely. They will be required to set a new password upon login.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setUnlockDialog(null)}>Cancel</Button>
          <Button
            className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
            onClick={async () => {
              if (!unlockDialog) return;
              const { userId } = unlockDialog;
              const pwd = unlockPassword;
              setUnlockDialog(null);

              await reauth.execute('UNLOCK_USER', async (password?) => {
                if (password) await apiClient.postWithReauth(`/api/users/${userId}/unlock`, { newPassword: pwd }, password);
                else await apiClient.post(`/api/users/${userId}/unlock`, { newPassword: pwd });
                setUnlockPassword('');
                mutate();
                mutateStats();
              });
            }}
          >
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
            </svg>
            Unlock Account
          </Button>
        </DialogFooter>
      </Dialog>

      {/* Reauth Dialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="User Action"
      />
    </div>
  );
}
