import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ReauthDialog } from '@/components/reauth-dialog';

// ── Types ───────────────────────────────────────────────────────────────────

type DataType = 'STRING' | 'INTEGER' | 'FLOAT' | 'BOOLEAN' | 'JSON';

type ConfigCategory =
  | 'rule_engine'
  | 'device'
  | 'pipeline'
  | 'rpc'
  | 'export'
  | 'websocket'
  | 'retention'
  | 'mqtt'
  | 'binary'
  | 'ingestion';

interface SystemConfigEntry {
  key: string;
  value: string;             // JSON-encoded string from the DB
  dataType: DataType;
  category: ConfigCategory;
  label: string;
  description: string;
  defaultValue: string;
  minValue?: number | null;
  maxValue?: number | null;
  unit?: string | null;
  requiresRestart: boolean;
  isSecret: boolean;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

// ── Constants ────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<
  ConfigCategory,
  { label: string; gradient: string; icon: string; description: string }
> = {
  rule_engine: {
    label: 'Rule Engine',
    gradient: 'from-violet-500 to-purple-600',
    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
    description: 'Rule chain evaluation and debug settings',
  },
  device: {
    label: 'Device',
    gradient: 'from-sky-500 to-cyan-600',
    icon: 'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
    description: 'Device connectivity and heartbeat configuration',
  },
  pipeline: {
    label: 'Pipeline',
    gradient: 'from-indigo-500 to-blue-600',
    icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15',
    description: 'Data ingestion pipeline tuning and batch settings',
  },
  rpc: {
    label: 'RPC',
    gradient: 'from-emerald-500 to-teal-600',
    icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
    description: 'Remote procedure call timeout and queue configuration',
  },
  export: {
    label: 'Export',
    gradient: 'from-amber-500 to-orange-600',
    icon: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4',
    description: 'Data export limits and format defaults',
  },
  websocket: {
    label: 'WebSocket',
    gradient: 'from-pink-500 to-rose-600',
    icon: 'M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.858 15.355-5.858 21.213 0',
    description: 'Real-time WebSocket connection and broadcast settings',
  },
  retention: {
    label: 'Retention',
    gradient: 'from-orange-500 to-red-600',
    icon: 'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16',
    description: 'Time-series data retention and compression policies',
  },
  mqtt: {
    label: 'MQTT',
    gradient: 'from-teal-500 to-emerald-600',
    icon: 'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01',
    description: 'MQTT broker connection and message settings',
  },
  binary: {
    label: 'Binary',
    gradient: 'from-slate-500 to-gray-600',
    icon: 'M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4',
    description: 'Binary data ingestion and storage configuration',
  },
  ingestion: {
    label: 'Ingestion',
    gradient: 'from-cyan-500 to-blue-600',
    icon: 'M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4',
    description: 'General data ingestion rate limits and queue settings',
  },
};

const ALL_CATEGORY: ConfigCategory[] = [
  'rule_engine',
  'device',
  'pipeline',
  'rpc',
  'export',
  'websocket',
  'retention',
  'mqtt',
  'binary',
  'ingestion',
];

// ── Helper: parse raw value string by dataType ───────────────────────────────

function parseValue(raw: string, dataType: DataType): boolean | number | string {
  try {
    if (dataType === 'BOOLEAN') return JSON.parse(raw) === true;
    if (dataType === 'INTEGER') return parseInt(JSON.parse(raw), 10);
    if (dataType === 'FLOAT') return parseFloat(JSON.parse(raw));
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function serializeValue(val: boolean | number | string, dataType: DataType): string {
  if (dataType === 'JSON') {
    return val as string;
  }
  return JSON.stringify(val);
}

// ── Sub-components ───────────────────────────────────────────────────────────

interface SettingCardProps {
  entry: SystemConfigEntry;
  onSave: (key: string, newRawValue: string) => Promise<void>;
  onReset: (key: string) => Promise<void>;
}

function SettingCard({ entry, onSave, onReset }: SettingCardProps) {
  const { formatDateTime } = useDatetimeFormat();
  const [localValue, setLocalValue] = useState<string | number | boolean>(
    parseValue(entry.value, entry.dataType),
  );
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Sync when remote data changes
  useEffect(() => {
    setLocalValue(parseValue(entry.value, entry.dataType));
    setDirty(false);
  }, [entry.value, entry.dataType]);

  const originalValue = parseValue(entry.value, entry.dataType);

  const handleChange = (val: string | number | boolean) => {
    setLocalValue(val);
    setDirty(String(val) !== String(originalValue));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(entry.key, serializeValue(localValue, entry.dataType));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      await onReset(entry.key);
      // The parent mutates SWR so useEffect above will update localValue
      setDirty(false);
    } finally {
      setResetting(false);
    }
  };

  const displaySecret = entry.isSecret && !showSecret;

  return (
    <div className="group bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden hover:border-violet-200/60 hover:shadow-violet-100/30 transition-all duration-300">
      {/* Card top accent */}
      <div className="h-0.5 bg-gradient-to-r from-violet-400/50 via-purple-400/40 to-transparent" />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start gap-3 mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-sm font-semibold text-slate-800">{entry.label}</span>

              {entry.requiresRestart && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Requires Restart
                </span>
              )}

              {entry.isSecret && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  Secret
                </span>
              )}

              {entry.unit && (
                <Badge className="bg-blue-50 text-blue-600 border border-blue-200 text-xs font-mono px-2 py-0.5">
                  {entry.unit}
                </Badge>
              )}
            </div>

            <code className="text-xs font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded border border-slate-100">
              {entry.key}
            </code>
          </div>

          {dirty && (
            <span className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-600 border border-indigo-200 animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 inline-block" />
              Unsaved
            </span>
          )}
        </div>

        {/* Description */}
        <p className="text-xs text-slate-500 mb-4 leading-relaxed">{entry.description}</p>

        {/* Value input */}
        <div className="mb-4">
          {entry.dataType === 'BOOLEAN' ? (
            <label className="flex items-center gap-3 cursor-pointer group/toggle p-3 rounded-xl bg-slate-50 border border-slate-200 hover:border-violet-300 transition-colors">
              <div className="relative flex-shrink-0">
                <input
                  type="checkbox"
                  checked={localValue as boolean}
                  onChange={(e) => handleChange(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-slate-200 peer-focus:ring-4 peer-focus:ring-violet-500/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-violet-500 transition-colors" />
              </div>
              <span className="text-sm font-medium text-slate-700 group-hover/toggle:text-slate-900">
                {localValue ? 'Enabled' : 'Disabled'}
              </span>
            </label>
          ) : entry.dataType === 'JSON' ? (
            <div className="relative">
              <textarea
                value={displaySecret ? '••••••••••••••••' : (localValue as string)}
                onChange={(e) => !displaySecret && handleChange(e.target.value)}
                readOnly={displaySecret}
                rows={4}
                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-colors bg-white resize-none"
                placeholder="Enter JSON value..."
              />
            </div>
          ) : entry.dataType === 'INTEGER' || entry.dataType === 'FLOAT' ? (
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <input
                  type="number"
                  value={localValue as number}
                  onChange={(e) => {
                    const val =
                      entry.dataType === 'INTEGER'
                        ? parseInt(e.target.value, 10)
                        : parseFloat(e.target.value);
                    if (!isNaN(val)) handleChange(val);
                  }}
                  min={entry.minValue ?? undefined}
                  max={entry.maxValue ?? undefined}
                  step={entry.dataType === 'FLOAT' ? 'any' : 1}
                  className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-colors bg-white"
                />
              </div>
              {(entry.minValue != null || entry.maxValue != null) && (
                <p className="text-xs text-slate-400">
                  {entry.minValue != null && `Min: ${entry.minValue}`}
                  {entry.minValue != null && entry.maxValue != null && ' · '}
                  {entry.maxValue != null && `Max: ${entry.maxValue}`}
                </p>
              )}
            </div>
          ) : (
            /* STRING */
            <div className="relative">
              <input
                type={displaySecret ? 'password' : 'text'}
                value={localValue as string}
                onChange={(e) => handleChange(e.target.value)}
                className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-400 transition-colors bg-white"
                placeholder="Enter value..."
              />
              {entry.isSecret && (
                <button
                  type="button"
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showSecret ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Default note */}
        <p className="text-xs text-slate-400 mb-4 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Default:&nbsp;
          <span className="font-mono text-slate-500">
            {entry.isSecret ? '••••••••' : String(parseValue(entry.defaultValue, entry.dataType))}
          </span>
        </p>

        {/* Updated by / at */}
        {(entry.updatedBy || entry.updatedAt) && (
          <p className="text-xs text-slate-400 mb-4 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {entry.updatedBy && (
              <>
                Updated by&nbsp;<span className="font-medium text-slate-500">{entry.updatedBy}</span>
                {entry.updatedAt && <>&nbsp;on&nbsp;</>}
              </>
            )}
            {entry.updatedAt && (
              <span className="text-slate-500">{formatDateTime(entry.updatedAt)}</span>
            )}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
          <Button
            size="sm"
            variant="outline"
            disabled={resetting}
            onClick={handleReset}
            className="text-xs gap-1.5 text-slate-500 hover:text-slate-700 hover:border-slate-300"
          >
            {resetting ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Resetting...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Reset to Default
              </>
            )}
          </Button>

          <div className="flex-1" />

          <Button
            size="sm"
            disabled={!dirty || saving}
            onClick={handleSave}
            className="text-xs gap-1.5 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 text-white border-0 shadow-sm shadow-violet-500/20"
          >
            {saving ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Save
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function SystemConfigPage() {
  const { toast } = useToast();
  const reauth = useReauth();

  const [activeCategory, setActiveCategory] = useState<ConfigCategory | 'all'>('all');

  const { data: configs, isLoading, mutate } = useSWR<SystemConfigEntry[]>('/api/config/system');

  // Filter by selected category
  const displayed = configs
    ? activeCategory === 'all'
      ? configs
      : configs.filter((c) => c.category === activeCategory)
    : [];

  // Group displayed entries by category (preserving order)
  const grouped: { category: ConfigCategory; entries: SystemConfigEntry[] }[] = [];
  const seen = new Set<ConfigCategory>();
  for (const entry of displayed) {
    if (!seen.has(entry.category)) {
      seen.add(entry.category);
      grouped.push({ category: entry.category, entries: [] });
    }
    grouped.find((g) => g.category === entry.category)!.entries.push(entry);
  }

  // Counts per category (for badge)
  const countByCategory = (configs ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {});

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleSave = async (key: string, newRawValue: string) => {
    await reauth.execute(
      'UPDATE_SYSTEM_CONFIG',
      async (password?) => {
        if (password) {
          await apiClient.putWithReauth(`/api/config/system/${key}`, { value: newRawValue }, password);
        } else {
          await apiClient.put(`/api/config/system/${key}`, { value: newRawValue });
        }
        await mutate();
        toast.success('Setting Updated', `"${key}" has been updated successfully.`);
      },
      {
        onError: (err: any) => {
          toast.error('Save Failed', err?.message ?? 'Failed to update setting.');
        },
      },
    );
  };

  const handleReset = async (key: string) => {
    await reauth.execute(
      'UPDATE_SYSTEM_CONFIG',
      async (password?) => {
        if (password) {
          await apiClient.putWithReauth(`/api/config/system/${key}/reset`, {}, password);
        } else {
          await apiClient.put(`/api/config/system/${key}/reset`, {});
        }
        await mutate();
        toast.success('Setting Reset', `"${key}" has been reset to its default value.`);
      },
      {
        onError: (err: any) => {
          toast.error('Reset Failed', err?.message ?? 'Failed to reset setting.');
        },
      },
    );
  };

  // ── Loading state ───────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-3 text-slate-500">
          <svg className="w-5 h-5 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          Loading system configuration...
        </div>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 animate-fade-in">

      {/* ── Page Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4">
        <Link
          to="/config"
          className="p-2 rounded-xl bg-white border border-slate-200 text-slate-500 hover:text-slate-700 hover:border-slate-300 hover:shadow-md transition-all"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div className="p-3 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 shadow-lg shadow-violet-500/25">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">
            System Configuration
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Operational settings for data ingestion pipeline
          </p>
        </div>
        <div className="flex-shrink-0 flex items-center gap-3">
          <div className="px-4 py-2 rounded-xl bg-white border border-slate-200 shadow-sm">
            <p className="text-xs text-slate-400 uppercase tracking-wider">Total Settings</p>
            <p className="text-2xl font-bold text-slate-800">{configs?.length ?? 0}</p>
          </div>
        </div>
      </div>

      {/* ── Info Banner ─────────────────────────────────────────────────────── */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <svg className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="text-sm text-amber-700">
          <span className="font-semibold">Super Admin Only.</span> These settings control the behavior of the real-time data ingestion pipeline.
          Settings marked <span className="font-semibold">"Requires Restart"</span> will only take effect after restarting the API service.
          All changes are re-authentication protected and logged in the audit trail.
        </p>
      </div>

      {/* ── Category Filter Tabs ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Filter by Category</p>
          <div className="flex flex-wrap gap-2">
            {/* "All" button */}
            <button
              onClick={() => setActiveCategory('all')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                activeCategory === 'all'
                  ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white shadow-md shadow-violet-500/25'
                  : 'bg-white border border-slate-200 text-slate-600 hover:border-violet-300 hover:text-violet-600 hover:bg-violet-50'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
              All
              <span className={`px-1.5 py-0.5 rounded-md text-xs ${activeCategory === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>
                {configs?.length ?? 0}
              </span>
            </button>

            {/* Per-category buttons */}
            {ALL_CATEGORY.filter((cat) => (countByCategory[cat] ?? 0) > 0).map((cat) => {
              const meta = CATEGORY_META[cat];
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                    isActive
                      ? `bg-gradient-to-r ${meta.gradient} text-white shadow-md`
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={meta.icon} />
                  </svg>
                  {meta.label}
                  <span
                    className={`px-1.5 py-0.5 rounded-md text-xs ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {countByCategory[cat] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Settings Groups ──────────────────────────────────────────────────── */}
      {grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center mb-4">
            <svg className="w-10 h-10 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          </div>
          <p className="text-slate-700 font-semibold text-lg">No settings found</p>
          <p className="text-sm text-slate-400 mt-1">
            No configuration entries are available for this category.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map(({ category, entries }) => {
            const meta = CATEGORY_META[category];
            return (
              <div key={category} className="space-y-4">
                {/* Category section header */}
                <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl shadow-slate-200/40 overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white">
                    <div className="flex items-center gap-3">
                      <div className={`p-2.5 rounded-xl bg-gradient-to-br ${meta.gradient} shadow-sm`}>
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={meta.icon} />
                        </svg>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-lg font-semibold text-slate-800">{meta.label}</h2>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                            {entries.length} setting{entries.length !== 1 ? 's' : ''}
                          </span>
                        </div>
                        <p className="text-sm text-slate-500 mt-0.5">{meta.description}</p>
                      </div>
                    </div>
                  </div>

                  {/* Settings grid */}
                  <div className="p-5">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      {entries.map((entry) => (
                        <SettingCard
                          key={entry.key}
                          entry={entry}
                          onSave={handleSave}
                          onReset={handleReset}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Footer info ─────────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-violet-50 via-purple-50 to-indigo-50 border border-violet-100/50 p-5">
        <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-violet-500/10 to-purple-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative flex items-start gap-4">
          <div className="flex-shrink-0 p-3 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-lg shadow-violet-500/25">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-violet-900 mb-1">Hot-Reload Configuration</h3>
            <p className="text-sm text-violet-700">
              Most settings take effect immediately without a server restart. Settings marked
              <span className="inline-flex items-center gap-1 mx-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 border border-amber-200">
                Requires Restart
              </span>
              will only apply after restarting the <code className="font-mono text-xs bg-violet-100 px-1.5 py-0.5 rounded">digilog-api</code> PM2 process.
            </p>
            <div className="flex flex-wrap gap-3 mt-3">
              <div className="flex items-center gap-1.5 text-xs text-violet-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Re-auth protected</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-violet-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span>Audit logged</span>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-violet-600">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Reset to default available</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── ReauthDialog ─────────────────────────────────────────────────────── */}
      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Update System Configuration"
      />
    </div>
  );
}
