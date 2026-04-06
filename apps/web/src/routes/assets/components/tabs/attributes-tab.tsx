import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import type { AttributeDefinition } from '../../types';

export function AttributesTab({ entityId, template, attributes, formatDateTime, wsConnected, userRole }: { entityId: string; template: any; attributes: Record<string, any> | undefined; formatDateTime: (v: string | Date) => string; wsConnected?: boolean; userRole?: string }) {
  const attrSchema = (template?.attributeSchema as AttributeDefinition[]) ?? [];
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

  // Calculate from/to
  const timeRange = useMemo(() => {
    if (timePreset === 'custom') {
      return { from: customFrom || new Date(Date.now() - 86400000).toISOString(), to: customTo || new Date().toISOString() };
    }
    const now = new Date();
    const ms: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return { from: new Date(now.getTime() - (ms[timePreset] || 86400000)).toISOString(), to: now.toISOString() };
  }, [timePreset, customFrom, customTo]);

  // Fetch live device-reported attributes
  const { data: liveAttrs, isLoading, mutate: mutateLive } = useSWR<Array<{ key: string; value: any; updatedBy?: string; lastUpdated: string }>>(
    `/api/attributes/${entityId}/all`,
    { refreshInterval: 10000 }
  );

  // Fetch attribute history (server-side pagination)
  const histParams = new URLSearchParams({ from: timeRange.from, to: timeRange.to, page: String(historyPage), limit: String(HPAGE_SIZE) });
  const { data: historyData, isLoading: histLoading, mutate: mutateHistory } = useSWR<{ data: any[]; total: number; page: number; limit: number }>(
    `/api/attributes/${entityId}/history?${histParams}`,
    { refreshInterval: 30000 }
  );

  // Build lookup of live attributes
  const liveMap = useMemo(() => {
    const map: Record<string, { value: any; updatedBy?: string; lastUpdated: string }> = {};
    if (liveAttrs) {
      for (const row of liveAttrs) {
        map[row.key] = { value: row.value, updatedBy: row.updatedBy, lastUpdated: row.lastUpdated };
      }
    }
    return map;
  }, [liveAttrs]);

  const schemaKeys = new Set(attrSchema.map(a => a.fieldName));
  const extraKeys = liveAttrs?.filter(a => !schemaKeys.has(a.key)) ?? [];
  const totalHistoryPages = historyData ? Math.max(1, Math.ceil(historyData.total / HPAGE_SIZE)) : 1;

  // All live attribute keys for bulk selection
  const allLiveKeys = useMemo(() => liveAttrs?.map(a => a.key) ?? [], [liveAttrs]);

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
      await apiClient.post('/api/retention/execute-range', { dataType: 'attributes', from: timeRange.from, to: timeRange.to, entityId, confirmed: true });
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
      await apiClient.post('/api/retention/delete-keys', { dataType: 'attributes', entityId, keys: keyDeleteTarget, confirmed: true });
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

      {/* Live Device-Reported Attributes */}
      {liveAttrs && liveAttrs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <h4 className="font-semibold text-slate-800">Device-Reported Attributes</h4>
              {isAdmin && allLiveKeys.length > 0 && (
                <button onClick={toggleAllKeys} className="text-[10px] text-slate-500 hover:text-slate-700 underline">
                  {selectedKeys.size === allLiveKeys.length ? 'Deselect All' : 'Select All'}
                </button>
              )}
            </div>
            {isLoading && (
              <svg className="w-4 h-4 animate-spin text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            )}
            {!isLoading && (
              <span className="text-[10px] text-slate-400">{wsConnected ? 'Real-time via WebSocket' : 'Auto-refreshes every 10s'}</span>
            )}
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {liveAttrs.map((attr) => {
              const schema = attrSchema.find(s => s.fieldName === attr.key);
              const displayVal = attr.value === null || attr.value === undefined ? '-'
                : typeof attr.value === 'boolean' ? (attr.value ? 'Yes' : 'No')
                : typeof attr.value === 'object' ? JSON.stringify(attr.value)
                : String(attr.value);
              const isSelected = selectedKeys.has(attr.key);
              return (
                <div key={attr.key} className={cn('bg-gradient-to-br from-slate-50 to-white rounded-lg border p-3 relative group', isSelected ? 'border-red-300 bg-red-50/30' : 'border-slate-200')}>
                  {isAdmin && (
                    <div className="absolute top-2 right-2 flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleKey(attr.key)}
                        className="w-3.5 h-3.5 rounded border-slate-300 text-red-600 focus:ring-red-500 cursor-pointer"
                      />
                      <button
                        onClick={() => handleDeleteKeys([attr.key])}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-red-500 transition-all"
                        title={`Delete "${attr.key}"`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>
                  )}
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{attr.key}</p>
                  <p className="text-lg font-bold text-slate-800 mt-0.5">
                    {displayVal}
                    {schema?.unit && <span className="text-xs font-normal text-slate-400 ml-1">{schema.unit}</span>}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">{formatDateTime(attr.lastUpdated)}</p>
                  {!schemaKeys.has(attr.key) && (
                    <Badge variant="outline" className="text-[9px] mt-1">device-reported</Badge>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Schema-Defined Attributes Table */}
      {attrSchema.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="font-semibold text-slate-800 mb-3">Attribute Schema</h4>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Field Name</TableHead>
                <TableHead>Data Type</TableHead>
                <TableHead>Schema Value</TableHead>
                <TableHead>Live Value</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Last Updated</TableHead>
                {isAdmin && <TableHead className="w-10"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {attrSchema.map((attr) => {
                const staticValue = attributes?.[attr.fieldName];
                const live = liveMap[attr.fieldName];
                const constraints = attr.numericConstraints;
                let displayValue: string;

                if (staticValue === undefined || staticValue === null || staticValue === '') {
                  displayValue = '-';
                } else if (attr.dataType === 'BOOLEAN') {
                  displayValue = staticValue ? 'Yes' : 'No';
                } else if (attr.dataType === 'FLOAT' && typeof staticValue === 'number') {
                  const precision = constraints?.resolution
                    ? Math.max(0, -Math.floor(Math.log10(constraints.resolution)))
                    : 2;
                  displayValue = staticValue.toFixed(precision);
                } else {
                  displayValue = String(staticValue);
                }

                const liveDisplay = live
                  ? (live.value === null || live.value === undefined ? '-'
                    : typeof live.value === 'boolean' ? (live.value ? 'Yes' : 'No')
                    : String(live.value))
                  : '-';

                return (
                  <TableRow key={attr.fieldName}>
                    <TableCell className="font-medium">
                      {attr.fieldName}
                      {attr.required && <span className="text-red-500 ml-1">*</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">{attr.dataType}</Badge>
                    </TableCell>
                    <TableCell className="text-slate-800">{displayValue}</TableCell>
                    <TableCell className="text-slate-800 font-medium">
                      {live ? liveDisplay : <span className="text-slate-400">-</span>}
                    </TableCell>
                    <TableCell className="text-slate-500">{attr.unit || '-'}</TableCell>
                    <TableCell className="text-xs text-slate-400">
                      {live ? formatDateTime(live.lastUpdated) : '-'}
                    </TableCell>
                    {isAdmin && (
                      <TableCell>
                        {live && (
                          <button
                            onClick={() => handleDeleteKeys([attr.fieldName])}
                            className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                            title={`Delete "${attr.fieldName}" data`}
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

      {/* Extra Device-Reported Attributes (not in schema) */}
      {extraKeys.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="font-semibold text-slate-800 mb-3">Additional Device-Reported Attributes</h4>
          <p className="text-xs text-slate-500 mb-3">These attributes were reported by the device but are not defined in the template schema.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Value</TableHead>
                <TableHead>Last Updated</TableHead>
                {isAdmin && <TableHead className="w-10"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {extraKeys.map((attr) => (
                <TableRow key={attr.key}>
                  <TableCell className="font-medium font-mono text-sm">{attr.key}</TableCell>
                  <TableCell className="text-slate-800">{attr.value === null ? '-' : typeof attr.value === 'object' ? JSON.stringify(attr.value) : String(attr.value)}</TableCell>
                  <TableCell className="text-xs text-slate-400">{formatDateTime(attr.lastUpdated)}</TableCell>
                  {isAdmin && (
                    <TableCell>
                      <button
                        onClick={() => handleDeleteKeys([attr.key])}
                        className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                        title={`Delete "${attr.key}" data`}
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Attribute History Table */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Attribute History</h4>
        {histLoading ? (
          <div className="text-center py-4"><svg className="w-5 h-5 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : (!historyData?.data || historyData.data.length === 0) ? (
          <p className="text-sm text-slate-500">No attribute history in selected time range.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="font-semibold text-slate-600">Timestamp</TableHead>
                  <TableHead className="font-semibold text-slate-600">Key</TableHead>
                  <TableHead className="font-semibold text-slate-600">Value</TableHead>
                  <TableHead className="font-semibold text-slate-600">Scope</TableHead>
                  <TableHead className="font-semibold text-slate-600">Updated By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {historyData.data.map((row: any, idx: number) => {
                  const val = row.valueJson ?? row.valueBool ?? row.valueNum ?? row.valueStr ?? '-';
                  return (
                    <TableRow key={idx}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDateTime(row.time)}</TableCell>
                      <TableCell className="font-medium text-sm">{row.key}</TableCell>
                      <TableCell className="text-sm">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{row.scope || '-'}</Badge></TableCell>
                      <TableCell className="text-xs text-slate-500">{row.updatedBy || '-'}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <div className="flex items-center justify-between mt-3">
              <p className="text-xs text-slate-500">{historyData.total} total records</p>
              <div className="flex items-center gap-2">
                <button onClick={() => setHistoryPage(p => Math.max(1, p - 1))} disabled={historyPage <= 1} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Prev</button>
                <span className="text-xs text-slate-500">Page {historyPage} of {totalHistoryPages}</span>
                <button onClick={() => setHistoryPage(p => Math.min(totalHistoryPages, p + 1))} disabled={historyPage >= totalHistoryPages} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      {attrSchema.length === 0 && (!liveAttrs || liveAttrs.length === 0) && (
        <div className="text-center py-8">
          <p className="text-sm text-slate-500">No attributes defined for this template and no device-reported attributes received.</p>
        </div>
      )}

      {/* Delete Time Range Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Attribute Data</h3>
            <p className="text-sm text-slate-600 mb-4">This will permanently delete attribute history data within the selected time range for this entity. This action cannot be undone.</p>
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

      {/* Delete Keys Confirmation Dialog */}
      {showKeyDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowKeyDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Attribute{keyDeleteTarget.length > 1 ? 's' : ''}</h3>
            <p className="text-sm text-slate-600 mb-4">
              This will permanently delete <span className="font-semibold">all data</span> for the selected attribute{keyDeleteTarget.length > 1 ? 's' : ''} from this entity. This action cannot be undone.
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
