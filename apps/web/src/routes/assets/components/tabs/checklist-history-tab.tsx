import React, { useMemo, useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { cn } from '@/lib/cn';

export function ChecklistHistoryTab({ entityId, formatDateTime, userRole, checklistSchema }: { entityId: string; formatDateTime: (v: string | Date) => string; userRole?: string; checklistSchema?: any }) {
  const [timePreset, setTimePreset] = useState('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [historyPage, setHistoryPage] = useState(1);
  const HPAGE_SIZE = 25;
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const questionMap = useMemo(() => {
    const map: Record<string, string> = {};
    const questions = Array.isArray(checklistSchema) ? checklistSchema : checklistSchema?.questions ?? [];
    questions.forEach((q: any, idx: number) => {
      const id = q.id || `q_${idx}`;
      map[id] = q.question || q.label || `Question ${idx + 1}`;
    });
    return map;
  }, [checklistSchema]);

  const timeRange = useMemo(() => {
    if (timePreset === 'custom') {
      return {
        from: customFrom || new Date(Date.now() - 86400000).toISOString(),
        to: customTo || new Date().toISOString(),
      };
    }
    const now = new Date();
    const ms: Record<string, number> = {
      '1h': 3600000,
      '6h': 21600000,
      '24h': 86400000,
      '7d': 604800000,
      '30d': 2592000000,
    };
    return {
      from: new Date(now.getTime() - (ms[timePreset] || 604800000)).toISOString(),
      to: now.toISOString(),
    };
  }, [timePreset, customFrom, customTo]);

  const { data: historyData, isLoading, mutate } = useSWR<{ data: any[]; meta: any }>(
    `/api/checklist/${entityId}/history?from=${encodeURIComponent(timeRange.from)}&to=${encodeURIComponent(timeRange.to)}`,
    { refreshInterval: 30000 }
  );

  const historyRows = historyData?.data ?? [];
  const totalPages = Math.max(1, Math.ceil(historyRows.length / HPAGE_SIZE));
  const pagedRows = historyRows.slice(
    (historyPage - 1) * HPAGE_SIZE,
    historyPage * HPAGE_SIZE
  );

  const stepColors: Record<string, string> = {
    SUBMITTED: 'bg-blue-100 text-blue-700',
    CHECKED: 'bg-amber-100 text-amber-700',
    VERIFIED: 'bg-emerald-100 text-emerald-700',
    APPROVED: 'bg-emerald-100 text-emerald-700',
    REJECTED: 'bg-red-100 text-red-700',
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await apiClient.post('/api/retention/execute-range', {
        dataType: 'checklists',
        from: timeRange.from,
        to: timeRange.to,
        entityId,
        confirmed: true,
      });
      mutate();
      setShowDeleteDialog(false);
    } catch (e: any) {
      alert(e.message || 'Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-800">Checklist Submissions</h3>
        {(userRole === 'SUPER_ADMIN' || userRole === 'ADMIN') && historyRows.length > 0 && (
          <button
            onClick={() => setShowDeleteDialog(true)}
            className="px-3 py-1.5 text-xs font-medium text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
          >
            Delete Data
          </button>
        )}
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center gap-2 flex-wrap">
        {['1h', '6h', '24h', '7d', '30d', 'custom'].map((p) => (
          <button
            key={p}
            onClick={() => { setTimePreset(p); setHistoryPage(1); }}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              timePreset === p
                ? 'bg-cyan-100 text-cyan-700'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            )}
          >
            {p === 'custom' ? 'Custom' : `Last ${p}`}
          </button>
        ))}
        {timePreset === 'custom' && (
          <div className="flex items-center gap-2 ml-2">
            <input
              type="datetime-local"
              value={customFrom ? customFrom.slice(0, 16) : ''}
              onChange={(e) => {
                setCustomFrom(new Date(e.target.value).toISOString());
                setHistoryPage(1);
              }}
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg"
            />
            <span className="text-xs text-slate-400">to</span>
            <input
              type="datetime-local"
              value={customTo ? customTo.slice(0, 16) : ''}
              onChange={(e) => {
                setCustomTo(new Date(e.target.value).toISOString());
                setHistoryPage(1);
              }}
              className="px-2 py-1 text-xs border border-slate-300 rounded-lg"
            />
          </div>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <svg className="w-5 h-5 animate-spin text-slate-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="ml-2 text-sm text-slate-500">Loading history...</span>
        </div>
      ) : pagedRows.length === 0 ? (
        <p className="text-sm text-slate-500 text-center py-6">
          No checklist submissions in selected time range.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead className="font-semibold text-slate-600">Timestamp</TableHead>
                  <TableHead className="font-semibold text-slate-600">Submitted By</TableHead>
                  <TableHead className="font-semibold text-slate-600">Status</TableHead>
                  <TableHead className="font-semibold text-slate-600">Answers</TableHead>
                  <TableHead className="font-semibold text-slate-600">ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagedRows.map((row: any) => (
                  <React.Fragment key={row.checklistId}>
                    <TableRow
                      className="cursor-pointer hover:bg-slate-50"
                      onClick={() => setExpandedRow(expandedRow === row.checklistId ? null : row.checklistId)}
                    >
                      <TableCell className="text-xs whitespace-nowrap">
                        {formatDateTime(row.time)}
                      </TableCell>
                      <TableCell className="text-sm font-medium">{row.submittedBy}</TableCell>
                      <TableCell>
                        <span className={cn(
                          'px-2 py-0.5 rounded-full text-xs font-medium',
                          stepColors[row.currentStep] ?? 'bg-slate-100 text-slate-700'
                        )}>
                          {row.currentStep}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-slate-500">
                        {row.answersCount} items
                      </TableCell>
                      <TableCell className="text-xs text-slate-400 font-mono">
                        {(row.checklistId || '').substring(0, 8)}
                      </TableCell>
                    </TableRow>
                    {expandedRow === row.checklistId && row.answers && (
                      <TableRow key={`${row.checklistId}-detail`}>
                        <TableCell colSpan={5} className="bg-slate-50 p-3">
                          <div className="space-y-2">
                            {Object.entries(row.answers).map(([key, val]: [string, any]) => (
                              <div key={key} className="flex items-start gap-2 text-xs">
                                <span className="font-medium text-slate-600 shrink-0 max-w-[60%]">{questionMap[key] || key}:</span>
                                <span className="text-slate-800">
                                  {typeof val === 'string' && val.startsWith('data:image/')
                                    ? <img src={val} className="w-20 h-20 object-cover rounded border border-slate-200" alt="Photo" />
                                    : typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">
              {historyData?.meta?.totalPoints ?? historyRows.length} total submissions
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                disabled={historyPage <= 1}
                className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40"
              >
                Prev
              </button>
              <span className="text-xs text-slate-500">
                Page {historyPage} of {totalPages}
              </span>
              <button
                onClick={() => setHistoryPage((p) => Math.min(totalPages, p + 1))}
                disabled={historyPage >= totalPages}
                className="px-3 py-1 text-xs bg-slate-100 rounded hover:bg-slate-200 disabled:opacity-40"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}

      {/* Delete Confirmation Dialog */}
      {showDeleteDialog && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowDeleteDialog(false)}
        >
          <div
            className="bg-white rounded-xl p-6 w-96 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-slate-800 mb-2">Delete Checklist Data</h3>
            <p className="text-sm text-slate-600 mb-4">
              This will permanently delete checklist submissions and their review
              records within the selected time range. This action cannot be undone.
            </p>
            <div className="space-y-2 mb-4 bg-slate-50 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 font-medium w-12">From:</span>
                <span className="text-slate-700 font-mono text-xs">
                  {formatDateTime(timeRange.from)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-slate-500 font-medium w-12">To:</span>
                <span className="text-slate-700 font-mono text-xs">
                  {formatDateTime(timeRange.to)}
                </span>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteDialog(false)}
                className="px-4 py-2 text-sm rounded-lg bg-slate-100 hover:bg-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
