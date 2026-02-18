import { useState, useMemo, useEffect } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { usePaginationConfig } from '@/hooks/use-pagination-config';
import { apiClient } from '@/lib/api-client';
import { getDefaultTemplates } from '@digilog/shared';
import type { RoleData } from '@digilog/shared';

const ACTION_COLORS: Record<string, string> = {
  LOGIN: 'bg-green-100 text-green-700 border-green-200',
  LOGOUT: 'bg-slate-100 text-slate-700 border-slate-200',
  LOGIN_FAILED: 'bg-red-100 text-red-700 border-red-200',
  USER_CREATED: 'bg-blue-100 text-blue-700 border-blue-200',
  USER_UPDATED: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  USER_DELETED: 'bg-red-100 text-red-700 border-red-200',
  PASSWORD_CHANGED: 'bg-amber-100 text-amber-700 border-amber-200',
  CONFIG_CHANGED: 'bg-purple-100 text-purple-700 border-purple-200',
  TEMPLATE_CREATED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  TEMPLATE_UPDATED: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  NODE_CREATED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  NODE_UPDATED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  ROLE_CREATED: 'bg-violet-100 text-violet-700 border-violet-200',
  ROLE_UPDATED: 'bg-violet-100 text-violet-700 border-violet-200',
  ROLE_DELETED: 'bg-red-100 text-red-700 border-red-200',
};

// Actions that represent failures
const FAIL_ACTIONS = new Set([
  'LOGIN_FAILED',
  'UNAUTHORIZED_ACTION_ATTEMPT',
  'ACCOUNT_LOCKED',
]);

function getAuditStatus(action: string): 'Success' | 'Fail' {
  return FAIL_ACTIONS.has(action) ? 'Fail' : 'Success';
}

function getAuditSummary(record: any, templates: Record<string, string>): string {
  const actor = record.userId || 'System';
  const before = record.beforeValue || {};
  const after = record.afterValue || {};
  const targetType = record.targetType || '';

  const targetUser = after.username || before.username || record.targetId || '';
  const isSelf = targetUser === actor;
  const targetName = after.name || before.name || after.label || before.label || record.targetId || '';
  const configKey = record.targetId || targetType || '';

  const replacePlaceholders = (tpl: string) =>
    tpl
      .replace(/\{actor\}/g, actor)
      .replace(/\{targetUser\}/g, targetUser || actor)
      .replace(/\{targetName\}/g, targetName)
      .replace(/\{configKey\}/g, configKey)
      .replace(/\{targetType\}/g, targetType || 'Data');

  // Self-action handling: check for _SELF variant
  const selfActions = ['USER_UPDATED', 'PROFILE_UPDATED', 'PASSWORD_CHANGED'];
  if (isSelf && selfActions.includes(record.action)) {
    const selfKey = record.action + '_SELF';
    const selfTemplate = templates[selfKey];
    if (selfTemplate) {
      return replacePlaceholders(selfTemplate);
    }
  }

  const template = templates[record.action];
  if (template) {
    return replacePlaceholders(template);
  }

  // Fallback for unknown actions
  const label = record.action.replace(/_/g, ' ').toLowerCase();
  const name = targetName || targetUser;
  return name ? `${label} — "${name}" by ${actor}` : `${label} by ${actor}`;
}

