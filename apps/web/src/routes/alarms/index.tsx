import { useState, useEffect, useMemo } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { usePaginationConfig } from '@/hooks/use-pagination-config';
import { ALL_ALARM_COLUMN_IDS } from '@digilog/shared';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AlarmSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'WARNING' | 'INFO';
type AlarmStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'CLEARED' | 'MANUALLY_CLEARED';

interface Alarm {
  id: string;
  severity: AlarmSeverity;
  alarmType: string;
  entityId: string;
  entityName?: string;
  status: AlarmStatus;
  message?: string;
  createdAt: string;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  clearedBy?: string;
  clearedAt?: string;
  triggerDetails?: {
    _sourceField?: string;
    _condition?: string;
    _threshold?: number;
    _ruleType?: string;
    [key: string]: unknown;
  };
  clearDetails?: {
    [key: string]: unknown;
  };
}

interface PaginatedResponse {
  data: Alarm[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface AlarmSummary {
  active: number;
  acknowledged: number;
  cleared: number;
  critical: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEVERITY_COLORS: Record<AlarmSeverity, string> = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  MAJOR: 'bg-orange-100 text-orange-700 border-orange-200',
  MINOR: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  WARNING: 'bg-blue-100 text-blue-700 border-blue-200',
  INFO: 'bg-slate-100 text-slate-600 border-slate-200',
};

const SEVERITY_DOT: Record<AlarmSeverity, string> = {
  CRITICAL: 'bg-red-500',
  MAJOR: 'bg-orange-500',
  MINOR: 'bg-yellow-500',
  WARNING: 'bg-blue-500',
  INFO: 'bg-slate-400',
};

const STATUS_COLORS: Record<AlarmStatus, string> = {
  ACTIVE: 'bg-red-100 text-red-700 border-red-200',
  ACKNOWLEDGED: 'bg-amber-100 text-amber-700 border-amber-200',
  CLEARED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  MANUALLY_CLEARED: 'bg-blue-100 text-blue-700 border-blue-200',
};

const STATUS_LABELS: Record<AlarmStatus, string> = {
  ACTIVE: 'Active',
  ACKNOWLEDGED: 'Acknowledged',
  CLEARED: 'Cleared',
  MANUALLY_CLEARED: 'Manually Cleared',
};

/** Get the high limit threshold (for > or >= conditions) */
function getHighLimit(alarm: Alarm): string | null {
  const d = alarm.triggerDetails;
  if (!d || d._threshold === undefined) return null;
  if (d._condition === '>' || d._condition === '>=') return String(d._threshold);
  return null;
}

/** Get the low limit threshold (for < or <= conditions) */
function getLowLimit(alarm: Alarm): string | null {
  const d = alarm.triggerDetails;
  if (!d || d._threshold === undefined) return null;
  if (d._condition === '<' || d._condition === '<=') return String(d._threshold);
  return null;
}

/** Extract numeric value from details using sourceField or fallback to first numeric key */
function extractValue(details: Record<string, unknown> | undefined, sourceField?: string): string | null {
  if (!details) return null;
  if (sourceField) {
    const val = details[sourceField];
    if (val !== undefined && val !== null) {
      return typeof val === 'number' ? val.toFixed(2) : String(val);
    }
  }
  for (const [key, val] of Object.entries(details)) {
    if (key.startsWith('_')) continue;
    if (typeof val === 'number') return val.toFixed(2);
  }
  return null;
}

/** Get the actual triggering value from trigger details */
function getGeneratedValue(alarm: Alarm): string | null {
  return extractValue(alarm.triggerDetails, alarm.triggerDetails?._sourceField);
}

/** Get the value at the time the alarm was cleared */
function getClearedValue(alarm: Alarm): string | null {
  return extractValue(alarm.clearDetails, alarm.triggerDetails?._sourceField);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AlarmDashboardPage() {
  const { toast } = useToast();
  const { formatDateTime } = useDatetimeFormat();
  const paginationOptions = usePaginationConfig();
  const reauth = useReauth();

  // Filters
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(paginationOptions[0]);
  const [statusFilter, setStatusFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [entityIdFilter, setEntityIdFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Dialog state
  const [actionDialog, setActionDialog] = useState<{
    open: boolean;
    type: 'acknowledge' | 'clear';
    alarm: Alarm | null;
  }>({ open: false, type: 'acknowledge', alarm: null });
  const [remarks, setRemarks] = useState('');
  const [signerName, setSignerName] = useState('');
  const [meaning, setMeaning] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Build query params
  const params = new URLSearchParams({
    page: String(page),
    limit: String(perPage),
  });
  if (statusFilter) params.set('status', statusFilter);
  if (severityFilter) params.set('severity', severityFilter);
  if (entityIdFilter) params.set('entityId', entityIdFilter);
  if (fromDate) params.set('from', new Date(fromDate).toISOString());
  if (toDate) params.set('to', new Date(toDate).toISOString());

  const { data, isLoading, mutate } = useSWR<PaginatedResponse>(
    `/api/alarms?${params}`,
    { refreshInterval: 10000 },
  );

  // Summary counts
  const { data: summary } = useSWR<AlarmSummary>('/api/alarms/summary', {
    dedupingInterval: 10000,
    revalidateOnFocus: false,
  });

  // Alarm column visibility per role
  const { data: colConfig } = useSWR<{ columns: string[] }>('/api/config/alarm-columns/current', {
    dedupingInterval: 30000,
    revalidateOnFocus: false,
  });
  const visibleCols = useMemo(() => new Set(colConfig?.columns ?? ALL_ALARM_COLUMN_IDS), [colConfig]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, severityFilter, entityIdFilter, fromDate, toDate]);

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const openActionDialog = (type: 'acknowledge' | 'clear', alarm: Alarm) => {
    setActionDialog({ open: true, type, alarm });
    setRemarks('');
    setSignerName('');
    setMeaning('');
  };

  const closeActionDialog = () => {
    setActionDialog({ open: false, type: 'acknowledge', alarm: null });
    setRemarks('');
    setSignerName('');
    setMeaning('');
  };

  const handleActionSubmit = async () => {
    if (!actionDialog.alarm) return;
    if (!signerName.trim()) {
      toast.error('Validation Error', 'Signer name is required.');
      return;
    }
    if (!meaning.trim()) {
      toast.error('Validation Error', 'Meaning of signature is required.');
      return;
    }

    const reauthAction = actionDialog.type === 'acknowledge' ? 'ACKNOWLEDGE_ALARM' : 'CLEAR_ALARM';
    const alarmId = actionDialog.alarm.id;
    const alarmType = actionDialog.alarm.alarmType;
    const actionType = actionDialog.type;
    const body = {
      remarks: remarks.trim(),
      signerFullName: signerName.trim(),
      meaning: meaning.trim(),
    };

    setSubmitting(true);
    await reauth.execute(reauthAction, async (password?) => {
      const endpoint =
        actionType === 'acknowledge'
          ? `/api/alarms/${alarmId}/acknowledge`
          : `/api/alarms/${alarmId}/clear`;

      if (password) await apiClient.postWithReauth(endpoint, body, password);
      else await apiClient.post(endpoint, body);

      toast.success(
        actionType === 'acknowledge'
          ? 'Alarm Acknowledged'
          : 'Alarm Cleared',
        `Alarm ${alarmType} has been ${actionType === 'acknowledge' ? 'acknowledged' : 'cleared'} successfully.`,
      );
      closeActionDialog();
      mutate();
    }, {
      onError: (err) => {
        toast.error(
          'Action Failed',
          (err as any)?.message ?? `Failed to ${actionType} alarm.`,
        );
      },
    });
    setSubmitting(false);
  };

  const clearFilters = () => {
    setStatusFilter('');
    setSeverityFilter('');
    setEntityIdFilter('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  const hasFilters = statusFilter || severityFilter || entityIdFilter || fromDate || toDate;

  const alarms = data?.data ?? [];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-red-500 to-rose-600 text-white shadow-lg shadow-red-500/25">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Alarm Dashboard</h1>
            <p className="text-sm text-slate-500">Real-time alarm monitoring and management</p>
          </div>
        </div>
        {data && (
          <div className="text-right">
            <p className="text-2xl font-bold text-slate-800">{data.total.toLocaleString()}</p>
            <p className="text-xs text-slate-500">Total Alarms</p>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active */}
        <div className="bg-white rounded-2xl border border-red-200/60 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Active</p>
              <p className="text-3xl font-bold text-red-600 mt-1">{summary?.active ?? 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-red-100">
              <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Acknowledged */}
        <div className="bg-white rounded-2xl border border-amber-200/60 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Acknowledged</p>
              <p className="text-3xl font-bold text-amber-600 mt-1">{summary?.acknowledged ?? 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-amber-100">
              <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Cleared */}
        <div className="bg-white rounded-2xl border border-emerald-200/60 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cleared</p>
              <p className="text-3xl font-bold text-emerald-600 mt-1">{summary?.cleared ?? 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-emerald-100">
              <svg className="w-6 h-6 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </div>
        </div>

        {/* Critical */}
        <div className="bg-white rounded-2xl border border-red-300/60 shadow-sm p-5 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Critical</p>
              <p className="text-3xl font-bold text-red-700 mt-1">{summary?.critical ?? 0}</p>
            </div>
            <div className="p-3 rounded-xl bg-red-200">
              <svg className="w-6 h-6 text-red-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-rose-500">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </div>
          <span className="font-semibold text-slate-700">Filter Alarms</span>
          {hasFilters && (
            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              Filtered
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Status Filter */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Status</label>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              variant="filled"
              className="h-11"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="ACKNOWLEDGED">Acknowledged</option>
              <option value="CLEARED">Cleared</option>
              <option value="MANUALLY_CLEARED">Manually Cleared</option>
            </Select>
          </div>

          {/* Severity Filter */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Severity</label>
            <Select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              variant="filled"
              className="h-11"
            >
              <option value="">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="MAJOR">Major</option>
              <option value="MINOR">Minor</option>
              <option value="WARNING">Warning</option>
              <option value="INFO">Info</option>
            </Select>
          </div>

          {/* Entity ID Filter */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Entity ID</label>
            <Input
              type="text"
              placeholder="Filter by entity..."
              value={entityIdFilter}
              onChange={(e) => setEntityIdFilter(e.target.value)}
              className="h-11"
            />
          </div>

          {/* From Date */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">From</label>
            <Input
              type="datetime-local"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-11"
            />
          </div>

          {/* To Date */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">To</label>
            <Input
              type="datetime-local"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-11"
            />
          </div>
        </div>

        {hasFilters && (
          <div className="flex items-center justify-end mt-4 pt-4 border-t border-slate-100">
            <Button
              variant="outline"
              size="sm"
              onClick={clearFilters}
              className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear All Filters
            </Button>
          </div>
        )}
      </div>

      {/* Alarms Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-slate-100/80 border-b border-slate-200">
                {visibleCols.has('severity') && <th className="text-left px-4 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Severity</th>}
                {visibleCols.has('alarmType') && <th className="text-left px-4 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Alarm Type</th>}
                {visibleCols.has('entity') && <th className="text-left px-4 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Entity</th>}
                {visibleCols.has('highLimit') && <th className="text-center px-3 py-4 font-semibold text-red-600 uppercase tracking-wider text-xs">High Limit</th>}
                {visibleCols.has('lowLimit') && <th className="text-center px-3 py-4 font-semibold text-blue-600 uppercase tracking-wider text-xs">Low Limit</th>}
                {visibleCols.has('generatedValue') && <th className="text-center px-3 py-4 font-semibold text-orange-600 uppercase tracking-wider text-xs">Generated Value</th>}
                {visibleCols.has('clearedValue') && <th className="text-center px-3 py-4 font-semibold text-emerald-600 uppercase tracking-wider text-xs">Cleared Value</th>}
                {visibleCols.has('status') && <th className="text-left px-4 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Status</th>}
                {visibleCols.has('generatedAt') && <th className="text-left px-4 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Generated At</th>}
                {visibleCols.has('clearedAt') && <th className="text-left px-4 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Cleared At</th>}
                {visibleCols.has('actions') && <th className="text-right px-4 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr>
                  <td colSpan={visibleCols.size} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-slate-200 border-t-red-500 rounded-full animate-spin" />
                      <p className="text-sm text-slate-500">Loading alarms...</p>
                    </div>
                  </td>
                </tr>
              )}

              {!isLoading && alarms.length === 0 && (
                <tr>
                  <td colSpan={visibleCols.size} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 rounded-2xl bg-slate-100">
                        <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-slate-600 font-semibold">No alarms found</p>
                        <p className="text-sm text-slate-400 mt-1">
                          {hasFilters ? 'Try adjusting your filters' : 'All clear — no active alarms'}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}

              {!isLoading && alarms.map((alarm) => (
                <tr
                  key={alarm.id}
                  className="hover:bg-slate-50/80 transition-colors"
                >
                  {/* Severity */}
                  {visibleCols.has('severity') && (
                  <td className="px-5 py-4">
                    <Badge className={SEVERITY_COLORS[alarm.severity]}>
                      <span className={`w-2 h-2 rounded-full mr-1.5 ${SEVERITY_DOT[alarm.severity]}`} />
                      {alarm.severity}
                    </Badge>
                  </td>
                  )}

                  {/* Alarm Type */}
                  {visibleCols.has('alarmType') && (
                  <td className="px-5 py-4">
                    <span className="font-medium text-slate-700">{alarm.alarmType}</span>
                    {alarm.message && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[200px]">{alarm.message}</p>
                    )}
                  </td>
                  )}

                  {/* Entity */}
                  {visibleCols.has('entity') && (
                  <td className="px-4 py-4">
                    <span className="text-slate-700 font-mono text-xs bg-slate-100 px-2 py-1 rounded-lg">
                      {alarm.entityName ?? alarm.entityId}
                    </span>
                  </td>
                  )}

                  {/* High Limit */}
                  {visibleCols.has('highLimit') && (
                  <td className="px-3 py-4 text-center">
                    {getHighLimit(alarm) ? (
                      <span className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-md">
                        {getHighLimit(alarm)}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  )}

                  {/* Low Limit */}
                  {visibleCols.has('lowLimit') && (
                  <td className="px-3 py-4 text-center">
                    {getLowLimit(alarm) ? (
                      <span className="text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                        {getLowLimit(alarm)}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  )}

                  {/* Generated Value */}
                  {visibleCols.has('generatedValue') && (
                  <td className="px-3 py-4 text-center">
                    {getGeneratedValue(alarm) ? (
                      <span className="text-xs font-bold text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-md">
                        {getGeneratedValue(alarm)}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  )}

                  {/* Cleared Value */}
                  {visibleCols.has('clearedValue') && (
                  <td className="px-3 py-4 text-center">
                    {getClearedValue(alarm) ? (
                      <span className="text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                        {getClearedValue(alarm)}
                      </span>
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  )}

                  {/* Status */}
                  {visibleCols.has('status') && (
                  <td className="px-4 py-4">
                    <Badge className={STATUS_COLORS[alarm.status]}>
                      {STATUS_LABELS[alarm.status] ?? alarm.status}
                    </Badge>
                  </td>
                  )}

                  {/* Generated At */}
                  {visibleCols.has('generatedAt') && (
                  <td className="px-4 py-4 text-slate-600 text-xs whitespace-nowrap">
                    {formatDateTime(alarm.createdAt)}
                  </td>
                  )}

                  {/* Cleared At */}
                  {visibleCols.has('clearedAt') && (
                  <td className="px-4 py-4 text-slate-600 text-xs whitespace-nowrap">
                    {alarm.clearedAt ? (
                      formatDateTime(alarm.clearedAt)
                    ) : (
                      <span className="text-slate-300">-</span>
                    )}
                  </td>
                  )}

                  {/* Actions */}
                  {visibleCols.has('actions') && (
                  <td className="px-5 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {alarm.status === 'ACTIVE' && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openActionDialog('acknowledge', alarm)}
                          className="gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                          </svg>
                          Acknowledge
                        </Button>
                      )}
                      {(alarm.status === 'ACTIVE' || alarm.status === 'ACKNOWLEDGED') && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => openActionDialog('clear', alarm)}
                          className="gap-1.5 text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Clear
                        </Button>
                      )}
                      {(alarm.status === 'CLEARED' || alarm.status === 'MANUALLY_CLEARED') && (
                        <span className="text-xs text-slate-400 italic">No actions</span>
                      )}
                    </div>
                  </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && data.total > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm text-slate-600">
              <span className="text-slate-500">Rows per page:</span>
              <div className="flex items-center gap-1">
                {paginationOptions.map((opt) => (
                  <button
                    key={opt}
                    onClick={() => { setPerPage(opt); setPage(1); }}
                    className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
                      perPage === opt
                        ? 'bg-red-500 text-white shadow-sm'
                        : 'text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <span className="text-slate-300">|</span>
              <span>
                Page <span className="font-semibold text-slate-800">{data.page}</span> of <span className="font-semibold text-slate-800">{data.totalPages}</span>
                <span className="text-slate-400 ml-2">({data.total} total alarms)</span>
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="gap-1.5"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="gap-1.5"
              >
                Next
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Acknowledge / Clear Dialog */}
      <Dialog
        open={actionDialog.open}
        onClose={closeActionDialog}
        className="max-w-md"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div
              className={`p-2 rounded-xl ${
                actionDialog.type === 'acknowledge'
                  ? 'bg-amber-100 text-amber-600'
                  : 'bg-emerald-100 text-emerald-600'
              }`}
            >
              {actionDialog.type === 'acknowledge' ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            {actionDialog.type === 'acknowledge' ? 'Acknowledge Alarm' : 'Clear Alarm'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Alarm Info Summary */}
          {actionDialog.alarm && (
            <div className="bg-slate-50 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500 uppercase">Alarm</span>
                <Badge className={SEVERITY_COLORS[actionDialog.alarm.severity]}>
                  {actionDialog.alarm.severity}
                </Badge>
              </div>
              <p className="text-sm font-medium text-slate-700">{actionDialog.alarm.alarmType}</p>
              <p className="text-xs text-slate-500">
                Entity: {actionDialog.alarm.entityName ?? actionDialog.alarm.entityId}
              </p>
            </div>
          )}

          {/* Signer Name (required) */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
              Signer Name <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="Enter your full name"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
            />
          </div>

          {/* Meaning of Signature (required) */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
              Meaning of Signature <span className="text-red-500">*</span>
            </label>
            <Input
              type="text"
              placeholder="e.g., Reviewed and acknowledged"
              value={meaning}
              onChange={(e) => setMeaning(e.target.value)}
            />
          </div>

          {/* Remarks (optional) */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">
              Remarks
            </label>
            <textarea
              className="flex w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3b82f6] focus:ring-2 focus:ring-[#3b82f6]/20 hover:border-slate-300 transition-all duration-200 min-h-[80px] resize-y"
              placeholder="Optional remarks..."
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={closeActionDialog}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleActionSubmit}
            disabled={submitting || !signerName.trim() || !meaning.trim()}
            className={
              actionDialog.type === 'acknowledge'
                ? 'bg-amber-600 hover:bg-amber-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-700 text-white'
            }
          >
            {submitting ? (
              <>
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Processing...
              </>
            ) : actionDialog.type === 'acknowledge' ? (
              'Acknowledge'
            ) : (
              'Clear Alarm'
            )}
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
        actionLabel="Alarm Action"
      />
    </div>
  );
}
