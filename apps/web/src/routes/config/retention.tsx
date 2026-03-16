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
  telemetry: { retentionDays: number; compressionAfterDays: number };
  attributes: { retentionDays: number };
  events: { retentionDays: number };
  traces: { retentionHours: number };
  checklists: { retentionDays: number };
  autoEnabled: boolean;
  requiresArchive: boolean;
}

interface HypertableRow {
  table: string;
  label: string;
  configKey: string;
  unit: string;
  status: 'active' | 'inactive' | 'unknown';
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULTS: RetentionConfig = {
  telemetry: { retentionDays: 365, compressionAfterDays: 7 },
  attributes: { retentionDays: 730 },
  events: { retentionDays: 365 },
  traces: { retentionHours: 48 },
  checklists: { retentionDays: 2555 },
  autoEnabled: false,
  requiresArchive: true,
};

const HYPERTABLES: HypertableRow[] = [
  { table: 'ts_telemetry', label: 'Telemetry', configKey: 'telemetry', unit: 'days', status: 'active' },
  { table: 'ts_attributes', label: 'Attributes', configKey: 'attributes', unit: 'days', status: 'active' },
  { table: 'ts_checklist_responses', label: 'Checklist Responses', configKey: 'checklists', unit: 'days', status: 'active' },
  { table: 'ts_device_events', label: 'Device Events', configKey: 'events', unit: 'days', status: 'active' },
  { table: 'ts_pipeline_traces', label: 'Pipeline Traces', configKey: 'traces', unit: 'hours', status: 'active' },
];

const STATUS_STYLES: Record<HypertableRow['status'], string> = {
  active: 'bg-emerald-100 text-emerald-700',
  inactive: 'bg-slate-100 text-slate-500',
  unknown: 'bg-amber-100 text-amber-700',
};

const DATA_TYPE_OPTIONS = [
  { value: 'telemetry', label: 'Telemetry' },
  { value: 'attributes', label: 'Attributes' },
  { value: 'events', label: 'Device Events' },
  { value: 'traces', label: 'Pipeline Traces' },
  { value: 'checklists', label: 'Checklists' },
];

// ── Helpers ────────────────────────────────────────────────────────────────

function getRetentionValue(config: RetentionConfig, key: string): number {
  if (key === 'telemetry') return config.telemetry.retentionDays;
  if (key === 'attributes') return config.attributes.retentionDays;
  if (key === 'events') return config.events.retentionDays;
  if (key === 'traces') return config.traces.retentionHours;
  if (key === 'checklists') return config.checklists.retentionDays;
  return 0;
}

// ── Page ───────────────────────────────────────────────────────────────────

export function RetentionConfigPage() {
  const reauth = useReauth();
  const { toast } = useToast();

  const { data: configData, isLoading, mutate } = useSWR<RetentionConfig>('/api/config/retention', { revalidateOnMount: true, dedupingInterval: 0 });

  const {
    register,
    handleSubmit,
    watch,
    reset,
    formState: { isSubmitting, isDirty },
  } = useForm<RetentionConfig>({
    defaultValues: DEFAULTS,
    values: configData ?? undefined,
  });

  const autoEnabled = watch('autoEnabled');
  const requiresArchive = watch('requiresArchive');

  const [executing, setExecuting] = useState(false);
  const [confirmExecute, setConfirmExecute] = useState(false);
  const [dataType, setDataType] = useState<string>('telemetry');
  const [olderThanDays, setOlderThanDays] = useState<number>(365);

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
        toast.success('Retention Policy Saved', 'Data retention settings updated successfully.');
      },
      { onError: (err: any) => toast.error('Save Failed', err?.message ?? 'Failed to save retention policy.') },
    );
  };

  const handleExecute = async () => {
    setConfirmExecute(false);
    setExecuting(true);
    await reauth.execute(
      'EXECUTE_RETENTION',
      async (password?) => {
        const body = { dataType, olderThanDays, confirmed: true };
        if (password) {
          await apiClient.postWithReauth('/api/retention/execute', body, password);
        } else {
          await apiClient.post('/api/retention/execute', body);
        }
        toast.success('Retention Executed', `Old ${DATA_TYPE_OPTIONS.find(o => o.value === dataType)?.label} data deleted successfully.`);
      },
      { onError: (err: any) => toast.error('Execution Failed', err?.message ?? 'Failed to execute retention policy.') },
    );
    setExecuting(false);
  };

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

  return (
    <div className="space-y-6 animate-fade-in">

      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/config" className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:shadow-md transition-all">
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
          <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Data Retention</h1>
          <p className="text-sm text-slate-500 mt-0.5">Configure hypertable compression and retention policies</p>
        </div>
      </div>

      {/* Warning */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-sm text-amber-700">
          <span className="font-semibold">Warning: </span>
          Data retention affects compliance records. Changes require re-authentication and are logged in the audit trail.
        </p>
      </div>

      {/* Settings form */}
      <form onSubmit={handleSubmit(onSave)}>
        <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
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
                <p className="text-sm text-slate-500">Configure how long each data type is retained</p>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Toggles */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-5 rounded-xl bg-gradient-to-r from-slate-50 to-white border border-slate-200">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" {...register('autoEnabled')} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:ring-4 peer-focus:ring-orange-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-500 transition-colors" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-slate-700">Enable Auto-Retention</span>
                    <p className="text-xs text-slate-500 mt-0.5">Automatically apply retention policies on schedule</p>
                  </div>
                  {autoEnabled && <Badge className="ml-auto bg-orange-100 text-orange-700 border-0 text-xs">Active</Badge>}
                </label>
              </div>
              <div className="p-5 rounded-xl bg-gradient-to-r from-slate-50 to-white border border-slate-200">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input type="checkbox" {...register('requiresArchive')} className="sr-only peer" />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:ring-4 peer-focus:ring-blue-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500 transition-colors" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-slate-700">Require Archive Before Delete</span>
                    <p className="text-xs text-slate-500 mt-0.5">Data must be archived before retention runs</p>
                  </div>
                  {requiresArchive && <Badge className="ml-auto bg-blue-100 text-blue-700 border-0 text-xs">Enabled</Badge>}
                </label>
              </div>
            </div>

            {/* Per-table retention */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
                Retention Periods by Data Type
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Telemetry */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">Telemetry</span>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Retain for</label>
                    <div className="relative">
                      <input type="number" min={1} {...register('telemetry.retentionDays', { valueAsNumber: true })} className="w-full h-10 px-3 pr-14 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">days</span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Compress after</label>
                    <div className="relative">
                      <input type="number" min={1} max={90} {...register('telemetry.compressionAfterDays', { valueAsNumber: true })} className="w-full h-10 px-3 pr-14 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">days</span>
                    </div>
                  </div>
                </div>

                {/* Attributes */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">Attributes</span>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Retain for</label>
                    <div className="relative">
                      <input type="number" min={1} {...register('attributes.retentionDays', { valueAsNumber: true })} className="w-full h-10 px-3 pr-14 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">days</span>
                    </div>
                  </div>
                </div>

                {/* Device Events */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">Device Events</span>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Retain for</label>
                    <div className="relative">
                      <input type="number" min={1} {...register('events.retentionDays', { valueAsNumber: true })} className="w-full h-10 px-3 pr-14 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">days</span>
                    </div>
                  </div>
                </div>

                {/* Pipeline Traces */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">Pipeline Traces</span>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Retain for</label>
                    <div className="relative">
                      <input type="number" min={1} {...register('traces.retentionHours', { valueAsNumber: true })} className="w-full h-10 px-3 pr-14 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">hours</span>
                    </div>
                  </div>
                </div>

                {/* Checklists */}
                <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-cyan-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>
                    </div>
                    <span className="text-sm font-semibold text-slate-800">Checklists</span>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-slate-500">Retain for</label>
                    <div className="relative">
                      <input type="number" min={1} {...register('checklists.retentionDays', { valueAsNumber: true })} className="w-full h-10 px-3 pr-14 border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-400 bg-white" />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">days</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Save footer */}
          <div className="px-6 py-4 border-t border-slate-100 bg-gradient-to-r from-slate-50 to-white flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={() => reset(configData ?? undefined)} disabled={!isDirty || isSubmitting}>Discard Changes</Button>
            <Button type="submit" disabled={isSubmitting || !isDirty} className="gap-2 bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700 shadow-lg shadow-orange-500/25 text-white border-0">
              {isSubmitting ? (
                <><svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>Saving...</>
              ) : (
                <><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Save Settings</>
              )}
            </Button>
          </div>
        </div>
      </form>

      {/* Hypertable status */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-slate-500 to-slate-600">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Hypertable Status</h2>
              <p className="text-sm text-slate-500">Current retention periods per table (from saved settings)</p>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gradient-to-r from-slate-50 to-white border-b border-slate-200">
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Table</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Retention Period</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {HYPERTABLES.map((row, idx) => (
                <tr key={row.table} className={`hover:bg-slate-50/60 transition-colors ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                  <td className="px-6 py-4">
                    <p className="text-sm font-semibold text-slate-800">{row.label}</p>
                    <p className="text-xs font-mono text-slate-400 mt-0.5">{row.table}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-sm font-medium text-slate-700">{configData ? getRetentionValue(configData, row.configKey) : '\u2014'} {row.unit}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${STATUS_STYLES[row.status]}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${row.status === 'active' ? 'bg-emerald-500' : row.status === 'inactive' ? 'bg-slate-400' : 'bg-amber-500'}`} />
                      {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manual execution */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-red-500 to-rose-600">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">Manual Retention</h2>
              <p className="text-sm text-slate-500">Trigger retention execution manually</p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Data Type</label>
              <select value={dataType} onChange={(e) => setDataType(e.target.value)} className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 bg-white">
                {DATA_TYPE_OPTIONS.map((opt) => (<option key={opt.value} value={opt.value}>{opt.label}</option>))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">Delete Data Older Than</label>
              <div className="relative">
                <input type="number" min={1} value={olderThanDays} onChange={(e) => setOlderThanDays(Math.max(1, parseInt(e.target.value) || 1))} className="w-full h-11 px-3 pr-14 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-400 bg-white" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">days</span>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between p-4 rounded-xl border border-red-200 bg-red-50/50">
            <div>
              <p className="text-sm font-semibold text-slate-800">Permanently delete <strong>{DATA_TYPE_OPTIONS.find(o => o.value === dataType)?.label}</strong> data older than <strong>{olderThanDays} days</strong></p>
              <p className="text-xs text-slate-500 mt-1">This action cannot be undone.</p>
            </div>
            <Button type="button" disabled={executing} onClick={() => setConfirmExecute(true)} className="shrink-0 gap-2 bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 shadow-lg shadow-red-500/25 text-white border-0">
              {executing ? 'Executing...' : 'Execute Retention'}
            </Button>
          </div>
        </div>
      </div>

      {/* Confirm dialog */}
      <Dialog open={confirmExecute} onClose={() => setConfirmExecute(false)}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-red-100">
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            </div>
            Confirm Retention Execution
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
            <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
            <div className="text-sm text-red-700">
              <p className="font-semibold">This will permanently delete data!</p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Delete <strong>{DATA_TYPE_OPTIONS.find(o => o.value === dataType)?.label}</strong> data older than <strong>{olderThanDays} days</strong></li>
                <li>This operation <strong>cannot be undone</strong></li>
              </ul>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmExecute(false)}>Cancel</Button>
          <Button onClick={handleExecute} disabled={executing} className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white border-0">
            {executing ? 'Executing...' : 'Execute Retention'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying} onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} actionLabel="Data Retention Operation" />
    </div>
  );
}
