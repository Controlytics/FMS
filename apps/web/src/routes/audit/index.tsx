import { useState, useMemo, useEffect } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { usePaginationConfig } from '@/hooks/use-pagination-config';
import { useReportConfig } from '@/hooks/use-report-config';
import { useRoleColors } from '@/hooks/use-role-colors';
import { apiClient, api } from '@/lib/api-client';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { getDefaultTemplates } from '@digilog/shared';
import { ReportPageWrapper } from '@/components/report-page-wrapper';
import { ACTION_COLORS, getAuditStatus, getAuditSummary } from './audit-helpers';
import { AuditFilters } from './components/audit-filters';
import { AuditTable } from './components/audit-table';
import { AuditDetailModal } from './components/audit-detail-modal';
import { AuditPagination } from './components/audit-pagination';
import { AuditDeleteDialog } from './components/audit-delete-dialog';
import { createReport } from '../../lib/pdf-report';

export function AuditTrailPage() {
  const { user } = useAuth();
  const reauth = useReauth();
  const { formatDate, formatTime, formatDateTime } = useDatetimeFormat();
  const paginationOptions = usePaginationConfig();
  const { config: reportConfig } = useReportConfig();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  // AUDIT_EXPORT was previously a no-op FE flag (server-side PDF generation
  // doesn't exist — see audit/routes.ts; the export is jsPDF in the browser).
  // The button itself was unguarded, so any user reaching this page (gated on
  // AUDIT_READ) could PDF the data regardless of the `audit.export` toggle.
  // Hide the button when the toggle is off so the FE flag actually does
  // something. Bypass for SUPER_ADMIN per project convention.
  const canExport = isSuperAdmin || perms.includes('AUDIT_EXPORT');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(reportConfig.recordsPerPage);

  // Fetch configurable audit text templates (cached for 5 min)
  const { data: templatesData } = useSWR<Record<string, string>>('/api/config/audit-templates/current', {
    revalidateOnMount: true, dedupingInterval: 5000,
    revalidateOnFocus: false,
  });
  const templates = useMemo(() => templatesData ?? getDefaultTemplates(), [templatesData]);

  // Fetch roles for dynamic colors
  const { roleColors: ROLE_COLORS } = useRoleColors();
  const [search, setSearch] = useState('');
  const [fromDateTime, setFromDateTime] = useState('');
  const [toDateTime, setToDateTime] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
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

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data?.data) return;
    const allIds = data.data.map((r: any) => r.id as string);
    const allSelected = allIds.every((id: string) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const isAllSelected = data?.data?.length > 0 && data.data.every((r: any) => selectedIds.has(r.id));
  const isSomeSelected = selectedIds.size > 0;

  // Audit 2026-05-04 fix #5 (web-routes review H4): per § 11.10(e), audit
  // deletion must be challengeable. Distinct keys for single vs bulk so the
  // operator intent is recorded in the surviving audit trail.
  const deleteSingleAudit = (id: string) => {
    reauth.execute(
      'DELETE_AUDIT_RECORD',
      async (password?: string) => {
        if (password) await api.deleteWithReauth(`/api/audit/${id}`, password);
        else await apiClient.delete(`/api/audit/${id}`);
      },
      {
        onSuccess: () => {
          setSelectedIds(prev => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          mutate();
        },
        onError: (err: any) => console.error('Failed to delete audit record:', err),
      },
    );
  };

  const bulkDeleteAudit = () => {
    setDeleting(true);
    reauth.execute(
      'BULK_DELETE_AUDIT_RECORDS',
      async (password?: string) => {
        const body = { ids: Array.from(selectedIds) };
        if (password) await api.postWithReauth('/api/audit/bulk-delete', body, password);
        else await apiClient.post('/api/audit/bulk-delete', body);
      },
      {
        onSuccess: () => {
          setSelectedIds(new Set());
          setShowDeleteConfirm(false);
          mutate();
          setDeleting(false);
        },
        onError: (err: any) => {
          console.error('Failed to bulk delete audit records:', err);
          setDeleting(false);
        },
      },
    );
  };

  const clearFilters = () => {
    setSearch('');
    setFromDateTime('');
    setToDateTime('');
    setPage(1);
  };

  const hasFilters = search || fromDateTime || toDateTime;
  const [downloading, setDownloading] = useState(false);

  // Format datetime for display using global config
  const formatDateTimeDisplay = (datetime: string) => {
    if (!datetime) return '';
    return formatDateTime(datetime);
  };

  const handleDownloadPDF = async () => {
    const records = data?.data;
    if (!records || records.length === 0) return;
    setDownloading(true);

    try {
      const period = fromDateTime || toDateTime
        ? `${fromDateTime ? formatDateTime(fromDateTime) : 'Start'} to ${toDateTime ? formatDateTime(toDateTime) : 'Now'}`
        : 'All Time';

      const report = await createReport({
        title: 'Audit Trail Report',
        subtitle: `Period: ${period}${search ? `  |  Search: "${search}"` : ''}  |  Total: ${records.length} record(s)  |  21 CFR Part 11 Compliant`,
        orientation: 'landscape',
        formatDateTime,
      });

      const tableRows = records.map((r: any) => [
        formatDateTime(r.timestamp),
        r.action?.replace(/_/g, ' ') ?? '-',
        r.userId ?? '-',
        r.userRole ?? '-',
        r.targetType ?? '-',
        getAuditSummary(r, templates).substring(0, 80),
        r.ipAddress ?? '-',
      ]);

      report.addTable({
        head: ['Timestamp', 'Action', 'User', 'Role', 'Target Type', 'Description', 'IP Address'],
        body: tableRows,
        columnStyles: { 0: { cellWidth: 35 }, 5: { cellWidth: 65 } },
      });

      report.save(`audit-trail-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl text-white shadow-lg" style={{ backgroundImage: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Audit Trail</h1>
            <p className="text-sm text-slate-500">21 CFR Part 11 Compliant Activity Log</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          {data && (
            <div className="text-right">
              <p className="text-2xl font-bold text-slate-800">{data.total.toLocaleString()}</p>
              <p className="text-xs text-slate-500">Total Records</p>
            </div>
          )}
          {canExport && (
            <button onClick={handleDownloadPDF} disabled={downloading || !data?.data?.length}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-700 hover:bg-slate-50 hover:border-slate-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {downloading ? (
                <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              Download PDF
            </button>
          )}
        </div>
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
      <ReportPageWrapper
        title="Audit Trail"
        totalRecords={data?.total ?? 0}
        page={page}
        totalPages={data?.totalPages ?? 1}
      >
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
      </ReportPageWrapper>

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

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={() => { reauth.cancel(); setDeleting(false); }}
        actionLabel="Delete Audit Record"
      />
    </div>
  );
}
