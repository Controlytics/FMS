import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useCan } from '@/hooks/use-can';
import { ALL_ROWS } from '@/lib/page-size';
import { SuperAdminRecordEditDialog, SuperAdminEditButton, useIsSuperAdmin, userOptions, type EditFieldSpec } from '@/components/super-admin-record-edit';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { createReport } from '../../lib/pdf-report';
import { exportToExcel } from '@/lib/excel-export';
import { ExportMenu } from '@/components/ExportMenu';
import { SendForReviewButton } from '@/components/SendForReviewButton';
import { api } from '../../lib/api-client';
import { ReportPageWrapper } from '@/components/report-page-wrapper';
import { useReportLabels } from '../../hooks/use-report-labels';
import { requireExportReauth, isReauthCancelled } from '@/lib/report-export-log';
import { useExportLimit } from '@/hooks/use-export-limit';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthPrompt } from '@/components/reauth-prompt';
import { DateRangeFilter } from '@/components/ui/date-range-filter';
import { downloadName } from '@/lib/download-name';

const RFID_COLS = ['sNo', 'dateTime', 'event', 'rfid', 'filter', 'ahu', 'user', 'reason'];

type TrackRow = {
  /** audit_trail row id - what the SUPER_ADMIN edit addresses. */
  id: string;
  timestamp: string;
  event: 'ASSIGN' | 'REMOVE';
  rfidNumber: string;
  filterId: string | null;
  filterName: string | null;
  ahuId: string | null;
  ahuName: string | null;
  userId: string | null;
  user: string | null;
  reason: string | null;
};
type Resp = { data: TrackRow[]; total: number; page: number; limit: number; totalPages: number };

const PER_PAGE = 50;

