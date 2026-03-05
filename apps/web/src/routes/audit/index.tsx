import { useState, useMemo, useEffect } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { usePaginationConfig } from '@/hooks/use-pagination-config';
import { useRoleColors } from '@/hooks/use-role-colors';
import { apiClient } from '@/lib/api-client';
import { getDefaultTemplates } from '@digilog/shared';
import { ACTION_COLORS, getAuditStatus, getAuditSummary } from './audit-helpers';
import { AuditFilters } from './components/audit-filters';
import { AuditTable } from './components/audit-table';
import { AuditDetailModal } from './components/audit-detail-modal';
import { AuditPagination } from './components/audit-pagination';
import { AuditDeleteDialog } from './components/audit-delete-dialog';

export function AuditTrailPage() {
  const { user } = useAuth();
  const { formatDate, formatTime, formatDateTime } = useDatetimeFormat();
  const paginationOptions = usePaginationConfig();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN' || (user?.permissions?.includes('CONFIG_UPDATE') ?? false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(paginationOptions[0]);

  // Fetch configurable audit text templates (cached for 5 min)
  const { data: templatesData } = useSWR<Record<string, string>>('/api/config/audit-templates/current', {
    dedupingInterval: 300000,
    revalidateOnFocus: false,
  });
  const templates = useMemo(() => templatesData ?? getDefaultTemplates(), [templatesData]);

  // Fetch roles for dynamic colors
  const { roleColors: ROLE_COLORS } = useRoleColors();
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

  // Use combined datetime values for API — convert local time to UTC ISO string
  if (fromDateTime) {
    params.set('startDate', new Date(fromDateTime).toISOString());
  }
  if (toDateTime) {
    params.set('endDate', new Date(toDateTime).toISOString());
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

      {/* Filters Card */}
      <AuditFilters
        search={search}
        setSearch={setSearch}
        fromDateTime={fromDateTime}
        setFromDateTime={setFromDateTime}
        toDateTime={toDateTime}
        setToDateTime={setToDateTime}
        setPage={setPage}
        formatDateTimeDisplay={formatDateTimeDisplay}
        hasFilters={hasFilters}
        clearFilters={clearFilters}
      />

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
      <AuditTable
        data={data}
        isLoading={isLoading}
        isSuperAdmin={isSuperAdmin}
        selectedIds={selectedIds}
        toggleSelect={toggleSelect}
        toggleSelectAll={toggleSelectAll}
        isAllSelected={isAllSelected}
        sortBy={sortBy}
        sortOrder={sortOrder}
        toggleSort={toggleSort}
        formatDate={formatDate}
        formatTime={formatTime}
        getAuditSummary={getAuditSummary}
        getAuditStatus={getAuditStatus}
        templates={templates}
        ACTION_COLORS={ACTION_COLORS}
        onViewRecord={setSelectedRecord}
        onDeleteRecord={deleteSingleAudit}
      />

      {/* Pagination */}
      <AuditPagination
        page={page}
        setPage={setPage}
        perPage={perPage}
        setPerPage={setPerPage}
        data={data}
        paginationOptions={paginationOptions}
      />

      {/* Detail Dialog */}
      <AuditDetailModal
        selectedRecord={selectedRecord}
        onClose={() => setSelectedRecord(null)}
        isSuperAdmin={isSuperAdmin}
        formatDateTime={formatDateTime}
        getAuditSummary={getAuditSummary}
        getAuditStatus={getAuditStatus}
        templates={templates}
        ACTION_COLORS={ACTION_COLORS}
        ROLE_COLORS={ROLE_COLORS}
      />

      {/* Bulk Delete Confirmation Dialog */}
      <AuditDeleteDialog
        open={showDeleteConfirm}
        selectedCount={selectedIds.size}
        deleting={deleting}
        onClose={() => setShowDeleteConfirm(false)}
        onConfirm={bulkDeleteAudit}
      />
    </div>
  );
}
