import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface AuditDetailModalProps {
  selectedRecord: any;
  onClose: () => void;
  isSuperAdmin: boolean;
  formatDateTime: (value: string) => string;
  getAuditSummary: (record: any, templates: Record<string, string>) => string;
  getAuditStatus: (action: string) => 'Success' | 'Fail';
  templates: Record<string, string>;
  ACTION_COLORS: Record<string, string>;
  ROLE_COLORS: Record<string, string>;
}

export function AuditDetailModal({
  selectedRecord,
  onClose,
  isSuperAdmin,
  formatDateTime,
  getAuditSummary,
  getAuditStatus,
  templates,
  ACTION_COLORS,
  ROLE_COLORS,
}: AuditDetailModalProps) {
  return (
    <Dialog open={!!selectedRecord} onClose={onClose} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-100 text-indigo-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          Audit Record Detail
        </DialogTitle>
      </DialogHeader>
      {selectedRecord && (() => {
        const detailStatus = getAuditStatus(selectedRecord.action);
        return (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Action Summary */}
          <div className="p-4 rounded-xl bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100">
            <p className="text-sm font-semibold text-indigo-900">
              {getAuditSummary(selectedRecord, templates)}
            </p>
            <div className="flex items-center gap-3 mt-2">
              <p className="text-xs text-indigo-500">
                {formatDateTime(selectedRecord.timestamp)}
              </p>
              {detailStatus === 'Success' ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-green-100 text-green-700 border border-green-200">
                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
                  Success
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700 border border-red-200">
                  <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
                  Fail
                </span>
              )}
            </div>
          </div>

          {/* Common Info Grid — All users see this */}
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Record ID</p>
              <p className="text-sm font-semibold text-slate-800 mt-1">#{selectedRecord.id}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Timestamp</p>
              <p className="text-sm font-semibold text-slate-800 mt-1">
                {formatDateTime(selectedRecord.timestamp)}
              </p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Performed By</p>
              <p className="text-sm font-semibold text-slate-800 mt-1">{selectedRecord.userId}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Action</p>
              <span className={`inline-flex px-2.5 py-1 rounded-lg text-xs font-medium border mt-1 ${ACTION_COLORS[selectedRecord.action] || 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                {selectedRecord.action}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Status</p>
              <div className="mt-1">
                {detailStatus === 'Success' ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-700">Success</span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-700">Fail</span>
                )}
              </div>
            </div>
            {isSuperAdmin && (
              <div className="p-3 rounded-xl bg-slate-50">
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">User Role</p>
                <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold mt-1 ${ROLE_COLORS[selectedRecord.userRole] || 'bg-slate-100 text-slate-700'}`}>
                  {selectedRecord.userRole}
                </span>
              </div>
            )}
          </div>

          {/* SUPER_ADMIN extra details */}
          {isSuperAdmin && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-xl bg-slate-50">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">IP Address</p>
                  <p className="text-sm font-mono text-slate-800 mt-1">{selectedRecord.ipAddress || '-'}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Target Type</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{selectedRecord.targetType || '-'}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 col-span-2">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Target ID</p>
                  <p className="text-sm font-mono text-slate-800 mt-1 break-all">{selectedRecord.targetId || '-'}</p>
                </div>
              </div>

              {/* Before/After Values */}
              {selectedRecord.beforeValue && (
                <div className="rounded-xl border border-red-100 overflow-hidden">
                  <div className="px-4 py-2 bg-red-50 border-b border-red-100">
                    <p className="text-xs font-semibold text-red-700 uppercase tracking-wider">Previous Value</p>
                  </div>
                  <div className="p-4 bg-white space-y-2">
                    {Object.entries(selectedRecord.beforeValue).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-3 py-1.5 border-b border-slate-50 last:border-0">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[120px] pt-0.5">
                          {key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim()}
                        </span>
                        <span className="text-sm text-slate-800 break-all">
                          {value === null || value === undefined ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selectedRecord.afterValue && (
                <div className="rounded-xl border border-green-100 overflow-hidden">
                  <div className="px-4 py-2 bg-green-50 border-b border-green-100">
                    <p className="text-xs font-semibold text-green-700 uppercase tracking-wider">New Value</p>
                  </div>
                  <div className="p-4 bg-white space-y-2">
                    {Object.entries(selectedRecord.afterValue).map(([key, value]) => (
                      <div key={key} className="flex items-start gap-3 py-1.5 border-b border-slate-50 last:border-0">
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[120px] pt-0.5">
                          {key.replace(/([A-Z])/g, ' $1').replace(/[_-]/g, ' ').trim()}
                        </span>
                        <span className="text-sm text-slate-800 break-all">
                          {value === null || value === undefined ? '-' : typeof value === 'object' ? JSON.stringify(value) : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Checksum */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Integrity Checksum (SHA-256)</p>
                </div>
                <code className="text-xs font-mono text-slate-600 break-all">{selectedRecord.checksum}</code>
              </div>
            </>
          )}

          {/* Reason — visible to all */}
          {selectedRecord.reason && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Reason</p>
              <p className="text-sm text-amber-800">{selectedRecord.reason}</p>
            </div>
          )}
        </div>
        );
      })()}
    </Dialog>
  );
}
