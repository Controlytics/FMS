import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/hooks/use-auth';
import { diffAuditValues, maskAuditValue, prettyFieldName, isRedacted, redactionDetail } from '../audit-helpers';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidLike(value: unknown): boolean {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

/** Strip keys whose value is a UUID (id, userId, *Id) so the detail view shows only human-readable fields. */
function pruneUuids(obj: Record<string, unknown> | null | undefined): Array<[string, unknown]> {
  if (!obj || typeof obj !== 'object') return [];
  return Object.entries(obj).filter(([key, value]) => {
    if (isUuidLike(value)) return false;
    if (/(^|[^a-z])id$/i.test(key) && typeof value === 'string') return false;
    return true;
  });
}

/**
 * One side of a change. `maskAuditValue` renders '' as an empty string, which on
 * its own reads as a rendering failure rather than as a cleared field — so say so.
 */
function ChangeValue({ text, tone }: { text: string; tone: 'from' | 'to' }) {
  if (text === '') return <span className="text-slate-400 italic">(empty)</span>;
  return tone === 'from'
    ? <span className="text-red-600 line-through break-all">{text}</span>
    : <span className="text-green-700 font-medium break-all">{text}</span>;
}

interface AuditDetailModalProps {
  selectedRecord: any;
  onClose: () => void;
  formatDateTime: (value: string) => string;
  getAuditSummary: (record: any, templates: Record<string, string>) => string;
  getAuditStatus: (action: string) => 'Success' | 'Fail';
  templates: Record<string, string>;
  ACTION_COLORS: Record<string, string>;
  ROLE_COLORS: Record<string, string>;
}

/**
 * Audit record detail.
 *
 * 2026-09-03 (operator request): THE CHANGE IS THE DIALOG. It used to open on
 * three grids of row metadata — record id, timestamp, performer, action, status,
 * role, IP, target type, checksum — and the operator had to scroll past all of
 * it to reach the one thing they clicked in to see.
 *
 * What everyone sees: the summary line (what happened + when + outcome), the
 * redaction banner when one applies, the reason, and the old → new change list.
 *
 * What only SUPER_ADMIN sees: "Full record (previous / new)" and "Record
 * details" (record id, performer, action, status, role, IP, target type and the
 * SHA-256 checksum). This modal is the ONLY surface in the app that renders a
 * row's checksum, so it is kept for the one role that verifies chain integrity.
 *
 * ⚠️ This is DECLUTTERING, NOT a security boundary. `GET /api/audit/:id` still
 * returns the whole row to any AUDIT_READ caller, and that endpoint's own
 * row-scoping (lib/audit-visibility.ts) is what actually governs which records a
 * non-SUPER_ADMIN may fetch. Do not move a genuine access rule in here.
 */
export function AuditDetailModal({
  selectedRecord,
  onClose,
  formatDateTime,
  getAuditSummary,
  getAuditStatus,
  templates,
  ACTION_COLORS,
  ROLE_COLORS,
}: AuditDetailModalProps) {
  // Read here rather than as a prop: the rule belongs with the markup it gates,
  // and useAuth is SWR-backed so the parent's own call is deduped, not repeated.
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

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
        const changes = diffAuditValues(selectedRecord.beforeValue, selectedRecord.afterValue);
        const beforeEntries = pruneUuids(selectedRecord.beforeValue);
        const afterEntries = pruneUuids(selectedRecord.afterValue);
        const hasFullRecord = beforeEntries.length > 0 || afterEntries.length > 0;
        return (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto">
          {/* What happened, and when. */}
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

          {/* Redaction banner. Sits directly under the summary because that summary
              is built from a NULLed before/after and would otherwise read as a
              complete record. Chain-preserving redaction only satisfies §11 if the
              mask, the redactor and the reason are all visible to an inspector. */}
          {isRedacted(selectedRecord) && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                </svg>
                <div className="text-sm text-amber-800 min-w-0">
                  <p className="font-semibold">This record's payload was redacted</p>
                  <p className="mt-1">
                    The before/after values were permanently masked. The record itself, its
                    checksum and its hash-chain link are intact — only the payload was removed.
                  </p>
                  <dl className="mt-2 space-y-0.5">
                    <div className="flex gap-2">
                      <dt className="font-medium shrink-0">Redacted by:</dt>
                      <dd className="break-words">{redactionDetail(selectedRecord).by}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="font-medium shrink-0">Redacted at:</dt>
                      <dd>{formatDateTime(selectedRecord.redactedAt)}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="font-medium shrink-0">Reason:</dt>
                      <dd className="break-words">{redactionDetail(selectedRecord).reason}</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </div>
          )}

          {/* ── The change: old value → new value, and nothing else ─────────── */}
          <div className="rounded-xl border border-indigo-100 overflow-hidden">
            <div className="px-4 py-2 bg-indigo-50 border-b border-indigo-100">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wider">
                Changes{changes.length > 0 && <span className="font-normal text-indigo-400"> ({changes.length})</span>}
              </p>
            </div>
            <div className="p-4 bg-white" data-testid="audit-changes">
              {changes.length > 0 ? (
                <div className="space-y-2">
                  {changes.map((c) => (
                    <div key={c.field} className="flex items-start gap-3 py-1.5 border-b border-slate-50 last:border-0">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-[120px] pt-0.5">{c.field}</span>
                      <span className="text-sm flex items-center gap-2 flex-wrap">
                        <ChangeValue text={c.from} tone="from" />
                        <span className="text-slate-400">→</span>
                        <ChangeValue text={c.to} tone="to" />
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                // Honest empty state. A create, a delete, a login or an export has
                // no old-value/new-value pair to show; a blank panel would read as
                // data that failed to load. Only point at the full record when the
                // reader can actually see it — it is SUPER_ADMIN-only below.
                <p className="text-sm text-slate-400">
                  {hasFullRecord
                    ? (isSuperAdmin
                        ? 'No field changed value — see the full record below.'
                        : 'No field changed value in this record.')
                    : 'This action records no field-level values.'}
                </p>
              )}
            </div>
          </div>

          {/* Reason — the operator's justification is part of what happened. */}
          {selectedRecord.reason && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-100">
              <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Reason</p>
              <p className="text-sm text-amber-800">{selectedRecord.reason}</p>
            </div>
          )}

          {/* Replacement panel — FILTER_REPLACED only.
              The generic before/after panel runs every value through pruneUuids(),
              which strips both filter ids (they are UUID-valued AND their keys end
              in "Id"). That pruning is right for the rest of the audit surface —
              raw UUIDs everywhere is noise — so rather than loosening it globally,
              the replacement pair gets its own panel. This is the one place an
              inspector can follow the chain from a retired filter to its successor. */}
          {selectedRecord.action === 'FILTER_REPLACED' && (() => {
            const av = (selectedRecord.afterValue ?? {}) as Record<string, unknown>;
            const oldName = (av.oldFilterName as string) || '';
            const newName = (av.newFilterName as string) || '';
            const oldId = (av.oldFilterId as string) || selectedRecord.targetId || '';
            const newId = (av.newFilterId as string) || '';
            if (!oldId && !newId) return null;
            const Side = ({ heading, name, id, tone }: { heading: string; name: string; id: string; tone: 'rose' | 'emerald' }) => (
              <div className={`p-3 rounded-xl border ${tone === 'rose' ? 'bg-rose-50 border-rose-200' : 'bg-emerald-50 border-emerald-200'}`}>
                <p className={`text-xs font-semibold uppercase tracking-wider ${tone === 'rose' ? 'text-rose-700' : 'text-emerald-700'}`}>{heading}</p>
                <p className="text-sm font-semibold text-slate-800 mt-1 break-words">{name || '—'}</p>
                <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wider mt-2">Filter ID</p>
                <code className="text-[11px] font-mono text-slate-600 break-all">{id || '—'}</code>
              </div>
            );
            return (
              <div className="rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-2 bg-slate-50 border-b border-slate-200">
                  <p className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Replacement</p>
                </div>
                <div className="p-4 bg-white grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Side heading="Replaced (old)" name={oldName} id={oldId} tone="rose" />
                  <Side heading="Replacement (new)" name={newName} id={newId} tone="emerald" />
                </div>
                {typeof av.identifiersMoved === 'number' && (
                  <div className="px-4 py-2 bg-slate-50 border-t border-slate-200">
                    <p className="text-xs text-slate-500">
                      RFID identifiers moved to the new filter:{' '}
                      <span className="font-semibold text-slate-700">{String(av.identifiersMoved)}</span>
                    </p>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Full previous / new record — SUPER_ADMIN only (2026-09-03).
              Collapsed when there IS a change list to read; open when there
              isn't, because for a create, a delete or a one-sided payload this
              panel is the only place the values appear at all, and a collapsed
              panel would look like the record was empty. */}
          {isSuperAdmin && hasFullRecord && (
            <details className="rounded-xl border border-slate-200 overflow-hidden" open={changes.length === 0}>
              <summary className="px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer select-none">
                Full record (previous / new)
              </summary>
              <div className="p-4 bg-white grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-semibold text-red-700 uppercase tracking-wider mb-2">Previous Value</p>
                  {beforeEntries.length === 0 ? <p className="text-sm text-slate-400">—</p> : beforeEntries.map(([key, value]) => (
                    <div key={key} className="py-1 text-sm">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2">{prettyFieldName(key)}</span>
                      <span className="text-slate-800 break-all">{maskAuditValue(key, value)}</span>
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-xs font-semibold text-green-700 uppercase tracking-wider mb-2">New Value</p>
                  {afterEntries.length === 0 ? <p className="text-sm text-slate-400">—</p> : afterEntries.map(([key, value]) => (
                    <div key={key} className="py-1 text-sm">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mr-2">{prettyFieldName(key)}</span>
                      <span className="text-slate-800 break-all">{maskAuditValue(key, value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </details>
          )}

          {/* Record details — SUPER_ADMIN only (2026-09-03), collapsed.
              Everything that identifies the ROW rather than the change: id,
              timestamp, performer, action, status, role, IP, target type and the
              integrity checksum. The checksum is the reason this block survives
              at all: no other screen in the app renders one, and verifying the
              hash chain is a SUPER_ADMIN job.
              Not a security boundary — see the note on the component above. */}
          {isSuperAdmin && (
          <details className="rounded-xl border border-slate-200 overflow-hidden">
            <summary className="px-4 py-2 bg-slate-50 text-xs font-semibold text-slate-600 uppercase tracking-wider cursor-pointer select-none">
              Record details
            </summary>
            <div className="p-4 bg-white space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-3 rounded-xl bg-slate-50">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Record ID</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1 break-all">#{selectedRecord.id}</p>
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
                <div className="p-3 rounded-xl bg-slate-50">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">User Role</p>
                  <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold mt-1 ${ROLE_COLORS[selectedRecord.userRole] || 'bg-slate-100 text-slate-700'}`}>
                    {selectedRecord.userRole}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-slate-50">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">IP Address</p>
                  <p className="text-sm font-mono text-slate-800 mt-1">{selectedRecord.ipAddress || '-'}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-50">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Target Type</p>
                  <p className="text-sm font-semibold text-slate-800 mt-1">{selectedRecord.targetType || '-'}</p>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <p className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Integrity Checksum (SHA-256)</p>
                </div>
                <code className="text-xs font-mono text-slate-600 break-all">{selectedRecord.checksum}</code>
              </div>
            </div>
          </details>
          )}
        </div>
        );
      })()}
    </Dialog>
  );
}
