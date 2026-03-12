import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { useForm } from 'react-hook-form';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ReauthDialog } from '@/components/reauth-dialog';

// ── Types ──────────────────────────────────────────────────────────────────

interface RetentionConfig {
  autoEnabled: boolean;
  requireArchiveBeforeDelete: boolean;
  compressAfterDays: number;
}

interface HypertableRow {
  table: string;
  label: string;
  compressionPolicy: string;
  retentionPolicy: string;
  status: 'active' | 'inactive' | 'unknown';
}

// ── Constants ──────────────────────────────────────────────────────────────

const HYPERTABLES: HypertableRow[] = [
  {
    table: 'ts_telemetry',
    label: 'Telemetry',
    compressionPolicy: 'Compress after 7 days',
    retentionPolicy: 'Set at DB level',
    status: 'active',
  },
  {
    table: 'ts_attributes',
    label: 'Attributes',
    compressionPolicy: 'Compress after 7 days',
    retentionPolicy: 'Set at DB level',
    status: 'active',
  },
  {
    table: 'ts_checklist_responses',
    label: 'Checklist Responses',
    compressionPolicy: 'Compress after 14 days',
    retentionPolicy: 'Set at DB level',
    status: 'active',
  },
  {
    table: 'ts_device_events',
    label: 'Device Events',
    compressionPolicy: 'Compress after 7 days',
    retentionPolicy: 'Set at DB level',
    status: 'active',
  },
  {
    table: 'ts_binary_data',
    label: 'Binary Data',
    compressionPolicy: 'Compress after 30 days',
    retentionPolicy: 'Set at DB level',
    status: 'active',
  },
  {
    table: 'ts_pipeline_traces',
    label: 'Pipeline Traces',
    compressionPolicy: 'Compress after 3 days',
    retentionPolicy: 'Set at DB level',
    status: 'active',
  },
];

const STATUS_STYLES: Record<HypertableRow['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-500',
  unknown: 'bg-amber-100 text-amber-700',
};

// ── Page ───────────────────────────────────────────────────────────────────

