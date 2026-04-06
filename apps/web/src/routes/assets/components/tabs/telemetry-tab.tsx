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
  const isAdmin = userRole === 'SUPER_ADMIN' || userRole === 'ADMIN';

  // Time range state
  const [timePreset, setTimePreset] = useState('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const HPAGE_SIZE = 25;

  // Delete state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Key-based delete state
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [showKeyDeleteDialog, setShowKeyDeleteDialog] = useState(false);
  const [keyDeleteTarget, setKeyDeleteTarget] = useState<string[]>([]);
  const [deletingKeys, setDeletingKeys] = useState(false);

  // History row delete state
  const [selectedHistoryRows, setSelectedHistoryRows] = useState<Set<string>>(new Set());
  const [showHistoryDeleteDialog, setShowHistoryDeleteDialog] = useState(false);
  const [historyDeleteTarget, setHistoryDeleteTarget] = useState<Array<{ time: string; key: string }>>([]);
  const [deletingHistoryRows, setDeletingHistoryRows] = useState(false);

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
  const { data: liveData, isLoading: liveLoading, mutate: mutateLive } = useSWR<Array<{ key: string; valueNum: number | null; valueStr: string | null; valueBool: boolean | null; valueJson: any; lastUpdated: string }>>(
    `/api/telemetry/${entityId}/latest`,
    { refreshInterval: 10000 }
  );

  // Fetch historical telemetry (client-side pagination)
  const { data: historyData, isLoading: histLoading, mutate: mutateHistory } = useSWR<{ data: any[]; meta: any }>(
    `/api/telemetry/${entityId}/timeseries?from=${encodeURIComponent(timeRange.from)}&to=${encodeURIComponent(timeRange.to)}`,
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

  // All live telemetry keys for bulk selection
  const allLiveKeys = useMemo(() => liveData?.map(d => d.key) ?? [], [liveData]);

  const toggleKey = (key: string) => {
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const toggleAllKeys = () => {
    if (selectedKeys.size === allLiveKeys.length) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(allLiveKeys));
    }
  };

  // Bulk delete (time-range based)
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

  // Individual / bulk key delete
  const handleDeleteKeys = async (keys: string[]) => {
    setKeyDeleteTarget(keys);
    setShowKeyDeleteDialog(true);
  };

  const confirmDeleteKeys = async () => {
    setDeletingKeys(true);
    try {
      await apiClient.post('/api/retention/delete-keys', { dataType: 'telemetry', entityId, keys: keyDeleteTarget, confirmed: true });
      mutateLive();
      mutateHistory();
      setShowKeyDeleteDialog(false);
      setKeyDeleteTarget([]);
      setSelectedKeys(prev => {
        const next = new Set(prev);
        for (const k of keyDeleteTarget) next.delete(k);
        return next;
      });
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeletingKeys(false);
    }
  };

  // History row helpers
  const makeRowId = (row: any) => `${row.time || row.bucket}||${row.key}`;

  const toggleHistoryRow = (row: any) => {
    const id = makeRowId(row);
    setSelectedHistoryRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllHistoryRows = () => {
    if (selectedHistoryRows.size === pagedHistory.length) {
      setSelectedHistoryRows(new Set());
    } else {
      setSelectedHistoryRows(new Set(pagedHistory.map(makeRowId)));
    }
  };

  const handleDeleteHistoryRows = (rows: Array<{ time: string; key: string }>) => {
    setHistoryDeleteTarget(rows);
    setShowHistoryDeleteDialog(true);
  };

  const confirmDeleteHistoryRows = async () => {
    setDeletingHistoryRows(true);
    try {
      await apiClient.post('/api/retention/delete-records', { dataType: 'telemetry', entityId, records: historyDeleteTarget, confirmed: true });
      mutateHistory();
      mutateLive();
      setShowHistoryDeleteDialog(false);
      setHistoryDeleteTarget([]);
      setSelectedHistoryRows(new Set());
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeletingHistoryRows(false);
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
        <div className="flex items-center gap-2">
          {isAdmin && selectedKeys.size > 0 && (
            <button onClick={() => handleDeleteKeys(Array.from(selectedKeys))} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
              Delete Selected ({selectedKeys.size})
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setShowDeleteDialog(true)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
              Delete Data
            </button>
          )}
        </div>
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
          <div className="flex items-center gap-3">
            <h4 className="font-semibold text-slate-800">Live Telemetry Data</h4>
            {isAdmin && allLiveKeys.length > 0 && (
              <button onClick={toggleAllKeys} className="text-[10px] text-slate-500 hover:text-slate-700 underline">
                {selectedKeys.size === allLiveKeys.length ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>
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
              const isSelected = selectedKeys.has(row.key);
              return (
                <div key={row.key} className={cn('bg-gradient-to-br from-slate-50 to-white rounded-lg border p-3 relative group', isSelected ? 'border-red-300 bg-red-50/30' : 'border-slate-200')}>
                  {isAdmin && (
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleKey(row.key)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                      />
                      <button
                        onClick={() => handleDeleteKeys([row.key])}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                        title={`Delete "${row.key}"`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  )}
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
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-slate-800">Telemetry History</h4>
          {isAdmin && selectedHistoryRows.size > 0 && (
            <button
              onClick={() => {
                const rows = pagedHistory.filter((r: any) => selectedHistoryRows.has(makeRowId(r))).map((r: any) => ({ time: r.time || r.bucket, key: r.key }));
                handleDeleteHistoryRows(rows);
              }}
              className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
            >
              Delete Selected ({selectedHistoryRows.size})
            </button>
          )}
        </div>
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
                  {isAdmin && (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={pagedHistory.length > 0 && selectedHistoryRows.size === pagedHistory.length}
                        onChange={toggleAllHistoryRows}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                      />
                    </TableHead>
                  )}
                  <TableHead className="font-semibold text-slate-600">Timestamp</TableHead>
                  <TableHead className="font-semibold text-slate-600">Key</TableHead>
                  <TableHead className="font-semibold text-slate-600">Value</TableHead>
                  {isAdmin && <TableHead className="w-10"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedHistory.map((row: any, idx: number) => {
                  const rowId = makeRowId(row);
                  const isRowSelected = selectedHistoryRows.has(rowId);
                  return (
                    <TableRow key={idx} className={isRowSelected ? 'bg-red-50/40' : undefined}>
                      {isAdmin && (
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={isRowSelected}
                            onChange={() => toggleHistoryRow(row)}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                          />
                        </TableCell>
                      )}
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(row.time || row.bucket)}</TableCell>
                      <TableCell className="font-medium text-sm">{row.key}</TableCell>
                      <TableCell className="text-sm">{row.value_num ?? row.value_str ?? row.value ?? String(row.value_bool ?? '-')}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          <button
                            onClick={() => handleDeleteHistoryRows([{ time: row.time || row.bucket, key: row.key }])}
                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                            title="Delete this record"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-slate-500">{historyData?.meta?.totalPoints ?? historyRows.length} total points</p>
              <div className="flex items-center gap-2">
                <button onClick={() => { setHistoryPage(p => Math.max(1, p - 1)); setSelectedHistoryRows(new Set()); }} disabled={historyPage <= 1} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Prev</button>
                <span className="text-xs text-slate-500">Page {historyPage} of {totalHistoryPages}</span>
                <button onClick={() => { setHistoryPage(p => Math.min(totalHistoryPages, p + 1)); setSelectedHistoryRows(new Set()); }} disabled={historyPage >= totalHistoryPages} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Next</button>
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
                {isAdmin && <TableHead className="w-10"></TableHead>}
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
                    {isAdmin && (
                      <TableCell>
                        {live && (
                          <button
                            onClick={() => handleDeleteKeys([tel.fieldName])}
                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                            title={`Delete "${tel.fieldName}" data`}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        )}
                      </TableCell>
                    )}
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

      {/* Delete Time Range Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Telemetry Data</h3>
            <p className="text-sm text-slate-600 mb-4">This will permanently delete telemetry data within the selected time range for this entity. This action cannot be undone.</p>
            <div className="space-y-2 mb-4 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">From:</span><span className="text-slate-700 font-mono text-xs">{formatDateTime(timeRange.from)}</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">To:</span><span className="text-slate-700 font-mono text-xs">{formatDateTime(timeRange.to)}</span></div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteDialog(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete History Records Confirmation Dialog */}
      {showHistoryDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowHistoryDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-[28rem] shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete History Record{historyDeleteTarget.length > 1 ? 's' : ''}</h3>
            <p className="text-sm text-slate-600 mb-4">
              This will permanently delete <span className="font-semibold">{historyDeleteTarget.length}</span> telemetry history record{historyDeleteTarget.length > 1 ? 's' : ''} from this entity. This action cannot be undone.
            </p>
            <div className="mb-4 bg-slate-50 rounded-lg p-3 max-h-48 overflow-y-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-slate-500"><th className="text-left pb-1 font-medium">Timestamp</th><th className="text-left pb-1 font-medium">Key</th></tr></thead>
                <tbody>
                  {historyDeleteTarget.map((rec, i) => (
                    <tr key={i} className="border-t border-slate-100">
                      <td className="py-1 font-mono text-slate-600">{formatDateTime(rec.time)}</td>
                      <td className="py-1 font-mono text-slate-700">{rec.key}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowHistoryDeleteDialog(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button onClick={confirmDeleteHistoryRows} disabled={deletingHistoryRows} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deletingHistoryRows ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Keys Confirmation Dialog */}
      {showKeyDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowKeyDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Telemetry Key{keyDeleteTarget.length > 1 ? 's' : ''}</h3>
            <p className="text-sm text-slate-600 mb-4">
              This will permanently delete <span className="font-semibold">all data</span> (latest + history) for the selected telemetry key{keyDeleteTarget.length > 1 ? 's' : ''} from this entity. This action cannot be undone.
            </p>
            <div className="mb-4 bg-slate-50 rounded-lg p-3 max-h-40 overflow-y-auto">
              {keyDeleteTarget.map(key => (
                <div key={key} className="flex items-center gap-2 py-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-400 flex-shrink-0" />
                  <span className="text-sm font-mono text-slate-700">{key}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowKeyDeleteDialog(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button onClick={confirmDeleteKeys} disabled={deletingKeys} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deletingKeys ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
