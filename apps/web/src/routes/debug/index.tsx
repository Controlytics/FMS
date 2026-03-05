import { useState, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StageResult {
  stage: number;
  name: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  warnings?: string[];
  details?: Record<string, unknown>;
}

interface PipelineTrace {
  id: string;
  time: string;
  messageId: string;
  entityId?: string;
  entityName?: string;
  transport: string;
  messageType: string;
  payloadSize?: number;
  stages: StageResult[];
  finalStatus: 'SUCCESS' | 'SUCCESS_WITH_WARNINGS' | 'FAILED' | 'DLQ';
  failedStage?: string;
  errorCode?: string;
  errorMessage?: string;
  warnings?: string[];
  totalDurationMs: number;
}

interface PaginatedTracesResponse {
  data: PipelineTrace[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface TraceStats {
  successRate1h: number;
  successRate24h: number;
  avgDurationMs: number;
  topErrors: Array<{ code: string; count: number }>;
  byTransport: Record<string, { total: number; failed: number }>;
}

// ---------------------------------------------------------------------------
// Stage name map (fallback for missing names in data)
// ---------------------------------------------------------------------------

const STAGE_NAMES: Record<number, string> = {
  1: 'Auth & Rate Limit',
  2: 'Schema Validation',
  3: 'Entity Resolution',
  4: 'Payload Normalisation',
  5: 'Attribute Merge',
  6: 'Rule Chain Eval',
  7: 'UNS Path Build',
  8: 'Alarm Check',
  9: 'Telemetry Batch',
  10: 'DLQ Fallback',
  11: 'Audit Emit',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function getStatusBadgeClass(status: PipelineTrace['finalStatus']): string {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'SUCCESS_WITH_WARNINGS':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'FAILED':
      return 'bg-red-100 text-red-700 border-red-200';
    case 'DLQ':
      return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function getTransportBadgeClass(transport: string): string {
  switch (transport.toUpperCase()) {
    case 'MQTT':
      return 'bg-violet-100 text-violet-700 border-violet-200';
    case 'HTTP':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'WEBSOCKET':
    case 'WS':
      return 'bg-cyan-100 text-cyan-700 border-cyan-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function getMessageTypeBadgeClass(type: string): string {
  switch (type.toUpperCase()) {
    case 'TELEMETRY':
      return 'bg-indigo-100 text-indigo-700 border-indigo-200';
    case 'ATTRIBUTES':
      return 'bg-teal-100 text-teal-700 border-teal-200';
    case 'RPC':
      return 'bg-pink-100 text-pink-700 border-pink-200';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200';
  }
}

function getStageBgClass(status: StageResult['status']): string {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-500';
    case 'FAILED':
      return 'bg-red-500';
    case 'SKIPPED':
      return 'bg-slate-300';
    default:
      return 'bg-slate-200';
  }
}

function getStageTimelineClass(status: StageResult['status']): string {
  switch (status) {
    case 'SUCCESS':
      return 'border-emerald-300 bg-emerald-50';
    case 'FAILED':
      return 'border-red-300 bg-red-50';
    case 'SKIPPED':
      return 'border-slate-200 bg-slate-50';
    default:
      return 'border-slate-200 bg-white';
  }
}

function getStageDotClass(status: StageResult['status']): string {
  switch (status) {
    case 'SUCCESS':
      return 'bg-emerald-500 border-emerald-300';
    case 'FAILED':
      return 'bg-red-500 border-red-300';
    case 'SKIPPED':
      return 'bg-slate-300 border-slate-200';
    default:
      return 'bg-slate-200 border-slate-200';
  }
}

// ---------------------------------------------------------------------------
// Pipeline Progress Bar (11 blocks, one per stage)
// ---------------------------------------------------------------------------

function PipelineProgressBar({ stages }: { stages: StageResult[] }) {
  // Build a map of stage number -> status
  const stageMap = new Map<number, StageResult['status']>();
  for (const s of stages) {
    stageMap.set(s.stage, s.status);
  }

  const completedCount = stages.filter((s) => s.status === 'SUCCESS').length;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center gap-0.5">
        {Array.from({ length: 11 }, (_, i) => {
          const stageNum = i + 1;
          const status = stageMap.get(stageNum);
          let blockClass = 'bg-slate-200'; // not reached
          if (status === 'SUCCESS') blockClass = 'bg-emerald-500';
          else if (status === 'FAILED') blockClass = 'bg-red-500';
          else if (status === 'SKIPPED') blockClass = 'bg-slate-300';

          return (
            <div
              key={stageNum}
              title={`Stage ${stageNum}: ${STAGE_NAMES[stageNum] ?? `Stage ${stageNum}`} — ${status ?? 'Not reached'}`}
              className={`w-3 h-3 rounded-sm transition-colors ${blockClass}`}
            />
          );
        })}
      </div>
      <span className="text-xs text-slate-500 font-medium whitespace-nowrap">
        {completedCount}/11
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status icon (inline SVG, no lucide-react)
// ---------------------------------------------------------------------------

function StatusIcon({ status }: { status: PipelineTrace['finalStatus'] }) {
  if (status === 'SUCCESS') {
    return (
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
        <svg className="w-3.5 h-3.5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }
  if (status === 'SUCCESS_WITH_WARNINGS') {
    return (
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center">
        <svg className="w-3.5 h-3.5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
    );
  }
  if (status === 'FAILED') {
    return (
      <div className="flex-shrink-0 w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
        <svg className="w-3 h-3 text-red-600" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10" />
        </svg>
      </div>
    );
  }
  // DLQ
  return (
    <div className="flex-shrink-0 w-5 h-5 rounded-full bg-yellow-100 flex items-center justify-center">
      <svg className="w-3 h-3 text-yellow-600" fill="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage Timeline (detail view)
// ---------------------------------------------------------------------------

function StageTimeline({ stages }: { stages: StageResult[] }) {
  // Ensure 11 slots, filling in not-reached stages
  const allStages = Array.from({ length: 11 }, (_, i) => {
    const stageNum = i + 1;
    const found = stages.find((s) => s.stage === stageNum);
    return (
      found ?? {
        stage: stageNum,
        name: STAGE_NAMES[stageNum] ?? `Stage ${stageNum}`,
        status: 'SKIPPED' as const,
        durationMs: 0,
      }
    );
  });

  return (
    <div className="space-y-2">
      {allStages.map((stage, index) => {
        const isLast = index === allStages.length - 1;
        return (
          <div key={stage.stage} className="relative flex items-start gap-3">
            {/* Connector line */}
            {!isLast && (
              <div className="absolute left-[10px] top-6 bottom-0 w-0.5 bg-slate-200" style={{ height: 'calc(100% + 8px)' }} />
            )}

            {/* Stage dot */}
            <div
              className={`relative flex-shrink-0 w-5 h-5 rounded-full border-2 mt-0.5 ${getStageDotClass(stage.status)}`}
            >
              {stage.status === 'SUCCESS' && (
                <svg className="w-2.5 h-2.5 text-white absolute inset-0 m-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {stage.status === 'FAILED' && (
                <svg className="w-2.5 h-2.5 text-white absolute inset-0 m-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>

            {/* Stage content */}
            <div className={`flex-1 min-w-0 rounded-xl border px-3.5 py-2.5 mb-1 ${getStageTimelineClass(stage.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-slate-400 tabular-nums w-5 text-right flex-shrink-0">
                    {stage.stage}
                  </span>
                  <span className={`text-sm font-semibold truncate ${
                    stage.status === 'FAILED' ? 'text-red-700' :
                    stage.status === 'SUCCESS' ? 'text-emerald-700' :
                    'text-slate-500'
                  }`}>
                    {stage.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {stage.status !== 'SKIPPED' && (
                    <span className="text-xs text-slate-500 font-mono">{formatDuration(stage.durationMs)}</span>
                  )}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${getStageBgClass(stage.status)} ${
                    stage.status === 'SKIPPED' ? 'text-slate-500' : 'text-white'
                  }`}>
                    {stage.status}
                  </span>
                </div>
              </div>

              {/* Error info */}
              {stage.status === 'FAILED' && (stage.errorCode || stage.errorMessage) && (
                <div className="mt-2 rounded-lg bg-red-100/70 border border-red-200 px-3 py-2 space-y-1">
                  {stage.errorCode && (
                    <p className="text-xs font-mono font-bold text-red-700">{stage.errorCode}</p>
                  )}
                  {stage.errorMessage && (
                    <p className="text-xs text-red-600">{stage.errorMessage}</p>
                  )}
                </div>
              )}

              {/* Warnings */}
              {stage.warnings && stage.warnings.length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {stage.warnings.map((w, wi) => (
                    <p key={wi} className="text-xs text-amber-600 flex items-start gap-1">
                      <svg className="w-3 h-3 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                      </svg>
                      {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Details (collapsible if present) */}
              {stage.details && Object.keys(stage.details).length > 0 && (
                <details className="mt-2">
                  <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">
                    Details
                  </summary>
                  <pre className="mt-1.5 text-xs text-slate-600 bg-white/70 rounded-lg border border-slate-200 p-2 overflow-x-auto max-h-32">
                    {JSON.stringify(stage.details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Expanded trace row detail panel
// ---------------------------------------------------------------------------

function TraceDetailPanel({ trace }: { trace: PipelineTrace }) {
  return (
    <div className="px-5 pb-5 pt-2 bg-slate-50/60 border-t border-slate-100">
      {/* Meta grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Message ID</p>
          <p className="text-xs font-mono text-slate-600 truncate">{trace.messageId}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Payload Size</p>
          <p className="text-sm font-semibold text-slate-700">
            {trace.payloadSize != null ? `${trace.payloadSize.toLocaleString()} B` : '—'}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Total Duration</p>
          <p className="text-sm font-semibold text-slate-700">{formatDuration(trace.totalDurationMs)}</p>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-0.5">Stages Run</p>
          <p className="text-sm font-semibold text-slate-700">{trace.stages.length} / 11</p>
        </div>
      </div>

      {/* Error summary if present */}
      {trace.finalStatus === 'FAILED' && (trace.errorCode || trace.errorMessage) && (
        <div className="mb-5 flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3">
          <div className="p-1.5 rounded-lg bg-red-100 flex-shrink-0">
            <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <div className="min-w-0">
            {trace.errorCode && (
              <p className="text-xs font-mono font-bold text-red-700 mb-0.5">{trace.errorCode}</p>
            )}
            {trace.errorMessage && (
              <p className="text-sm text-red-600">{trace.errorMessage}</p>
            )}
            {trace.failedStage && (
              <p className="text-xs text-red-400 mt-1">Failed at: {trace.failedStage}</p>
            )}
          </div>
        </div>
      )}

      {/* Warnings summary */}
      {trace.warnings && trace.warnings.length > 0 && (
        <div className="mb-5 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
          <p className="text-xs font-semibold text-amber-700 mb-2 uppercase tracking-wider">Warnings ({trace.warnings.length})</p>
          <ul className="space-y-1">
            {trace.warnings.map((w, i) => (
              <li key={i} className="text-xs text-amber-600 flex items-start gap-1.5">
                <svg className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Stage Timeline */}
      <div>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Pipeline Stages</p>
        <StageTimeline stages={trace.stages} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stats Cards
// ---------------------------------------------------------------------------

function StatsCards({ stats, total }: { stats: TraceStats | undefined; total: number }) {
  const statItems = [
    {
      label: 'Success Rate (1h)',
      value: stats ? `${stats.successRate1h.toFixed(1)}%` : '—',
      gradient: 'from-emerald-500 to-teal-600',
      iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',
      icon: (
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      valueClass: stats && stats.successRate1h < 90 ? 'text-red-600' : 'text-emerald-600',
    },
    {
      label: 'Success Rate (24h)',
      value: stats ? `${stats.successRate24h.toFixed(1)}%` : '—',
      gradient: 'from-blue-500 to-indigo-600',
      iconBg: 'bg-gradient-to-br from-blue-500 to-indigo-600',
      icon: (
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      ),
      valueClass: stats && stats.successRate24h < 90 ? 'text-red-600' : 'text-blue-600',
    },
    {
      label: 'Avg Duration',
      value: stats ? formatDuration(Math.round(stats.avgDurationMs)) : '—',
      gradient: 'from-violet-500 to-purple-600',
      iconBg: 'bg-gradient-to-br from-violet-500 to-purple-600',
      icon: (
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      valueClass: 'text-violet-600',
    },
    {
      label: 'Total Traces',
      value: total.toLocaleString(),
      gradient: 'from-cyan-500 to-blue-600',
      iconBg: 'bg-gradient-to-br from-cyan-500 to-blue-600',
      icon: (
        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      ),
      valueClass: 'text-cyan-700',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {statItems.map((item) => (
        <div
          key={item.label}
          className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 p-5 hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider leading-tight">{item.label}</p>
            <div className={`p-2 rounded-xl ${item.iconBg} shadow-lg`}>{item.icon}</div>
          </div>
          <p className={`text-2xl font-bold ${item.valueClass}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

export function DebugTracesPage() {
  const { toast } = useToast();
  const { formatDateTime } = useDatetimeFormat();

  // Filters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState('');
  const [transportFilter, setTransportFilter] = useState('');
  const [errorCodeFilter, setErrorCodeFilter] = useState('');
  const [entitySearch, setEntitySearch] = useState('');
  const [debouncedEntitySearch, setDebouncedEntitySearch] = useState('');
  const [debouncedErrorCode, setDebouncedErrorCode] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Expanded row state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailCache, setDetailCache] = useState<Record<string, PipelineTrace>>({});

  // Debounce refs
  const entityDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const errorCodeDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce entity search
  useEffect(() => {
    entityDebounceRef.current = setTimeout(() => {
      setDebouncedEntitySearch(entitySearch);
      setPage(1);
    }, 300);
    return () => clearTimeout(entityDebounceRef.current);
  }, [entitySearch]);

  // Debounce error code
  useEffect(() => {
    errorCodeDebounceRef.current = setTimeout(() => {
      setDebouncedErrorCode(errorCodeFilter);
      setPage(1);
    }, 300);
    return () => clearTimeout(errorCodeDebounceRef.current);
  }, [errorCodeFilter]);

  // Reset page when non-debounced filters change
  useEffect(() => {
    setPage(1);
  }, [statusFilter, transportFilter, fromDate, toDate, pageSize]);

  // Build query params
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });
  if (statusFilter) params.set('status', statusFilter);
  if (transportFilter) params.set('transport', transportFilter);
  if (debouncedErrorCode) params.set('errorCode', debouncedErrorCode);
  if (debouncedEntitySearch) params.set('entityId', debouncedEntitySearch);
  if (fromDate) params.set('from', new Date(fromDate).toISOString());
  if (toDate) params.set('to', new Date(toDate).toISOString());

  const { data, isLoading, mutate } = useSWR<PaginatedTracesResponse>(
    `/api/debug/traces?${params}`,
    { refreshInterval: 10000, revalidateOnFocus: false },
  );

  const { data: stats } = useSWR<TraceStats>('/api/debug/traces/stats', {
    refreshInterval: 30000,
    dedupingInterval: 15000,
    revalidateOnFocus: false,
  });

  const traces = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const hasFilters = !!(
    statusFilter || transportFilter || debouncedErrorCode ||
    debouncedEntitySearch || fromDate || toDate
  );

  // ---------------------------------------------------------------------------
  // Expand/collapse row and fetch detail
  // ---------------------------------------------------------------------------

  const handleRowClick = async (trace: PipelineTrace) => {
    if (expandedId === trace.id) {
      setExpandedId(null);
      return;
    }

    // If already cached, expand immediately
    if (detailCache[trace.id]) {
      setExpandedId(trace.id);
      return;
    }

    // Fetch full detail
    setExpandedId(trace.id);
    setLoadingDetail(true);
    try {
      const detail = await apiClient.get<PipelineTrace>(`/api/debug/traces/${trace.id}`);
      setDetailCache((prev) => ({ ...prev, [trace.id]: detail }));
    } catch {
      // Fall back to the list data if detail fetch fails
      setDetailCache((prev) => ({ ...prev, [trace.id]: trace }));
    } finally {
      setLoadingDetail(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Clear filters
  // ---------------------------------------------------------------------------

  const clearFilters = () => {
    setStatusFilter('');
    setTransportFilter('');
    setErrorCodeFilter('');
    setEntitySearch('');
    setFromDate('');
    setToDate('');
    setPage(1);
  };

  // ---------------------------------------------------------------------------
  // Toggle per-entity tracing
  // ---------------------------------------------------------------------------

  const handleToggleEntityTracing = async (entityId: string) => {
    try {
      await apiClient.put(`/api/debug/traces/entity/${entityId}/toggle`, {});
      toast.success('Tracing Toggled', `Tracing updated for entity ${entityId}.`);
      mutate();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle entity tracing.';
      toast.error('Toggle Failed', msg);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
              Pipeline Debug Traces
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Inspect ingestion pipeline execution across all 11 stages
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => { mutate(); }}
          className="gap-2 text-cyan-700 border-cyan-200 hover:bg-cyan-50 hover:border-cyan-300"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </Button>
      </div>

      {/* Stats Cards */}
      <StatsCards stats={stats} total={total} />

      {/* Filters Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 p-6">
        <div className="flex items-center gap-2 mb-4">
          <div className="p-2 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </div>
          <span className="font-semibold text-slate-700">Filter Traces</span>
          {hasFilters && (
            <span className="ml-2 px-2 py-0.5 text-xs font-medium bg-cyan-100 text-cyan-700 rounded-full">
              Filtered
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {/* Status */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Status</label>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              variant="filled"
              className="h-11"
            >
              <option value="">All Statuses</option>
              <option value="SUCCESS">Success</option>
              <option value="SUCCESS_WITH_WARNINGS">With Warnings</option>
              <option value="FAILED">Failed</option>
              <option value="DLQ">DLQ</option>
            </Select>
          </div>

          {/* Transport */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Transport</label>
            <Select
              value={transportFilter}
              onChange={(e) => setTransportFilter(e.target.value)}
              variant="filled"
              className="h-11"
            >
              <option value="">All Transports</option>
              <option value="MQTT">MQTT</option>
              <option value="HTTP">HTTP</option>
              <option value="WEBSOCKET">WebSocket</option>
            </Select>
          </div>

          {/* Error Code */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Error Code</label>
            <Input
              type="text"
              placeholder="e.g. ENTITY_NOT_FOUND"
              value={errorCodeFilter}
              onChange={(e) => setErrorCodeFilter(e.target.value)}
              className="h-11 font-mono text-xs"
            />
          </div>

          {/* Entity Search */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">Entity</label>
            <Input
              type="text"
              placeholder="Entity ID or name..."
              value={entitySearch}
              onChange={(e) => setEntitySearch(e.target.value)}
              className="h-11"
            />
          </div>

          {/* From */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 block">From</label>
            <Input
              type="datetime-local"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-11"
            />
          </div>

          {/* To */}
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
              className="gap-2 text-slate-600 border-slate-200 hover:bg-slate-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear All Filters
            </Button>
          </div>
        )}
      </div>

      {/* Traces Table Card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-slate-100/80 border-b border-slate-200">
                <th className="text-left px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs w-8" />
                <th className="text-left px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Time</th>
                <th className="text-left px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Entity</th>
                <th className="text-left px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Type</th>
                <th className="text-left px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Transport</th>
                <th className="text-left px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Pipeline</th>
                <th className="text-left px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Status</th>
                <th className="text-left px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Error Code</th>
                <th className="text-right px-5 py-4 font-semibold text-slate-600 uppercase tracking-wider text-xs">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* Loading state */}
              {isLoading && (
                <tr>
                  <td colSpan={9} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <svg className="w-8 h-8 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <p className="text-sm text-slate-500">Loading traces...</p>
                    </div>
                  </td>
                </tr>
              )}

              {/* Empty state */}
              {!isLoading && traces.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-5 py-16 text-center">
                    <div className="flex flex-col items-center gap-4">
                      <div className="p-4 rounded-2xl bg-slate-100">
                        <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-slate-600 font-semibold">No traces found</p>
                        <p className="text-sm text-slate-400 mt-1">
                          {hasFilters
                            ? 'Try adjusting your filters to find traces.'
                            : 'No pipeline traces have been recorded yet.'}
                        </p>
                      </div>
                    </div>
                  </td>
                </tr>
              )}

              {/* Trace rows */}
              {!isLoading &&
                traces.map((trace) => {
                  const isExpanded = expandedId === trace.id;
                  const cachedDetail = detailCache[trace.id];

                  return [
                    <tr
                      key={`row-${trace.id}`}
                      onClick={() => handleRowClick(trace)}
                      className={`cursor-pointer transition-colors ${
                        isExpanded
                          ? 'bg-cyan-50/60 hover:bg-cyan-50'
                          : 'hover:bg-slate-50/80'
                      }`}
                    >
                      {/* Expand chevron */}
                      <td className="px-5 py-3.5">
                        <svg
                          className={`w-4 h-4 text-slate-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </td>

                      {/* Time */}
                      <td className="px-5 py-3.5">
                        <span className="text-xs text-slate-600 font-mono whitespace-nowrap">
                          {formatDateTime(trace.time)}
                        </span>
                      </td>

                      {/* Entity */}
                      <td className="px-5 py-3.5 max-w-[160px]">
                        {trace.entityName ? (
                          <div>
                            <p className="text-sm font-medium text-slate-700 truncate">{trace.entityName}</p>
                            {trace.entityId && (
                              <p className="text-xs text-slate-400 font-mono truncate">{trace.entityId.slice(0, 12)}…</p>
                            )}
                          </div>
                        ) : trace.entityId ? (
                          <span className="text-xs font-mono text-slate-500">{trace.entityId.slice(0, 16)}…</span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>

                      {/* Message Type */}
                      <td className="px-5 py-3.5">
                        <Badge className={getMessageTypeBadgeClass(trace.messageType)}>
                          {trace.messageType}
                        </Badge>
                      </td>

                      {/* Transport */}
                      <td className="px-5 py-3.5">
                        <Badge className={getTransportBadgeClass(trace.transport)}>
                          {trace.transport}
                        </Badge>
                      </td>

                      {/* Pipeline Progress */}
                      <td className="px-5 py-3.5">
                        <PipelineProgressBar stages={trace.stages} />
                      </td>

                      {/* Final Status */}
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <StatusIcon status={trace.finalStatus} />
                          <Badge className={getStatusBadgeClass(trace.finalStatus)}>
                            {trace.finalStatus === 'SUCCESS_WITH_WARNINGS' ? 'WARNINGS' : trace.finalStatus}
                          </Badge>
                        </div>
                      </td>

                      {/* Error Code */}
                      <td className="px-5 py-3.5">
                        {trace.errorCode ? (
                          <span className="text-xs font-mono text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-lg">
                            {trace.errorCode}
                          </span>
                        ) : (
                          <span className="text-slate-300 text-xs">—</span>
                        )}
                      </td>

                      {/* Duration */}
                      <td className="px-5 py-3.5 text-right">
                        <span className="text-xs font-mono font-semibold text-slate-600">
                          {formatDuration(trace.totalDurationMs)}
                        </span>
                      </td>
                    </tr>,

                    /* Expanded detail row */
                    isExpanded && (
                      <tr key={`detail-${trace.id}`} className="bg-slate-50/60">
                        <td colSpan={9} className="p-0">
                          {loadingDetail && !cachedDetail ? (
                            <div className="flex items-center gap-3 px-5 py-6">
                              <svg className="w-5 h-5 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              <span className="text-sm text-slate-500">Loading trace details…</span>
                            </div>
                          ) : (
                            <TraceDetailPanel trace={cachedDetail ?? trace} />
                          )}
                        </td>
                      </tr>
                    ),
                  ];
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {data && totalPages > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-sm p-4">
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Rows per page + page info */}
            <div className="flex items-center gap-3 text-sm text-slate-600 flex-wrap">
              <span className="text-slate-500">Rows per page:</span>
              <div className="flex items-center gap-1">
                {[10, 20, 50, 100].map((opt) => (
                  <button
                    key={opt}
                    onClick={() => { setPageSize(opt); setPage(1); }}
                    className={`px-2.5 py-1 rounded-md text-sm font-medium transition-all ${
                      pageSize === opt
                        ? 'bg-cyan-500 text-white shadow-sm'
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
                <span className="font-semibold text-slate-800">{totalPages}</span>
                <span className="text-slate-400 ml-2">({total.toLocaleString()} total traces)</span>
              </span>
            </div>

            {/* Prev / Next */}
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
                disabled={page >= totalPages}
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

      {/* Top Errors Panel (shown when stats available) */}
      {stats && stats.topErrors.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-rose-600">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <span className="font-semibold text-slate-700">Top Error Codes</span>
          </div>
          <div className="space-y-2">
            {stats.topErrors.map((err, i) => {
              const maxCount = stats.topErrors[0]?.count ?? 1;
              const pct = Math.round((err.count / maxCount) * 100);
              return (
                <div key={err.code} className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-slate-400 w-4 text-right">{i + 1}</span>
                  <span className="text-xs font-mono font-semibold text-red-700 w-48 truncate flex-shrink-0">
                    {err.code}
                  </span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded-full transition-all duration-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-slate-600 w-12 text-right">
                    {err.count.toLocaleString()}
                  </span>
                  <button
                    onClick={() => {
                      setErrorCodeFilter(err.code);
                      setPage(1);
                    }}
                    className="text-xs text-cyan-600 hover:text-cyan-700 hover:underline flex-shrink-0"
                    title={`Filter by ${err.code}`}
                  >
                    Filter
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Transport Breakdown (shown when stats available) */}
      {stats && Object.keys(stats.byTransport).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="p-2 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <span className="font-semibold text-slate-700">Transport Breakdown</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Object.entries(stats.byTransport).map(([transport, counts]) => {
              const failRate = counts.total > 0
                ? Math.round((counts.failed / counts.total) * 100)
                : 0;
              return (
                <div
                  key={transport}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <Badge className={getTransportBadgeClass(transport)}>{transport}</Badge>
                    <span className={`text-xs font-semibold ${failRate > 10 ? 'text-red-600' : 'text-emerald-600'}`}>
                      {failRate}% fail
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-slate-800">{counts.total.toLocaleString()}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {counts.failed.toLocaleString()} failed
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
