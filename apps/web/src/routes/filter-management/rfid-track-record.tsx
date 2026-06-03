import { useState } from 'react';
import useSWR from 'swr';
import { useDatetimeFormat } from '../../hooks/use-datetime-format';
import { createReport } from '../../lib/pdf-report';
import { api } from '../../lib/api-client';
import { ReportPageWrapper } from '@/components/report-page-wrapper';

type TrackRow = {
  timestamp: string;
  event: 'ASSIGN' | 'REMOVE';
  rfidNumber: string;
  filterName: string | null;
  ahuName: string | null;
  user: string | null;
  reason: string | null;
};
type Resp = { data: TrackRow[]; total: number; page: number; limit: number; totalPages: number };

const PER_PAGE = 50;

export function RfidTrackRecordPage() {
  const { formatDateTime } = useDatetimeFormat();
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

  const handleDownloadPDF = async () => {
    setDownloading(true);
    try {
      const all = await api.get<Resp>(`/api/assets/identifiers/track-record?${buildQs(500, 1)}`);
      const period = from || to
        ? `${from ? formatDateTime(from) : 'Start'} to ${to ? formatDateTime(`${to}T23:59:59`) : 'Now'}`
        : 'All Time';
      const report = await createReport({
        title: 'RFID Track Record Report',
        subtitle: `Period: ${period}  |  Total: ${all.total} event(s)`,
        orientation: 'landscape',
        formatDateTime,
      });
      report.addTable({
        head: ['S.No', 'Date / Time', 'Event', 'RFID Number', 'Filter', 'AHU', 'User', 'Reason'],
        body: all.data.map((r, i) => [
          String(i + 1),
          formatDateTime(r.timestamp),
          r.event === 'ASSIGN' ? 'Assigned' : 'Removed',
          r.rfidNumber,
          r.filterName ?? '-',
          r.ahuName ?? '-',
          r.user ?? '-',
          r.reason ?? '-',
        ]),
      });
      report.save(`rfid-track-record-${new Date().toISOString().slice(0, 10)}.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  const inputCls = 'px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500';

  return (
    <ReportPageWrapper title="RFID Track Record" totalRecords={total} page={page} totalPages={totalPages}>
      <div className="flex flex-col h-full">
        <div className="px-6 py-4 border-b border-slate-200 bg-white shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-xl font-bold text-slate-800">RFID Track Record</h1>
              <p className="text-[13px] text-slate-500">Complete assign / remove lifecycle history of RFID tags</p>
            </div>
            <button
              onClick={handleDownloadPDF}
              disabled={downloading || total === 0}
              className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-cyan-600 hover:bg-cyan-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {downloading ? 'Generating…' : 'Download PDF'}
            </button>
          </div>
          {/* Filters */}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex flex-col text-[11px] font-medium text-slate-500">From
              <input type="date" value={from} onChange={e => resetPageAnd(setFrom)(e.target.value)} className={inputCls} />
            </label>
            <label className="flex flex-col text-[11px] font-medium text-slate-500">To
              <input type="date" value={to} onChange={e => resetPageAnd(setTo)(e.target.value)} className={inputCls} />
            </label>
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
                  {['S.No', 'Date / Time', 'Event', 'RFID Number', 'Filter', 'AHU', 'User', 'Reason'].map((h, i) => (
                    <th key={i} className="text-left px-4 py-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider whitespace-nowrap bg-slate-50">{h}</th>
                  ))}
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

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