export function AuditTrailPage() {
  const { user } = useAuth();
  const { formatDate, formatTime, formatDateTime } = useDatetimeFormat();
  const paginationOptions = usePaginationConfig();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(paginationOptions[0]);

  // Fetch configurable audit text templates (cached for 5 min)
  const { data: templatesData } = useSWR<Record<string, string>>('/api/config/audit-templates/current', {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
  const templates = useMemo(() => templatesData ?? getDefaultTemplates(), [templatesData]);

  // Fetch roles for dynamic colors
  const { data: rolesData } = useSWR<RoleData[]>('/api/roles/active');

  // Create roleColors map from dynamic roles
  const ROLE_COLORS = useMemo(() => {
    const colors: Record<string, string> = {};
    rolesData?.forEach(role => {
      colors[role.name] = `${role.color} text-white`;
    });
    return colors;
  }, [rolesData]);
  const [search, setSearch] = useState('');
  const [fromDateTime, setFromDateTime] = useState('');
  const [toDateTime, setToDateTime] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sortBy, setSortBy] = useState<'timestamp' | 'action' | 'userId' | 'userRole'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const toggleSort = (field: typeof sortBy) => {
    if (sortBy === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder(field === 'timestamp' ? 'desc' : 'asc');
    }
    setPage(1);
  };

  const params = new URLSearchParams({ page: String(page), limit: String(perPage), sortBy, sortOrder });
  if (search) params.set('search', search);

  // Use combined datetime values for API
  if (fromDateTime) {
    params.set('startDate', fromDateTime);
  }
  if (toDateTime) {
    params.set('endDate', toDateTime);
  }

  const { data, isLoading, mutate } = useSWR(`/api/audit?${params}`);

  // Clear selection on page/filter change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [page, search, fromDateTime, toDateTime]);

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data?.data) return;
    const allIds = data.data.map((r: any) => r.id as number);
    const allSelected = allIds.every((id: number) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const isAllSelected = data?.data?.length > 0 && data.data.every((r: any) => selectedIds.has(r.id));
  const isSomeSelected = selectedIds.size > 0;

  const deleteSingleAudit = async (id: number) => {
    try {
      await apiClient.delete(`/api/audit/${id}`);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      mutate();
    } catch (err) {
      console.error('Failed to delete audit record:', err);
    }
  };

  const bulkDeleteAudit = async () => {
    setDeleting(true);
    try {
      await apiClient.post('/api/audit/bulk-delete', { ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      setShowDeleteConfirm(false);
      mutate();
    } catch (err) {
      console.error('Failed to bulk delete audit records:', err);
    } finally {
      setDeleting(false);
    }
  };

  const clearFilters = () => {
    setSearch('');
    setFromDateTime('');
    setToDateTime('');
    setPage(1);
  };

  const hasFilters = search || fromDateTime || toDateTime;

  // Format datetime for display using global config
  const formatDateTimeDisplay = (datetime: string) => {
    if (!datetime) return '';
    return formatDateTime(datetime);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Audit Trail</h1>
            <p className="text-sm text-slate-500">21 CFR Part 11 Compliant Activity Log</p>
          </div>
        </div>
        {data && (
          <div className="text-right">
            <p className="text-2xl font-bold text-slate-800">{data.total.toLocaleString()}</p>
            <p className="text-xs text-slate-500">Total Records</p>
          </div>
        )}
      </div>

      {/* Filters Card - Enhanced Professional Design */}
      <Card className="border-0 shadow-xl bg-gradient-to-br from-white via-white to-slate-50/50 overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        <CardContent className="p-6">
          {/* Filter Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-lg shadow-indigo-500/25">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Filter Records</h3>
                <p className="text-xs text-slate-500">Search and filter audit entries</p>
              </div>
            </div>
            {hasFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="text-slate-500 hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-all"
              >
                <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear All
              </Button>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Search Filter */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                Search
              </label>
              <div className="relative group">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-indigo-500/20 to-purple-500/20 blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative">
                  <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <Input
                    placeholder="Search by user, action, target..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-10 h-12 rounded-xl border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                  />
                </div>
              </div>
            </div>

            {/* From Date & Time - Combined */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <svg className="w-4 h-4 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                From Date & Time
              </label>
              <div className="relative group">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-emerald-500/20 to-teal-500/20 blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative bg-white rounded-xl border border-slate-200 hover:border-emerald-400 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all overflow-hidden">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 p-3 bg-gradient-to-br from-emerald-500 to-teal-600 text-white">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <input
                      type="datetime-local"
                      value={fromDateTime}
                      onChange={(e) => { setFromDateTime(e.target.value); setPage(1); }}
                      className="flex-1 h-12 px-4 text-sm font-medium text-slate-700 bg-transparent border-0 focus:outline-none focus:ring-0 [color-scheme:light]"
                    />
                  </div>
                </div>
              </div>
              {fromDateTime && (
                <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {formatDateTimeDisplay(fromDateTime)}
                </p>
              )}
            </div>

            {/* To Date & Time - Combined */}
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <svg className="w-4 h-4 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                To Date & Time
              </label>
              <div className="relative group">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-r from-rose-500/20 to-pink-500/20 blur-sm opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative bg-white rounded-xl border border-slate-200 hover:border-rose-400 focus-within:border-rose-500 focus-within:ring-2 focus-within:ring-rose-500/20 transition-all overflow-hidden">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 p-3 bg-gradient-to-br from-rose-500 to-pink-600 text-white">
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <input
                      type="datetime-local"
                      value={toDateTime}
                      onChange={(e) => { setToDateTime(e.target.value); setPage(1); }}
                      className="flex-1 h-12 px-4 text-sm font-medium text-slate-700 bg-transparent border-0 focus:outline-none focus:ring-0 [color-scheme:light]"
                    />
                  </div>
                </div>
              </div>
              {toDateTime && (
                <p className="text-xs text-rose-600 font-medium flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  {formatDateTimeDisplay(toDateTime)}
                </p>
              )}
            </div>
          </div>

          {/* Active Filters Display */}
          {hasFilters && (
            <div className="mt-5 pt-5 border-t border-slate-100">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Filters:</span>
                {search && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-medium border border-indigo-100">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Search: {search}
                    <button
                      onClick={() => setSearch('')}
                      className="ml-1 hover:text-indigo-900 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}
                {fromDateTime && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 text-xs font-medium border border-emerald-100">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    From: {formatDateTimeDisplay(fromDateTime)}
                    <button
                      onClick={() => setFromDateTime('')}
                      className="ml-1 hover:text-emerald-900 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}
                {toDateTime && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 text-xs font-medium border border-rose-100">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    To: {formatDateTimeDisplay(toDateTime)}
                    <button
                      onClick={() => setToDateTime('')}
                      className="ml-1 hover:text-rose-900 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SUPER_ADMIN Selection Toolbar */}
      {isSuperAdmin && isSomeSelected && (
        <div className="bg-white rounded-2xl border-2 border-red-200 shadow-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100">
              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-700">{selectedIds.size} audit record{selectedIds.size > 1 ? 's' : ''} selected</span>
            <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-700 underline">
              Clear Selection
            </button>
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(true)} className="gap-1.5 text-red-700 border-red-200 hover:bg-red-50">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            Delete Selected
          </Button>
        </div>
      )}

      {/* Table Card */}
      <Card className="border-slate-200/60 shadow-soft overflow-hidden">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12 text-center">
              <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p className="text-slate-500">Loading audit records...</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    {isSuperAdmin && (
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          checked={isAllSelected}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                      </TableHead>
                    )}
                    <TableHead>
                      <button onClick={() => toggleSort('timestamp')} className="flex items-center gap-1.5 font-semibold text-slate-600 hover:text-indigo-600 transition-colors group">
                        Timestamp
                        <span className={`transition-colors ${sortBy === 'timestamp' ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                          {sortBy === 'timestamp' ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
                        </span>
                      </button>
                    </TableHead>
                    <TableHead className="font-semibold text-slate-600">Description</TableHead>
                    <TableHead>
                      <button onClick={() => toggleSort('action')} className="flex items-center gap-1.5 font-semibold text-slate-600 hover:text-indigo-600 transition-colors group">
                        Action
                        <span className={`transition-colors ${sortBy === 'action' ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                          {sortBy === 'action' ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
                        </span>
                      </button>
                    </TableHead>
                    <TableHead>
                      <button onClick={() => toggleSort('userId')} className="flex items-center gap-1.5 font-semibold text-slate-600 hover:text-indigo-600 transition-colors group">
                        Performed By
                        <span className={`transition-colors ${sortBy === 'userId' ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                          {sortBy === 'userId' ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
                        </span>
                      </button>
                    </TableHead>
                    <TableHead className="font-semibold text-slate-600">Status</TableHead>
                    {isSuperAdmin && (
                      <TableHead className="font-semibold text-slate-600 text-center">Details</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.data?.map((record: any) => {
                    const status = getAuditStatus(record.action);
                    return (
                    <TableRow key={record.id} className={`hover:bg-slate-50/50 transition-colors ${isSuperAdmin && selectedIds.has(record.id) ? 'bg-red-50/40' : ''}`}>
                      {isSuperAdmin && (
                        <TableCell className="w-10">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(record.id)}
                            onChange={() => toggleSelect(record.id)}
                            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                          />
                        </TableCell>
                      )}
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-slate-100">
                            <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-slate-800">
                              {formatDate(record.timestamp)}
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatTime(record.timestamp)}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className="text-sm text-slate-700"
                          title={getAuditSummary(record, templates)}
                        >
                          {(() => {
                            const desc = getAuditSummary(record, templates);
                            return desc.length > 70 ? desc.slice(0, 67) + '...' : desc;
                          })()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium border ${ACTION_COLORS[record.action] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                          {record.action}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-xs font-bold text-slate-600">
                            {record.userId?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <span className="text-sm font-medium text-slate-700">{record.userId}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {status === 'Success' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                            Success
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
                            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                            </svg>
                            Fail
                          </span>
                        )}
                      </TableCell>
                      {isSuperAdmin && (
                        <TableCell className="text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedRecord(record)}
                              className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteSingleAudit(record.id)}
                              className="text-red-500 hover:text-red-700 hover:bg-red-50"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                    );
                  })}
                  {(!data?.data || data.data.length === 0) && (
                    <TableRow>
                      <TableCell colSpan={isSuperAdmin ? 8 : 5} className="text-center py-12">
                        <div className="p-4 rounded-2xl bg-slate-100 inline-block mb-4">
                          <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <p className="text-slate-600 font-medium">No audit records found</p>
                        <p className="text-sm text-slate-400 mt-1">Try adjusting your filters</p>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 p-4">
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
              <span className="text-slate-400 ml-2">({data.total.toLocaleString()} total records)</span>
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

      {/* Detail Dialog */}
      <Dialog open={!!selectedRecord} onClose={() => setSelectedRecord(null)} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-100 text-indigo-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            Audit Record Detail
          </DialogTitle>
        </DialogHeader>
        {selectedRecord && (() => {
          const detailStatus = getAuditStatus(selectedRecord.action);
          return (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {/* Action Summary */}
            <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100">
              <p className="text-sm font-semibold text-indigo-900">
                {getAuditSummary(selectedRecord, templates)}
              </p>
              <div className="flex items-center gap-3 mt-2">
                <p className="text-xs text-indigo-500">
                  {formatDateTime(selectedRecord.timestamp)}
                </p>
                {detailStatus === 'Success' ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200">
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                    Success
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200">
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                    Fail
                  </span>
                )}
              </div>
            </div>

            {/* Common Info Grid — All users see this */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-xl bg-slate-50">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Record ID</p>
                <p className="text-sm font-semibold text-slate-800 mt-1">#{selectedRecord.id}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Timestamp</p>
                <p className="text-sm font-semibold text-slate-800 mt-1">
                  {formatDateTime(selectedRecord.timestamp)}
                </p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Performed By</p>
                <p className="text-sm font-semibold text-slate-800 mt-1">{selectedRecord.userId}</p>
              </div>
              <div className="p-3 rounded-xl bg-slate-50">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Action</p>
                <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium border mt-1 ${ACTION_COLORS[selectedRecord.action] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                  {selectedRecord.action}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-slate-50">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</p>
                <div className="mt-1">
                  {detailStatus === 'Success' ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">Success</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Fail</span>
                  )}
                </div>
              </div>
              {isSuperAdmin && (
                <div className="p-3 rounded-xl bg-slate-50">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">User Role</p>
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold mt-1 ${ROLE_COLORS[selectedRecord.userRole] || 'bg-slate-100 text-slate-700'}`}>
                    {selectedRecord.userRole}
                  </span>
                </div>
              )}
            </div>

            {/* SUPER_ADMIN extra details */}
            {isSuperAdmin && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-3 rounded-xl bg-slate-50">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">IP Address</p>
                    <p className="text-sm font-mono text-slate-800 mt-1">{selectedRecord.ipAddress || '-'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Target Type</p>
                    <p className="text-sm font-semibold text-slate-800 mt-1">{selectedRecord.targetType || '-'}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-slate-50 col-span-2">
                    <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Target ID</p>
                    <p className="text-sm font-mono text-slate-800 mt-1 break-all">{selectedRecord.targetId || '-'}</p>
                  </div>
                </div>

                {/* Before/After Values */}
                {selectedRecord.beforeValue && (
                  <div className="rounded-xl border border-red-100 overflow-hidden">
                    <div className="px-4 py-2 bg-red-50 border-b border-red-100">
                      <p className="text-xs font-semibold text-red-700 uppercase tracking-wider">Previous Value</p>
                    </div>
                    <div className="p-4 bg-white space-y-2">
                      {Object.entries(selectedRecord.beforeValue).map(([key, value]) => (
                        <div key={key} className="flex items-start gap-3 py-1.5 border-b border-slate-50 last:border-0">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[120px] pt-0.5">
                            {key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim()}
                          </span>
                          <span className="text-sm text-slate-800 break-all">
                            {value === null || value === undefined ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedRecord.afterValue && (
                  <div className="rounded-xl border border-green-100 overflow-hidden">
                    <div className="px-4 py-2 bg-green-50 border-b border-green-100">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wider">New Value</p>
                    </div>
                    <div className="p-4 bg-white space-y-2">
                      {Object.entries(selectedRecord.afterValue).map(([key, value]) => (
                        <div key={key} className="flex items-start gap-3 py-1.5 border-b border-slate-50 last:border-0">
                          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[120px] pt-0.5">
                            {key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim()}
                          </span>
                          <span className="text-sm text-slate-800 break-all">
                            {value === null || value === undefined ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Checksum */}
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Integrity Checksum (SHA-256)</p>
                  </div>
                  <code className="text-xs font-mono text-slate-600 break-all">{selectedRecord.checksum}</code>
                </div>
              </>
            )}

            {/* Reason — visible to all */}
            {selectedRecord.reason && (
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
                <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Reason</p>
                <p className="text-sm text-amber-800">{selectedRecord.reason}</p>
              </div>
            )}
          </div>
          );
        })()}
      </Dialog>

      {/* Bulk Delete Confirmation Dialog */}
      <Dialog open={showDeleteConfirm} onClose={() => setShowDeleteConfirm(false)} className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-red-100 text-red-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            Delete Audit Records
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Are you sure you want to permanently delete <span className="font-semibold text-red-700">{selectedIds.size}</span> audit record{selectedIds.size > 1 ? 's' : ''}? This action cannot be undone.
          </p>
          <div className="p-3 rounded-lg bg-red-50 border border-red-100">
            <p className="text-xs text-red-700 font-medium">Warning: Deleting audit records may affect 21 CFR Part 11 compliance. Ensure this action is authorized and documented.</p>
          </div>
          <div className="flex items-center justify-end gap-3">
            <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={bulkDeleteAudit} disabled={deleting} className="bg-red-600 hover:bg-red-700 text-white">
              {deleting ? 'Deleting...' : `Delete ${selectedIds.size} Record${selectedIds.size > 1 ? 's' : ''}`}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