export function RfidTrackRecordPage() {
  const can = useCan();
  const { toast } = useToast();

  // Report exports are re-auth gated per report (Config → Action Re-auth → Reports), 2026-09-24.

  const reauth = useReauth();
  const exportLimit = useExportLimit();
  const { formatDateTime } = useDatetimeFormat();
  const { labelsFor } = useReportLabels();
  const L = labelsFor('rfid-track-record');
  const headLabels = RFID_COLS.map((k) => L.columns[k]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rfid, setRfid] = useState('');
  const [filterName, setFilterName] = useState('');
  const [ahu, setAhu] = useState('');
  const [userQ, setUserQ] = useState('');
  const [page, setPage] = useState(1);
  const [downloading, setDownloading] = useState(false);

  const buildQs = (limit: number, pg: number) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', `${to}T23:59:59`);
    if (rfid) qs.set('rfid', rfid);
    if (filterName) qs.set('filterName', filterName);
    if (ahu) qs.set('ahu', ahu);
    if (userQ) qs.set('user', userQ);
    qs.set('page', String(pg));
    qs.set('limit', String(limit));
    return qs.toString();
  };

  const { data, isLoading } = useSWR<Resp>(`/api/assets/identifiers/track-record?${buildQs(PER_PAGE, page)}`);
  const rows = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.totalPages ?? 1;

  const resetPageAnd = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

  // ── SUPER_ADMIN edit (2026-09-05). A row IS an audit_trail row, so the edit
  // breaks the hash chain from it onward (accepted by the operator); when the
  // row is the tag's latest event the live tag is corrected too. Reference
  // lists load only for a SUPER_ADMIN, and only once the page is open.
  const isSuperAdmin = useIsSuperAdmin();
  const [editRow, setEditRow] = useState<TrackRow | null>(null);
  const { data: treeData } = useSWR<any[]>(isSuperAdmin ? '/api/hierarchy/tree' : null);
  const { data: usersData } = useSWR<any>(isSuperAdmin ? `/api/users?page=1&limit=${ALL_ROWS}` : null);
  const { data: identifiersData } = useSWR<any>(isSuperAdmin ? '/api/assets/identifiers' : null);
  const { ahuOpts, filterRows } = (() => {
    const ahus: Array<{ value: string; label: string }> = [];
    const filters: Array<{ id: string; name: string; ahuId: string }> = [];
    const takeAhu = (ahu: any, prefix: string) => {
      ahus.push({ value: ahu.id, label: `${prefix}${ahu.name}` });
      for (const f of ahu.filters ?? []) filters.push({ id: f.id, name: f.name, ahuId: ahu.id });
    };
    for (const b of (Array.isArray(treeData) ? treeData : [])) {
      for (const a of b.areas ?? []) for (const ahu of a.ahus ?? []) takeAhu(ahu, `${b.name} / ${a.name} / `);
      for (const ahu of b.ahus ?? []) takeAhu(ahu, `${b.name} / `);
    }
    return { ahuOpts: ahus, filterRows: filters };
  })();
  const knownTags: string[] = ((identifiersData as any)?.data ?? (Array.isArray(identifiersData) ? identifiersData : []))
    .filter((i: any) => i.identifierType === 'RFID').map((i: any) => i.identifierValue);
  const rfidFields: EditFieldSpec[] = [
    { key: 'timestamp', label: 'Date & time', type: 'datetime', required: true },
    { key: 'event', label: 'Event', type: 'select', required: true, options: [{ value: 'ASSIGN', label: 'Assigned' }, { value: 'REMOVE', label: 'Removed' }] },
    { key: 'rfidNumber', label: 'RFID number', type: 'text', required: true, suggestions: knownTags },
    { key: 'ahuId', label: 'AHU', type: 'select', options: ahuOpts, emptyOption: '-- all AHUs --', help: 'Narrows the Filter list below. The AHU column always shows the filter\'s current AHU.' },
    { key: 'filterId', label: 'Filter', type: 'select', emptyOption: '-- keep current --',
      options: (v) => filterRows.filter(f => !v.ahuId || f.ahuId === v.ahuId).map(f => ({ value: f.id, label: f.name })) },
    { key: 'userId', label: 'User', type: 'select', options: userOptions((usersData as any)?.data ?? [], 'id'), emptyOption: '-- keep current --' },
    { key: 'remarks', label: 'Remarks', type: 'textarea', placeholder: 'Shown in the Reason column' },
  ];
  const saveRfidRow = async (changed: Record<string, any>, reason: string, password?: string) => {
    if (!editRow) return;
    const body: Record<string, any> = { ...changed, _changeReason: reason };
    delete body.ahuId; // a picker aid only - the row stores the filter
    for (const k of ['filterId', 'userId']) if (body[k] === '') delete body[k];
    const url = `/api/super-admin/filter-data/rfid-events/${editRow.id}`;
    return password ? api.putWithReauth<any>(url, body, password) : api.put<any>(url, body);
  };

  const buildRfidExport = async (): Promise<{ body: string[][]; period: string; total: number }> => {
    const all = await api.get<Resp>(`/api/assets/identifiers/track-record?${buildQs(500, 1)}`);
    const period = from || to
      ? `${from ? formatDateTime(from) : 'Start'} to ${to ? formatDateTime(`${to}T23:59:59`) : 'Now'}`
      : 'All Time';
    const body = all.data.map((r, i) => [
      String(i + 1), formatDateTime(r.timestamp), r.event === 'ASSIGN' ? 'Assigned' : 'Removed',
      r.rfidNumber, r.filterName ?? '-', r.ahuName ?? '-', r.user ?? '-', r.reason ?? '-',
    ]);
    return { body, period, total: all.total };
  };

  const buildRfidReport = async () => {
    const r = await buildRfidExport();
    if (r.body.length > exportLimit.maxRecords) { toast.error('Export too large', exportLimit.tooLargeMessage(r.body.length)); return null; }
    const report = await createReport({ reportKey: 'rfid-track-record',
      title: L.title,
      subtitle: L.subtitle || `Period: ${r.period}  |  Total: ${r.total} event(s)`,
      // 2026-09-02 (operator request): portrait. The page size was already A4
      // (pdf-report.ts hard-codes format:'a4' for every report) — only the
      // orientation changes, so this is 210x297mm instead of 297x210mm. The 8
      // columns still fit: addTable uses overflow:'linebreak', so cells wrap
      // rather than running off the page — expect taller rows and more pages.
      // getSnapshot() carries orientation, so Send-for-Review re-renders portrait too.
      orientation: 'portrait',
      formatDateTime,
    });
    // Explicit widths, because portrait leaves 181mm of usable page (measured)
    // versus 268mm in landscape, and autoTable's automatic sizing spends that on
    // whatever cell content happens to be longest. Left to itself it gave the
    // 60-character RFID strings and long filter names most of the width and
    // squeezed the rest, so headers broke one letter per line ("R/e/a/s/o/n")
    // and a timestamp wrapped across four. These total 181mm.
    report.addTable({
      head: headLabels,
      body: r.body,
      // 2026-09-02 (operator request): larger text, and fewer records per page
      // as a direct consequence — 9pt rows are taller than 7pt ones, so the
      // table breaks sooner. Column widths below were sized for this font.
      fontSize: 9,
      columnStyles: {
        // cellPadding is 2.5mm a side, so a column needs its header text + 5mm.
        // 10mm was not enough for "S.No" itself and broke it to "S.N / o".
        // Retuned for 9pt. The page gives 180mm (NOT the 181 previously written
        // here — addTable passes no `margin`, so autoTable's default applies and
        // a 181mm table reports "0.78 units width could not fit page");
        // 8 columns spend 40mm of that on
        // horizontal padding, leaving ~141mm of text. 9pt glyphs are ~12% wider
        // than 8pt, so the fixed-content columns below were sized to their own
        // longest value at 9pt first, and whatever remained went to the two
        // free-text columns. Those two therefore wrap on long values — that is
        // the deliberate trade for the larger type, and it is the right pair to
        // spend it on: an RFID tag or a filter path reads fine over two lines,
        // a column HEADER or a timestamp does not.
        0: { cellWidth: 13 },  // S.No
        // 24-hour timestamps dropped the " PM" suffix, so this column needs ~3mm
        // less than it did; that slack went to RFID Number, whose header had been
        // splitting to "RFID / Number" for want of exactly this much.
        1: { cellWidth: 32 },  // Date & Time — holds "8/19/2026 19:45" on one line
        2: { cellWidth: 20 },  // Event — "Assigned" / "Removed"
        3: { cellWidth: 27 },  // RFID Number — header now fits; 60-char tags still wrap
        4: { cellWidth: 32 },  // Filter — long hierarchy paths wrap to two lines (32, not 33: see the 180mm note above)
        5: { cellWidth: 19 },  // AHU
        6: { cellWidth: 19 },  // User
        7: { cellWidth: 18 },  // Reason
      },
    });
    return { report, count: r.body.length };
  };

  const exportPdf = async () => {
    setDownloading(true);
    try {
      const built = await buildRfidReport();
      if (!built) return;
      await requireExportReauth(reauth, { reportType: 'RFID Track Record', format: 'PDF', recordCount: built.count }, toast.warning);
      built.report.save(`${downloadName('rfid-track-record')}.pdf`);
    } finally { setDownloading(false); }
  };

  const buildRfidSnapshot = async () => { const b = await buildRfidReport(); return b ? b.report.getSnapshot() : null; };

  const exportExcel = async () => {
    setDownloading(true);
    try {
      const r = await buildRfidExport();
      if (r.body.length > exportLimit.maxRecords) { toast.error('Export too large', exportLimit.tooLargeMessage(r.body.length)); return; }
      await requireExportReauth(reauth, { reportType: 'RFID Track Record', format: 'Excel', recordCount: r.body.length }, toast.warning);
      exportToExcel({ filename: `rfid-track-record-${new Date().toISOString().slice(0, 10)}`, sheetName: 'RFID Track Record', head: headLabels, rows: r.body });
    } finally { setDownloading(false); }
  };

  const inputCls = 'px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500';

  return (
    <ReportPageWrapper title={L.title} totalRecords={total} page={page} totalPages={totalPages} hideFooter>
      <ReauthPrompt reauth={reauth} actionLabel="Export report" />
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-800">{L.title}</h1>
              <p className="text-[13px] text-slate-500">{L.subtitle || 'Complete assign / remove lifecycle history of RFID tags'}</p>
            </div>
            {total > 0 && (
              <>
                {/* Phase 5C: Export gated on rfid_track.export (gate: ASSET_VIEW + FILTER_RFID_MANAGE).
                    Effectively-same as page-view gate — no user visible for this page without both. */}
                {can('rfid_track.export') && (
                  <ExportMenu surface="rfid-track-record" onExportPdf={exportPdf} onExportExcel={exportExcel} busy={downloading}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors disabled:opacity-50" />
                )}
                {/* SendForReviewButton is globally disabled — left ungated. */}
                <SendForReviewButton buildSnapshot={buildRfidSnapshot}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold text-slate-700 border border-slate-200 bg-white hover:bg-slate-50" />
              </>
            )}
          </div>
          {/* Filters */}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <DateRangeFilter
              size="sm"
              from={from}
              to={to}
              onFromChange={resetPageAnd(setFrom)}
              onToChange={resetPageAnd(setTo)}
              fromAriaLabel="RFID track record from date"
              toAriaLabel="RFID track record to date"
            />
            <label className="flex flex-col text-[11px] font-medium text-slate-500">RFID Number
              <input type="text" value={rfid} placeholder="e.g. CA000…" onChange={e => resetPageAnd(setRfid)(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col text-[11px] font-medium text-slate-500">Filter
              <input type="text" value={filterName} placeholder="Filter name" onChange={e => resetPageAnd(setFilterName)(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col text-[11px] font-medium text-slate-500">AHU
              <input type="text" value={ahu} placeholder="AHU name" onChange={e => resetPageAnd(setAhu)(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col text-[11px] font-medium text-slate-500">User
              <input type="text" value={userQ} placeholder="User" onChange={e => resetPageAnd(setUserQ)(e.target.value)} className={inputCls} />
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-auto px-6 py-4">
          {isLoading ? (
            <div className="text-center text-slate-400 py-12">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="text-center text-slate-400 py-12">No RFID activity found for these filters.</div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-50 border-b border-slate-200">
                  {headLabels.map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
                  {isSuperAdmin && <th className="text-right px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">Edit</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.map((r, idx) => (
                  <tr key={idx} className="hover:bg-cyan-50/30 transition-colors">
                    <td className="px-4 py-3 text-[13px] text-slate-400 font-medium text-center tabular-nums">{(page - 1) * PER_PAGE + idx + 1}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600 whitespace-nowrap tabular-nums">{formatDateTime(r.timestamp)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2.5 py-1 text-[11px] font-bold rounded-full ${r.event === 'ASSIGN' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                        {r.event === 'ASSIGN' ? 'Assigned' : 'Removed'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-slate-800 font-mono">{r.rfidNumber}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-700">{r.filterName ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{r.ahuName ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{r.user ?? <span className="text-slate-300">—</span>}</td>
                    <td className="px-4 py-3 text-[13px] text-slate-600">{r.reason ?? <span className="text-slate-300">—</span>}</td>
                    {isSuperAdmin && (
                      <td className="px-4 py-3 text-right">
                        <SuperAdminEditButton onClick={() => setEditRow(r)} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {editRow && (
          <SuperAdminRecordEditDialog
            open
            title="Edit RFID record"
            chainWarning
            fields={rfidFields}
            initial={{
              timestamp: editRow.timestamp, event: editRow.event, rfidNumber: editRow.rfidNumber,
              ahuId: editRow.ahuId ?? '', filterId: editRow.filterId ?? '', userId: editRow.userId ?? '', remarks: editRow.reason ?? '',
            }}
            onChange={(key, _value, next) => (key === 'ahuId' ? { ...next, filterId: '' } : undefined)}
            onSave={saveRfidRow}
            onSaved={(res: any) => {
              toast.success('RFID record updated', res?.liveTagNote ?? 'Recorded in the audit trail');
              // Track record + the live tag list the Filters page reads.
              mutate((key) => typeof key === 'string' && key.startsWith('/api/assets/identifiers'));
            }}
            onClose={() => setEditRow(null)}
          />
        )}

        {total > 0 && (
          <div className="px-6 py-3 border-t border-slate-200 bg-white shrink-0 flex items-center justify-between flex-wrap gap-3">
            <span className="text-[13px] text-slate-500">
              Showing <span className="font-semibold text-slate-700">{(page - 1) * PER_PAGE + 1}</span>
              {' '}-{' '}
              <span className="font-semibold text-slate-700">{Math.min(page * PER_PAGE, total)}</span>
              {' '}of{' '}
              <span className="font-semibold text-slate-700">{total.toLocaleString()}</span>
            </span>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                Previous
              </button>
              <span className="text-[13px] text-slate-500">Page {page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                className="px-3 py-1.5 rounded-lg text-[13px] font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </ReportPageWrapper>
  );
}
