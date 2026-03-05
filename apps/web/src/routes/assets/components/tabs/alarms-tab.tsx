import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';
import { useAuth } from '@/hooks/use-auth';
import { ALL_ALARM_COLUMN_IDS } from '@digilog/shared';

export function AlarmsTab({ entityId, formatDateTime }: { entityId: string; formatDateTime: (v: string | Date) => string }) {
  const { user } = useAuth();

  // Alarm column visibility per role
  const { data: colConfig } = useSWR<{ columns: string[] }>('/api/config/alarm-columns/current', {
    dedupingInterval: 30000,
    revalidateOnFocus: false,
  });
  const visibleCols = useMemo(() => new Set(colConfig?.columns ?? ALL_ALARM_COLUMN_IDS), [colConfig]);

  const [statusFilter, setStatusFilter] = useState('');

  // Time range state
  const [timePreset, setTimePreset] = useState('');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [alarmPage, setAlarmPage] = useState(1);

  // Delete state
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Calculate from/to (empty = all time)
  const timeRange = useMemo(() => {
    if (!timePreset || timePreset === 'all') return { from: '', to: '' };
    if (timePreset === 'custom') {
      return { from: customFrom || '', to: customTo || '' };
    }
    const now = new Date();
    const ms: Record<string, number> = { '1h': 3600000, '6h': 21600000, '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
    return { from: new Date(now.getTime() - (ms[timePreset] || 86400000)).toISOString(), to: now.toISOString() };
  }, [timePreset, customFrom, customTo]);

  const params = new URLSearchParams({ entityId, page: String(alarmPage), pageSize: '20' });
  if (statusFilter) params.set('status', statusFilter);
  if (timeRange.from) params.set('from', timeRange.from);
  if (timeRange.to) params.set('to', timeRange.to);

  const { data, isLoading, mutate: mutateAlarms } = useSWR<{ data: any[]; total: number; totalPages?: number }>(`/api/alarms?${params}`);
  const alarms = data?.data ?? [];
  const totalPages = data?.totalPages ?? Math.max(1, Math.ceil((data?.total ?? 0) / 20));

  const severityColors: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-700 border-red-200',
    MAJOR: 'bg-orange-100 text-orange-700 border-orange-200',
    MINOR: 'bg-amber-100 text-amber-700 border-amber-200',
    WARNING: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    INFO: 'bg-blue-100 text-blue-700 border-blue-200',
  };
  const statusBadgeColors: Record<string, string> = {
    ACTIVE: 'bg-red-100 text-red-700',
    ACKNOWLEDGED: 'bg-amber-100 text-amber-700',
    CLEARED: 'bg-emerald-100 text-emerald-700',
    MANUALLY_CLEARED: 'bg-blue-100 text-blue-700',
  };
  const statusLabels: Record<string, string> = {
    ACTIVE: 'Active',
    ACKNOWLEDGED: 'Acknowledged',
    CLEARED: 'Cleared',
    MANUALLY_CLEARED: 'Manually Cleared',
  };

  const handleDeleteAlarms = async () => {
    if (!timeRange.from || !timeRange.to) {
      alert('Please select a time range first (not All Time).');
      return;
    }
    setDeleting(true);
    try {
      await apiClient.post('/api/retention/execute-range', { dataType: 'alarms', from: timeRange.from, to: timeRange.to, entityId, confirmed: true });
      mutateAlarms();
      setShowDeleteDialog(false);
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  if (isLoading) return <div className="text-center py-8"><svg className="w-6 h-6 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>;

  return (
    <div>
      {/* Controls Row */}
      <div className="flex items-center justify-between mb-4">
        <div />
        {(user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN') && timeRange.from && timeRange.to && (
          <button onClick={() => setShowDeleteDialog(true)} className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors">
            Delete Data
          </button>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        {['all', '1h', '6h', '24h', '7d', '30d', 'custom'].map(p => (
          <button key={p} onClick={() => { setTimePreset(p); setAlarmPage(1); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', (timePreset || 'all') === p ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {p === 'all' ? 'All Time' : p === 'custom' ? 'Custom' : `Last ${p}`}
          </button>
        ))}
        {timePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input type="datetime-local" value={customFrom ? customFrom.slice(0, 16) : ''} onChange={e => { setCustomFrom(new Date(e.target.value).toISOString()); setAlarmPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
            <span className="text-xs text-slate-400">to</span>
            <input type="datetime-local" value={customTo ? customTo.slice(0, 16) : ''} onChange={e => { setCustomTo(new Date(e.target.value).toISOString()); setAlarmPage(1); }} className="px-2 py-1 text-xs border border-slate-300 rounded-lg" />
          </div>
        )}
      </div>

      {/* Status Filter */}
      <div className="flex items-center gap-2 mb-4">
        {['', 'ACTIVE', 'ACKNOWLEDGED', 'CLEARED', 'MANUALLY_CLEARED'].map(s => (
          <button key={s} onClick={() => { setStatusFilter(s); setAlarmPage(1); }} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', statusFilter === s ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
            {s ? (statusLabels[s] ?? s) : 'All'}
          </button>
        ))}
      </div>

      {alarms.length === 0 ? (
        <div className="text-center py-8"><p className="text-sm text-slate-500">No alarms found for this entity.</p></div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {visibleCols.has('severity') && <TableHead>Severity</TableHead>}
              {visibleCols.has('alarmType') && <TableHead>Type</TableHead>}
              {visibleCols.has('status') && <TableHead>Status</TableHead>}
              {visibleCols.has('generatedAt') && <TableHead>Created</TableHead>}
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alarms.map((alarm: any) => (
              <TableRow key={alarm.id}>
                {visibleCols.has('severity') && <TableCell><Badge className={cn('text-xs border', severityColors[alarm.severity] ?? '')}>{alarm.severity}</Badge></TableCell>}
                {visibleCols.has('alarmType') && <TableCell className="text-sm font-medium">{alarm.alarmType}</TableCell>}
                {visibleCols.has('status') && <TableCell><Badge className={cn('text-xs', statusBadgeColors[alarm.status] ?? '')}>{statusLabels[alarm.status] ?? alarm.status}</Badge></TableCell>}
                {visibleCols.has('generatedAt') && <TableCell className="text-sm whitespace-nowrap">{formatDateTime(alarm.createdAt)}</TableCell>}
                <TableCell className="text-xs text-slate-500 max-w-xs truncate">{alarm.triggerDetails ? JSON.stringify(alarm.triggerDetails).substring(0, 80) : '-'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {data && data.total > 0 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-slate-500">Showing {alarms.length} of {data.total} alarms</p>
          <div className="flex items-center gap-2">
            <button onClick={() => setAlarmPage(p => Math.max(1, p - 1))} disabled={alarmPage <= 1} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Prev</button>
            <span className="text-xs text-slate-500">Page {alarmPage} of {totalPages}</span>
            <button onClick={() => setAlarmPage(p => Math.min(totalPages, p + 1))} disabled={alarmPage >= totalPages} className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowDeleteDialog(false)}>
          <div className="bg-white rounded-xl p-6 w-96 shadow-xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Alarm Data</h3>
            <p className="text-sm text-slate-600 mb-4">This will permanently delete alarms within the selected time range for this entity. This action cannot be undone.</p>
            <div className="space-y-2 mb-4 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">From:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.from).toLocaleString()}</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="text-slate-500 font-medium w-12">To:</span><span className="text-slate-700 font-mono text-xs">{new Date(timeRange.to).toLocaleString()}</span></div>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowDeleteDialog(false)} className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200">Cancel</button>
              <button onClick={handleDeleteAlarms} disabled={deleting} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">{deleting ? 'Deleting...' : 'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
