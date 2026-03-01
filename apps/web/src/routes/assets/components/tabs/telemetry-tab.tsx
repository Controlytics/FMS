import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import type { TelemetryDefinition } from '../../types';

export function TelemetryTab({ entityId, template, telemetryConfig, formatDateTime, wsConnected, userRole }: { entityId: string; template: any; telemetryConfig: Record<string, any>; formatDateTime: (v: string | Date) => string; wsConnected?: boolean; userRole?: string }) {
  const telSchema = template?.telemetrySchema as TelemetryDefinition[] | undefined;

  // Time range state
  const [timePreset, setTimePreset] = useState('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const HPAGE_SIZE = 25;

  // Delete state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteOlderDays, setDeleteOlderDays] = useState(30);
  const [deleting, setDeleting] = useState(false);

  // Calculate from/to based on preset
  const timeRange = useMemo(() => {
    if (timePreset === 'custom') {
      return { from: customFrom || new Date(Date.now() - 86400000).toISOString(), to: customTo || new Date().toISOString() };
    }
    const now = new Date();
    const ms: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return { from: new Date(now.getTime() - (ms[timePreset] || 86400000)).toISOString(), to: now.toISOString() };
  }, [timePreset, customFrom, customTo]);

  // Fetch live telemetry data
  const { data: liveData, isLoading: liveLoading } = useSWR<Array<{ key: string; valueNum: number | null; valueStr: string | null; valueBool: boolean | null; valueJson: any; lastUpdated: string }>>(
    `/api/telemetry/${entityId}/latest`,
    { refreshInterval: 10000 }
  );

  // Fetch historical telemetry (client-side pagination)
  const { data: historyData, isLoading: histLoading, mutate: mutateHistory } = useSWR<{ data: any[]; meta: any }>(
    `/api/telemetry/${entityId}/timeseries?from=${encodeURIComponent(timeRange.from)}&to=${encodeURIComponent(timeRange.to)}&limit=500`,
    { refreshInterval: 30000 }
  );

  // Build a lookup map for live data
  const liveMap = useMemo(() => {
    const map: Record<string, { value: any; lastUpdated: string }> = {};
    if (liveData) {
      for (const row of liveData) {
        const value = row.valueNum !== null ? row.valueNum
          : row.valueBool !== null ? row.valueBool
          : row.valueStr !== null ? row.valueStr
          : row.valueJson !== null ? JSON.stringify(row.valueJson)
          : null;
        map[row.key] = { value, lastUpdated: row.lastUpdated };
      }
    }
    return map;
  }, [liveData]);

  // Paginate history client-side
  const historyRows = historyData?.data ?? [];
  const totalHistoryPages = Math.max(1, Math.ceil(historyRows.length / HPAGE_SIZE));
  const pagedHistory = historyRows.slice((historyPage - 1) * HPAGE_SIZE, historyPage * HPAGE_SIZE);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.post('/api/retention/execute-range', { dataType: 'telemetry', from: timeRange.from, to: timeRange.to, entityId, confirmed: true });
      mutateHistory();
      setShowDeleteDialog(false);
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Controls Row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {wsConnected && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          )}
        </div>
        {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') && (
          <button onClick={() => setShowDeleteDialog(true)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
            Delete Data
          </button>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {['1h', '6h', '24h', '7d', '30d', 'custom'].map(p => (
          <button key={p} onClick={() => { setTimePreset(p); setHistoryPage(1); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', timePreset === p ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {p === 'custom' ? 'Custom' : `Last ${p}`}
          </button>
        ))}
        {timePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="datetime-local" value={customFrom ? customFrom.slice(0, 16) : ''} onChange={e => { setCustomFrom(new Date(e.target.value).toISOString()); setHistoryPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
            <span className="text-xs text-slate-400">to</span>
            <input type="datetime-local" value={customTo ? customTo.slice(0, 16) : ''} onChange={e => { setCustomTo(new Date(e.target.value).toISOString()); setHistoryPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
          </div>
        )}
      </div>

      {/* Live Telemetry Data */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-slate-800">Live Telemetry Data</h4>
          {liveLoading && (
            <svg className="w-4 h-4 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
          )}
          {!liveLoading && liveData && liveData.length > 0 && (
            <span className="text-[10px] text-slate-400">{wsConnected ? 'Real-time via WebSocket' : 'Auto-refreshes every 10s'}</span>
          )}
        </div>
        {(!liveData || liveData.length === 0) && !liveLoading ? (
          <p className="text-sm text-slate-500">No telemetry data received yet. Send data using the code snippets from the Connectivity tab.</p>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {(liveData ?? []).map((row) => {
              const value = row.valueNum !== null ? row.valueNum
                : row.valueBool !== null ? String(row.valueBool)
                : row.valueStr !== null ? row.valueStr
                : row.valueJson !== null ? JSON.stringify(row.valueJson)
                : '-';
              const schema = telSchema?.find(t => t.fieldName === row.key);
              return (
                <div key={row.key} className="bg-gradient-to-br from-slate-50 to-white rounded-lg border border-slate-200 p-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{row.key}</p>
                  <p className="text-lg font-bold text-slate-800 mt-0.5">
                    {typeof value === 'number' ? value.toLocaleString() : value}
                    {schema?.unit && <span className="text-xs font-normal text-slate-400 ml-1">{schema.unit}</span>}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{formatDateTime(row.lastUpdated)}</p>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Telemetry History Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Telemetry History</h4>
        {histLoading ? (
          <div className="text-center py-4"><svg className="w-5 h-5 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : pagedHistory.length === 0 ? (
          <p className="text-sm text-slate-500">No telemetry data in selected time range.</p>
        ) : (
          <>
            {historyData?.meta?.aggregated && (
              <p className="text-xs text-amber-600 mb-2">Data has been aggregated (interval: {historyData.meta.interval}). Showing averaged values.</p>
            )}
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="font-semibold text-slate-600">Timestamp</TableHead>
                  <TableHead className="font-semibold text-slate-600">Key</TableHead>
                  <TableHead className="font-semibold text-slate-600">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedHistory.map((row: any, idx: number) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs whitespace-nowrap">{formatDateTime(row.time || row.bucket)}</TableCell>
                    <TableCell className="font-medium text-sm">{row.key}</TableCell>
                    <TableCell className="text-sm">{row.value_num ?? row.value_str ?? row.value ?? String(row.value_bool ?? '-')}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-slate-500">{historyData?.meta?.totalPoints ?? historyRows.length} total points</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Prev</button>
                <span className="text-xs text-slate-500">Page {historyPage} of {totalHistoryPages}</span>
                <button onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))} disabled={historyPage >= totalHistoryPages} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Schema Definition */}
      {telSchema && telSchema.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="font-semibold text-slate-800 mb-3">Telemetry Schema</h4>
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="font-semibold text-slate-600">Field Name</TableHead>
                <TableHead className="font-semibold text-slate-600">Data Type</TableHead>
                <TableHead className="font-semibold text-slate-600">Unit</TableHead>
                <TableHead className="font-semibold text-slate-600">Description</TableHead>
                <TableHead className="font-semibold text-slate-600">Live Value</TableHead>
                <TableHead className="font-semibold text-slate-600">Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {telSchema.map((tel, idx) => {
                const live = liveMap[tel.fieldName];
                return (
                  <TableRow key={idx}>
                    <TableCell className="font-medium text-slate-800">{tel.fieldName}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{tel.dataType}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-500">{tel.unit || '-'}</TableCell>
                    <TableCell className="text-slate-500">{tel.description || '-'}</TableCell>
                    <TableCell className="text-slate-800 font-medium">
                      {live ? (typeof live.value === 'number' ? live.value.toLocaleString() : String(live.value ?? '-')) : <span className="text-slate-400">-</span>}
                    </TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {live ? formatDateTime(live.lastUpdated) : '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {(!telSchema || telSchema.length === 0) && (!liveData || liveData.length === 0) && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500">No telemetry points defined for this template and no live data received.</p>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Telemetry Data</h3>
            <p className="text-sm text-slate-600 mb-4">This will permanently delete telemetry data within the selected time range for this entity. This action cannot be undone.</p>
            <div className="space-y-2 mb-4 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">From:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.from).toLocaleString()}</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">To:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.to).toLocaleString()}</span></div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteDialog(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