export function RetentionConfigPage() {
  const reauth = useReauth();
  const { toast } = useToast();

  // Remote config
  const { data: configData, isLoading, mutate } = useSWR<RetentionConfig>('/api/config/retention', { revalidateOnMount: true, dedupingInterval: 0 });

  // Form
  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<RetentionConfig>({
    defaultValues: {
      autoEnabled: false,
      requireArchiveBeforeDelete: true,
      compressAfterDays: 7,
    },
    values: configData ?? undefined,
  });

  const autoEnabled = watch('autoEnabled');

  // Local UI state
  const [archiving, setArchiving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [archiveDone, setArchiveDone] = useState(false);
  const [confirmExecute, setConfirmExecute] = useState(false);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const onSave = async (formData: RetentionConfig) => {
    await reauth.execute(
      'UPDATE_RETENTION_POLICY',
      async (password?) => {
        if (password) {
          await apiClient.putWithReauth('/api/config/retention', formData, password);
        } else {
          await apiClient.put('/api/config/retention', formData);
        }
        await mutate();
        reset(formData);
        setArchiveDone(false);
        toast.success('Retention Policy Saved', 'Data retention settings updated successfully.');
      },
      {
        onError: (err: any) => {
          toast.error('Save Failed', err?.message ?? 'Failed to save retention policy.');
        },
      },
    );
  };

  const handleArchive = async () => {
    setArchiving(true);
    await reauth.execute(
      'ARCHIVE_DATA',
      async (password?) => {
        if (password) {
          await apiClient.postWithReauth('/api/retention/archive', {}, password);
        } else {
          await apiClient.post('/api/retention/archive', {});
        }
        setArchiveDone(true);
        toast.success('Archive Complete', 'Data has been archived successfully.');
      },
      {
        onError: (err: any) => {
          toast.error('Archive Failed', err?.message ?? 'Failed to archive data.');
        },
      },
    );
    setArchiving(false);
  };

  const handleExecute = async () => {
    setConfirmExecute(false);
    setExecuting(true);
    await reauth.execute(
      'EXECUTE_RETENTION',
      async (password?) => {
        if (password) {
          await apiClient.postWithReauth('/api/retention/execute', {}, password);
        } else {
          await apiClient.post('/api/retention/execute', {});
        }
        setArchiveDone(false);
        toast.success('Retention Executed', 'Retention policy has been executed successfully.');
      },
      {
        onError: (err: any) => {
          toast.error('Execution Failed', err?.message ?? 'Failed to execute retention policy.');
        },
      },
    );
    setExecuting(false);
  };

  // Archive is disabled when: auto retention is on OR settings have unsaved changes
  const archiveDisabled = autoEnabled || isDirty || archiving;
  // Execute is disabled when archive hasn't been done yet in this session
  const executeDisabled = !archiveDone || executing;

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading retention configuration...
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          to="/config"
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:shadow-md transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="p-3 rounded-2xl bg-gradient-to-br from-orange-500 to-red-600 shadow-lg shadow-orange-500/25">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
            Data Retention
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Configure hypertable compression and retention policies
          </p>
        </div>
      </div>

      {/* Warning banner */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-sm text-amber-700">
          <span className="font-semibold">Warning: </span>
          Data retention affects compliance records. Changes require re-authentication and are logged in the audit trail.
        </p>
      </div>

      {/* Settings card */}
      <form onSubmit={handleSubmit(onSave)}>
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">

          {/* Card header */}
          <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-orange-500 to-red-600">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">Retention Settings</h2>
                <p className="text-sm text-slate-500">Configure how data is compressed and retained over time</p>
              </div>
            </div>
          </div>

          {/* Card body */}
          <div className="p-6 space-y-6">

            {/* Toggle: Auto-retention enabled */}
            <div className="p-5 rounded-xl bg-gradient-to-r from-slate-50 to-white border border-slate-200">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    {...register('autoEnabled')}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:ring-4 peer-focus:ring-orange-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500 transition-colors" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">
                    Enable Auto-Retention
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Automatically apply retention policies on a scheduled basis
                  </p>
                </div>
                {autoEnabled && (
                  <Badge className="ml-auto bg-orange-100 text-orange-700 border-0 text-xs">
                    Active
                  </Badge>
                )}
              </label>
            </div>

            {/* Toggle: Require archive before delete */}
            <div className="p-5 rounded-xl bg-gradient-to-r from-slate-50 to-white border border-slate-200">
              <label className="flex items-center gap-3 cursor-pointer group">
                <div className="relative">
                  <input
                    type="checkbox"
                    {...register('requireArchiveBeforeDelete')}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-slate-200 peer-focus:ring-4 peer-focus:ring-orange-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500 transition-colors" />
                </div>
                <div>
                  <span className="text-sm font-semibold text-slate-700 group-hover:text-slate-900">
                    Require Archive Before Delete
                  </span>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Data must be archived before it can be permanently deleted (recommended for compliance)
                  </p>
                </div>
              </label>
            </div>

            {/* Number input: Compress after N days */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2" />
                </svg>
                Compress Data After
              </label>
              <div className="flex items-center gap-3">
                <div className="relative">
                  <input
                    type="number"
                    min={1}
                    max={90}
                    {...register('compressAfterDays', { valueAsNumber: true })}
                    className="w-28 h-11 px-3 pr-14 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 transition-colors bg-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400 pointer-events-none">
                    days
                  </span>
                </div>
                <p className="text-xs text-slate-500">
                  Compress hypertable chunks older than this many days (1–90)
                </p>
              </div>
            </div>

          </div>

          {/* Card footer: save */}
          <div className="px-6 py-4 border-t border-slate-100 bg-gradient-to-r from-slate-50 to-white flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => reset(configData ?? undefined)}
              disabled={!isDirty || isSubmitting}
            >
              Discard Changes
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting || !isDirty}
              className="gap-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 shadow-lg shadow-orange-500/25 text-white border-0"
            >
              {isSubmitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Saving...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Save Settings
                </>
              )}
            </Button>
          </div>
        </div>
      </form>

      {/* Hypertable status table */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">

        {/* Table header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Hypertable Retention Status</h2>
              <p className="text-sm text-slate-500">
                Read-only — policies are managed at the database level via TimescaleDB
              </p>
            </div>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Table
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Compression Policy
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Retention Policy
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {HYPERTABLES.map((row, idx) => (
                <tr
                  key={row.table}
                  className={`hover:bg-slate-50/60 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                      <p className="text-xs font-mono text-slate-400 mt-0.5">{row.table}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-600">{row.compressionPolicy}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-slate-500 italic">{row.retentionPolicy}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[row.status]}`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          row.status === 'active'
                            ? 'bg-emerald-500'
                            : row.status === 'inactive'
                            ? 'bg-slate-400'
                            : 'bg-amber-500'
                        }`}
                      />
                      {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer note */}
        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50">
          <p className="text-xs text-slate-400 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Policies shown above are defaults. Actual policies are enforced by TimescaleDB background jobs.
          </p>
        </div>
      </div>

      {/* Archive & Execute card */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">

        {/* Card header */}
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-red-500 to-rose-600">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Manual Operations</h2>
              <p className="text-sm text-slate-500">
                Trigger archive and retention execution manually — both operations require re-authentication
              </p>
            </div>
          </div>
        </div>

        {/* Card body */}
        <div className="p-6 space-y-5">

          {/* Auto-retention notice */}
          {autoEnabled && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-orange-50 border border-orange-200">
              <svg className="w-5 h-5 text-orange-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm text-orange-700">
                Manual archive is disabled while <strong>Auto-Retention</strong> is enabled. Disable auto-retention to trigger a manual run.
              </p>
            </div>
          )}

          {/* Unsaved changes notice */}
          {isDirty && (
            <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
              <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="text-sm text-amber-700">
                You have <strong>unsaved changes</strong> to the retention settings. Save your settings before archiving.
              </p>
            </div>
          )}

          {/* Archive step */}
          <div className="flex items-start gap-5 p-5 rounded-xl border border-slate-200 bg-slate-50/50">
            <div className="flex-shrink-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${archiveDone ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                {archiveDone ? (
                  <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="text-sm font-semibold text-slate-800">Step 1: Archive Data</p>
                {archiveDone && (
                  <Badge className="bg-emerald-100 text-emerald-700 border-0 text-xs">Done</Badge>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Archive eligible data before deletion. Must be completed before executing retention.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={archiveDisabled}
              onClick={handleArchive}
              className="shrink-0 gap-2"
            >
              {archiving ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Archiving...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                  </svg>
                  Archive Data
                </>
              )}
            </Button>
          </div>

          {/* Execute step */}
          <div className="flex items-start gap-5 p-5 rounded-xl border border-slate-200 bg-slate-50/50">
            <div className="flex-shrink-0">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${executeDisabled ? 'bg-slate-100' : 'bg-red-100'}`}>
                <svg
                  className={`w-5 h-5 ${executeDisabled ? 'text-slate-400' : 'text-red-500'}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 mb-1">Step 2: Execute Retention</p>
              <p className="text-xs text-slate-500">
                Permanently delete data that has exceeded its retention period. This action cannot be undone.
              </p>
              {executeDisabled && !archiveDone && !autoEnabled && !isDirty && (
                <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Complete Step 1 (Archive Data) before executing retention.
                </p>
              )}
            </div>
            <Button
              type="button"
              disabled={executeDisabled}
              onClick={() => setConfirmExecute(true)}
              className={`shrink-0 gap-2 ${
                !executeDisabled
                  ? 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 shadow-lg shadow-red-500/25 text-white border-0'
                  : ''
              }`}
            >
              {executing ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Executing...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Execute Retention
                </>
              )}
            </Button>
          </div>

        </div>
      </div>

      {/* Execute confirmation dialog */}
      <Dialog open={confirmExecute} onClose={() => setConfirmExecute(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            Confirm Retention Execution
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div className="text-sm text-red-700">
              <p className="font-semibold">Warning: This will permanently delete data!</p>
              <p className="mt-2">This action will:</p>
              <ul className="list-disc list-inside mt-1 space-y-1">
                <li>Delete all hypertable chunks past the retention threshold</li>
                <li>Remove data that has been previously archived</li>
                <li>This operation <strong>cannot be undone</strong></li>
              </ul>
              <p className="mt-2 font-semibold">
                Ensure archived data has been exported before proceeding.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-sm text-slate-600">
              You have confirmed that data has been archived in Step 1. Proceeding will execute the retention policy across all hypertables.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmExecute(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleExecute}
            disabled={executing}
            className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white border-0 shadow-lg shadow-red-500/25"
          >
            {executing ? 'Executing...' : 'Execute Retention'}
          </Button>
        </DialogFooter>
      </Dialog>

      {/* ReauthDialog */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Data Retention Operation"
      />

    </div>
  );
}
