import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { useDatetimeFormat } from '@/hooks/use-datetime-format';
import { themeButton } from '@/lib/theme-styles';

// Show "NA" when a value wasn't entered (null/empty/whitespace) or was a stray
// "[object Object]" from a non-text spreadsheet cell.
const naText = (v: unknown): string => {
  const s = (v ?? '').toString().trim();
  return !s || s === '[object Object]' ? 'NA' : s;
};

// Status chip colours
const STATUS_CHIP: Record<string, string> = {
  PENDING: 'bg-slate-100 text-slate-500 border-slate-200',
  DUE: 'bg-amber-50 text-amber-700 border-amber-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-green-50 text-green-700 border-green-200',
  MISSED: 'bg-rose-50 text-rose-700 border-rose-200',
};

export function ReplacementSchedulePage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { formatDate } = useDatetimeFormat();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const perms = user?.permissions ?? [];
  const canUpload = isSuperAdmin || perms.includes('REPLACEMENT_SCHEDULE_UPLOAD');

  const { data, isLoading } = useSWR('/api/replacement-schedules', { refreshInterval: 30000 });
  const schedules = (data?.data ?? []) as any[];

  // Upload dialog state
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'select' | 'preview' | 'uploading' | 'results'>('select');
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [error, setError] = useState('');
  const [created, setCreated] = useState(0);
  const [failed, setFailed] = useState(0);

  const resetDialog = () => {
    setStep('select'); setFile(null); setRows([]); setResults([]); setError(''); setCreated(0); setFailed(0);
  };
  const openDialog = () => { resetDialog(); setOpen(true); };
  const closeDialog = () => setOpen(false);

  const token = () => sessionStorage.getItem('access_token');

  const downloadTemplate = async () => {
    try {
      const res = await fetch('/api/replacement-schedules/template.xlsx', { headers: { Authorization: `Bearer ${token()}` } });
      if (!res.ok) { toast.error('Download failed', res.status === 401 ? 'Session expired.' : `HTTP ${res.status}`); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'replacement-schedule-template.xlsx'; a.style.display = 'none';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e: any) { toast.error('Download failed', e?.message ?? 'Network error'); }
  };

  const onFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f); setError(''); setResults([]);
    try {
      const fd = new FormData(); fd.append('file', f);
      const res = await fetch('/api/replacement-schedules/validate', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setError(d.message || `Could not read file (HTTP ${res.status})`); return; }
      setRows(d.rows || []); setResults(d.results || []); setStep('preview');
    } catch (e: any) { setError(e?.message || 'Failed to read the file'); }
  };

  const submit = async () => {
    if (!file) return;
    setStep('uploading');
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/replacement-schedules', { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: fd });
      const d = await res.json().catch(() => ({}));
      if (!res.ok && !Array.isArray(d.results)) { setError(d.message || `Upload failed (HTTP ${res.status})`); setStep('preview'); return; }
      setResults(d.results || []); setCreated(d.created || 0); setFailed(d.failed || 0); setStep('results');
      if ((d.created || 0) > 0) { mutate('/api/replacement-schedules'); toast.success('Schedule uploaded', `${d.created} entr${d.created === 1 ? 'y' : 'ies'} created`); }
    } catch (e: any) { setError(e?.message || 'Network error'); setStep('preview'); }
  };

  const errorRows = results.filter((r: any) => r.status === 'error');

  return (
    <div className="py-6 space-y-6 -mx-3 sm:-mx-4 lg:-mx-6 px-3 sm:px-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Replacement Schedule</h1>
          <p className="text-sm text-slate-500 mt-0.5">{schedules.length} uploaded schedule(s)</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={downloadTemplate}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 shadow-sm transition-all">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
            Download Template
          </button>
          {canUpload && (
            <button onClick={openDialog}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-white rounded-lg text-xs font-semibold shadow-sm hover:shadow-md transition-all" style={themeButton}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
              Upload Schedule
            </button>
          )}
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center text-sm text-slate-400">Loading…</div>
      ) : schedules.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-16 text-center">
          <p className="text-slate-600 font-medium mb-1">No replacement schedules yet</p>
          <p className="text-sm text-slate-400">{canUpload ? 'Upload a schedule template to get started.' : 'No schedules have been uploaded.'}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {schedules.map((s: any) => (
            <div key={s.id} className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
              <div className="px-4 py-3 border-b border-slate-100 bg-slate-50/60 flex items-center justify-between">
                <div className="text-sm font-semibold text-slate-700">{s.fileName ?? 'Schedule'} <span className="text-slate-400 font-normal">· {(s.entries ?? []).length} entries</span></div>
                <div className="text-[11px] text-slate-400">by {s.uploadedByName ?? '—'} · {formatDate(s.createdAt)}</div>
              </div>
              <div className="overflow-auto max-h-[calc(100vh-22rem)]">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="bg-slate-50 border-b border-slate-200 [&>th]:bg-slate-50 [&>th]:whitespace-nowrap [&>th]:text-left [&>th]:px-3 [&>th]:py-2 [&>th]:text-[11px] [&>th]:font-semibold [&>th]:text-slate-500 [&>th]:uppercase [&>th]:tracking-wider">
                      <th className="w-12 text-center">S.No</th>
                      <th>AHU</th>
                      <th>Micron</th>
                      <th>Size</th>
                      <th className="text-center">Qty</th>
                      <th className="text-center">Replaced</th>
                      <th>Schedule Date</th>
                      <th>Window (± days)</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(s.entries ?? []).map((e: any, idx: number) => (
                      <tr key={e.id} className="[&>td]:whitespace-nowrap [&>td]:px-3 [&>td]:py-2 [&>td]:text-sm hover:bg-slate-50/50">
                        <td className="text-center text-slate-400">{e.slNo ?? idx + 1}</td>
                        <td className="font-medium text-slate-800 max-w-[180px] truncate" title={e.ahuName}>{e.ahuName}</td>
                        <td className="text-slate-500">{naText(e.filterMicron)}</td>
                        <td className="text-slate-500 max-w-[140px] truncate" title={naText(e.filterSize)}>{naText(e.filterSize)}</td>
                        <td className="text-center text-slate-700">{e.qty}</td>
                        <td className="text-center text-slate-700">{e.qtyReplaced}</td>
                        <td className="text-slate-600">{formatDate(e.scheduleDate)}</td>
                        <td className="text-slate-500">{formatDate(e.windowStart)} → {formatDate(e.windowEnd)} <span className="text-slate-400">(±{e.toleranceDays})</span></td>
                        <td><span className={`text-[11px] px-2.5 py-1 rounded-full border font-medium ${STATUS_CHIP[e.computedStatus] ?? STATUS_CHIP.PENDING}`}>{(e.computedStatus ?? 'PENDING').replace(/_/g, ' ')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload dialog */}
      {open && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
            <div className="px-6 py-4 shrink-0 flex items-center justify-between" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
              <div>
                <h2 className="text-lg font-bold text-white">Upload Replacement Schedule</h2>
                <p className="text-white/70 text-sm">Excel (.xlsx) with the template columns</p>
              </div>
              <button onClick={closeDialog} className="text-white/80 hover:text-white">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              {error && <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{error}</div>}

              {step === 'select' && (
                <div className="space-y-3">
                  <button onClick={downloadTemplate} className="text-sm text-cyan-700 underline">Download the template first</button>
                  <label className="block">
                    <span className="block text-sm font-medium text-slate-700 mb-1">Schedule file (.xlsx)</span>
                    <input type="file" accept=".xlsx" onChange={onFileSelect} className="block w-full text-sm text-slate-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-cyan-50 file:text-cyan-700 file:font-semibold hover:file:bg-cyan-100" />
                  </label>
                </div>
              )}

              {step === 'preview' && (
                <div className="space-y-3">
                  <div className="text-sm text-slate-600">
                    {errorRows.length === 0
                      ? <span className="text-green-700 font-medium">{rows.length} row(s) ready — no errors.</span>
                      : <span className="text-rose-700 font-medium">{errorRows.length} error(s) found — fix and re-upload (nothing is saved until all rows are valid).</span>}
                  </div>
                  <div className="border border-slate-200 rounded-lg overflow-auto max-h-[40vh]">
                    <table className="w-full text-[12px]">
                      <thead className="sticky top-0 bg-slate-50"><tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:text-left [&>th]:font-semibold [&>th]:text-slate-500 [&>th]:whitespace-nowrap">
                        <th>AHU</th><th>Micron</th><th>Size</th><th>Qty</th><th>Date</th><th>Tol.</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((r: any, i: number) => (
                          <tr key={i} className="[&>td]:px-2 [&>td]:py-1.5 [&>td]:whitespace-nowrap">
                            <td>{r.ahuName}</td><td>{r.filterMicron}</td><td>{r.filterSize}</td><td>{r.qty}</td><td>{r.scheduleDate}</td><td>{r.toleranceDays}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {errorRows.length > 0 && (
                    <div className="border border-rose-200 rounded-lg bg-rose-50/50 p-2 max-h-[20vh] overflow-auto text-[12px] text-rose-700 space-y-0.5">
                      {errorRows.map((er: any, i: number) => <div key={i}>Row {er.row}{er.column ? ` · ${er.column}` : ''}: {er.error}</div>)}
                    </div>
                  )}
                </div>
              )}

              {step === 'uploading' && <div className="text-center py-8 text-sm text-slate-500">Uploading…</div>}

              {step === 'results' && (
                <div className="space-y-2">
                  <div className={`rounded-lg p-3 text-sm font-medium ${failed === 0 ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}>
                    {created} created{failed ? `, ${failed} failed` : ''}.
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t border-slate-200 bg-slate-50 flex items-center gap-3">
              <button onClick={closeDialog} className="flex-1 px-4 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-100">{step === 'results' ? 'Close' : 'Cancel'}</button>
              {step === 'preview' && (
                <button onClick={submit} disabled={errorRows.length > 0}
                  className="flex-1 px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed" style={themeButton}>
                  Upload {rows.length} row(s)
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
