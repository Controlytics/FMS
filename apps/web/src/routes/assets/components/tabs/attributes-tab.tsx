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
  const { data: liveAttrs, isLoading } = useSWR<Array<{ key: string; value: any; updatedBy?: string; lastUpdated: string }>>(
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

      {/* Live Device-Reported Attributes */}
      {liveAttrs && liveAttrs.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <h4 className="font-semibold text-slate-800">Device-Reported Attributes</h4>
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
              return (
                <div key={attr.key} className="bg-gradient-to-br from-slate-50 to-white rounded-lg border border-slate-200 p-3">
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {extraKeys.map((attr) => (
                <TableRow key={attr.key}>
                  <TableCell className="font-medium font-mono text-sm">{attr.key}</TableCell>
                  <TableCell className="text-slate-800">{attr.value === null ? '-' : typeof attr.value === 'object' ? JSON.stringify(attr.value) : String(attr.value)}</TableCell>
                  <TableCell className="text-xs text-slate-400">{formatDateTime(attr.lastUpdated)}</TableCell>
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

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Attribute Data</h3>
            <p className="text-sm text-slate-600 mb-4">This will permanently delete attribute history data within the selected time range for this entity. This action cannot be undone.</p>
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
