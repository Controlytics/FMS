import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { formatActionLabel } from '../audit-helpers';

type SortField = 'timestamp' | 'action' | 'userId' | 'userRole';

interface AuditTableProps {
  data: any;
  isLoading: boolean;
  isSuperAdmin: boolean;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  toggleSelectAll: () => void;
  isAllSelected: boolean;
  sortBy: SortField;
  sortOrder: 'asc' | 'desc';
  toggleSort: (field: SortField) => void;
  formatDate: (value: string) => string;
  formatTime: (value: string) => string;
  getAuditSummary: (record: any, templates: Record<string, string>) => string;
  getAuditStatus: (action: string) => 'Success' | 'Fail';
  templates: Record<string, string>;
  ACTION_COLORS: Record<string, string>;
  onViewRecord: (record: any) => void;
  onDeleteRecord: (id: string) => void;
}

export function AuditTable({
  data,
  isLoading,
  isSuperAdmin,
  selectedIds,
  toggleSelect,
  toggleSelectAll,
  isAllSelected,
  sortBy,
  sortOrder,
  toggleSort,
  formatDate,
  formatTime,
  getAuditSummary,
  getAuditStatus,
  templates,
  ACTION_COLORS,
  onViewRecord,
  onDeleteRecord,
}: AuditTableProps) {
  return (
    <Card className="border-slate-200/60 shadow-soft overflow-hidden">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="p-12 text-center">
            <svg className="w-8 h-8 animate-spin mx-auto mb-3 text-indigo-500" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <p className="text-slate-500">Loading audit records...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  {isSuperAdmin && (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        checked={isAllSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                    </TableHead>
                  )}
                  <TableHead>
                    <button onClick={() => toggleSort('timestamp')} className="flex items-center gap-1.5 font-semibold text-slate-600 hover:text-indigo-600 transition-colors group">
                      Timestamp
                      <span className={`transition-colors ${sortBy === 'timestamp' ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                        {sortBy === 'timestamp' ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600">Description</TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort('action')} className="flex items-center gap-1.5 font-semibold text-slate-600 hover:text-indigo-600 transition-colors group">
                      Action
                      <span className={`transition-colors ${sortBy === 'action' ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                        {sortBy === 'action' ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead>
                    <button onClick={() => toggleSort('userId')} className="flex items-center gap-1.5 font-semibold text-slate-600 hover:text-indigo-600 transition-colors group">
                      Performed By
                      <span className={`transition-colors ${sortBy === 'userId' ? 'text-indigo-600' : 'text-slate-300 group-hover:text-slate-400'}`}>
                        {sortBy === 'userId' ? (sortOrder === 'asc' ? '\u2191' : '\u2193') : '\u2195'}
                      </span>
                    </button>
                  </TableHead>
                  <TableHead className="font-semibold text-slate-600">Status</TableHead>
                  {isSuperAdmin && (
                    <TableHead className="font-semibold text-slate-600 text-center">Details</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.data?.map((record: any) => {
                  const status = getAuditStatus(record.action);
                  return (
                  <TableRow key={record.id} className={`hover:bg-slate-50/50 transition-colors ${isSuperAdmin && selectedIds.has(record.id) ? 'bg-red-50/40' : ''}`}>
                    {isSuperAdmin && (
                      <TableCell className="w-10">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelect(record.id)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </TableCell>
                    )}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-slate-100">
                          <svg className="w-3.5 h-3.5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <div>
                          <p className="text-sm font-medium text-slate-800">
                            {formatDate(record.timestamp)}
                          </p>
                          <p className="text-xs text-slate-500">
                            {formatTime(record.timestamp)}
                          </p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const desc = getAuditSummary(record, templates);
                        const isTruncated = desc.length > 70;
                        const shown = isTruncated ? desc.slice(0, 67) + '...' : desc;
                        // Styled hover popup for truncated descriptions.
                        // The native `title` tooltip is OS-themed and slow
                        // (~1s delay on most platforms); the custom popup
                        // fires immediately and uses the app's color scheme.
                        return (
                          <span className="relative inline-block group">
                            <span className="text-sm text-slate-700 cursor-default">
                              {shown}
                            </span>
                            {isTruncated && (
                              <span
                                className="pointer-events-none absolute left-0 bottom-full mb-2 z-50 hidden group-hover:block w-[28rem] max-w-[36rem] bg-white text-slate-800 text-xs leading-snug rounded-lg border border-slate-200 shadow-xl px-3 py-2 whitespace-normal break-words"
                                role="tooltip"
                              >
                                {desc}
                              </span>
                            )}
                          </span>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium border ${ACTION_COLORS[record.action] || 'bg-slate-100 text-slate-700 border-slate-200'}`}
                        title={record.action}
                      >
                        {formatActionLabel(record.action, record.afterValue, record.beforeValue)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-slate-200 to-slate-300 flex items-center justify-center text-xs font-bold text-slate-600">
                          {record.userId?.charAt(0)?.toUpperCase() || '?'}
                        </div>
                        <span className="text-sm font-medium text-slate-700">{record.userId}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {status === 'Success' ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700 border border-green-200">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Success
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700 border border-red-200">
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                          Fail
                        </span>
                      )}
                    </TableCell>
                    {isSuperAdmin && (
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onViewRecord(record)}
                            className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => onDeleteRecord(record.id)}
                            className="text-red-500 hover:text-red-700 hover:bg-red-50"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                  );
                })}
                {(!data?.data || data.data.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={isSuperAdmin ? 8 : 5} className="text-center py-12">
                      <div className="p-4 rounded-2xl bg-slate-100 inline-block mb-4">
                        <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <p className="text-slate-600 font-medium">No audit records found</p>
                      <p className="text-sm text-slate-400 mt-1">Try adjusting your filters</p>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
