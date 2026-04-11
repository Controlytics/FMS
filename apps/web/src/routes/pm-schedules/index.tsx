import { useRef, useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '../../lib/api-client';

interface UploadResult {
  imported: number;
  skipped: number;
  details: {
    imported: Array<{ row: number; ahuName: string; plannedDate: string; scheduleId: string; entryId: string }>;
    skipped: Array<{ row: number; reason: string; data?: any }>;
  };
}


export function PmScheduleListPage() {
  const { data: pmConfig } = useSWR('/api/config/dynamic/filter-pm-schedule');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [result, setResult] = useState<UploadResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PM module disabled — short-circuit
  if (pmConfig && !(pmConfig as any)?.enabled && !((pmConfig as any)?.value?.enabled)) {
    return (
      <div className="p-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-16 text-center shadow-sm">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-slate-700 mb-2">PM Module Disabled</h2>
          <p className="text-slate-500">Enable Preventive Maintenance scheduling in Configuration settings to use this page.</p>
        </div>
      </div>
    );
  }

  const handleDownloadTemplate = async () => {
    try {
      // apiClient.get returns JSON by default; we need the raw text for a file download
      const res = await fetch(`${(window as any).__API_BASE__ ?? ''}/api/pm-schedules/template.csv`, {
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('access_token') ?? localStorage.getItem('access_token_backup') ?? ''}`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pm-schedule-template.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setUploadError(`Failed to download template: ${e.message ?? 'unknown error'}`);
    }
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    setUploadError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/pm-schedules/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionStorage.getItem('access_token') ?? localStorage.getItem('access_token_backup') ?? ''}`,
        },
        body: form,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setUploadError(body?.message ?? `Upload failed (HTTP ${res.status})`);
      } else {
        setResult(body as UploadResult);
      }
    } catch (e: any) {
      setUploadError(e.message ?? 'Upload failed');
    }
    setUploading(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div className="p-6 space-y-6">
      {/* ─── Header ─── */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-600 shadow-lg shadow-cyan-500/25">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">PM Schedules</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Upload scheduled cleaning dates for AHUs — due filters appear automatically in My Tasks
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Template
          </button>
          <button
            onClick={() => { setUploadOpen(true); setResult(null); setUploadError(''); }}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-teal-600 to-cyan-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-cyan-500/25 hover:from-teal-500 hover:to-cyan-500 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.9A5.001 5.001 0 0115.9 6a5 5 0 01.1 10H7zM9 15l3-3m0 0l3 3m-3-3v6" />
            </svg>
            Upload Schedule
          </button>
        </div>
      </div>

      {/* ─── Instructions card ─── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-teal-400 to-cyan-500" />
        <div className="p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-800">How it works</h2>
          <ol className="space-y-3 text-sm text-slate-600">
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-lg bg-cyan-50 text-cyan-700 text-xs font-bold flex items-center justify-center shrink-0">1</span>
              <span>Click <strong>Download Template</strong> to get a blank CSV with the required columns.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-lg bg-cyan-50 text-cyan-700 text-xs font-bold flex items-center justify-center shrink-0">2</span>
              <span>Fill in one row per <strong>AHU</strong> × <strong>scheduled date</strong>. Leave <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">tolerance_days</code> blank to use the default from config.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-lg bg-cyan-50 text-cyan-700 text-xs font-bold flex items-center justify-center shrink-0">3</span>
              <span>Click <strong>Upload Schedule</strong> and select the file. Both <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">.csv</code> and <code className="px-1.5 py-0.5 bg-slate-100 rounded text-xs">.xlsx</code> are supported.</span>
            </li>
            <li className="flex gap-3">
              <span className="w-6 h-6 rounded-lg bg-cyan-50 text-cyan-700 text-xs font-bold flex items-center justify-center shrink-0">4</span>
              <span>Once today's date falls within <em>scheduled ± tolerance</em>, the AHU's filters show up in <strong>My Tasks</strong>, ready for cleaning.</span>
            </li>
          </ol>
          <div className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-600 overflow-x-auto">
            <div className="text-slate-400 mb-1">example CSV:</div>
            ahu_name,scheduled_date,tolerance_days<br />
            AHU-01,2026-04-15,<br />
            AHU-02,2026-04-20,5<br />
            AHU-03,2026-05-10,3
          </div>
        </div>
      </div>

      {/* ─── Upload Dialog ─── */}
      {uploadOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
            <div className="h-1.5 bg-gradient-to-r from-teal-400 to-cyan-500" />
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 className="text-lg font-bold text-slate-800">Upload PM Schedule</h3>
                  <p className="text-xs text-slate-400 mt-0.5">CSV or XLSX • max 5 MB</p>
                </div>
                <button
                  onClick={() => { setUploadOpen(false); setResult(null); setUploadError(''); }}
                  className="w-9 h-9 rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {!result && (
                <div
                  onDragOver={e => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
                    dragActive
                      ? 'border-cyan-400 bg-cyan-50/50'
                      : 'border-slate-300 bg-slate-50 hover:border-cyan-300 hover:bg-slate-100'
                  }`}
                >
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-teal-100 to-cyan-100 flex items-center justify-center">
                    <svg className="w-8 h-8 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.9A5.001 5.001 0 0115.9 6a5 5 0 01.1 10H7zM9 15l3-3m0 0l3 3m-3-3v6" />
                    </svg>
                  </div>
                  {uploading ? (
                    <>
                      <div className="w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
                      <p className="text-sm font-semibold text-slate-700">Uploading…</p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-slate-700">
                        {dragActive ? 'Drop the file here' : 'Drag and drop or click to choose'}
                      </p>
                      <p className="text-xs text-slate-400 mt-1">Accepts .csv, .xls, .xlsx</p>
                    </>
                  )}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xls,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                    className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  />
                </div>
              )}

              {uploadError && (
                <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl p-3 text-sm">
                  {uploadError}
                </div>
              )}

              {result && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4">
                      <div className="text-2xl font-bold text-emerald-700">{result.imported}</div>
                      <div className="text-xs text-emerald-600 font-semibold mt-0.5">Imported</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <div className="text-2xl font-bold text-amber-700">{result.skipped}</div>
                      <div className="text-xs text-amber-600 font-semibold mt-0.5">Skipped</div>
                    </div>
                  </div>
                  {result.details.imported.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Imported</div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {result.details.imported.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm px-3 py-1.5 bg-emerald-50/50 rounded-lg">
                            <span className="text-emerald-500">✓</span>
                            <span className="font-semibold text-slate-700">{r.ahuName}</span>
                            <span className="text-slate-400">→</span>
                            <span className="text-slate-500">{r.plannedDate}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {result.details.skipped.length > 0 && (
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Skipped</div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {result.details.skipped.map((r, i) => (
                          <div key={i} className="flex items-start gap-2 text-sm px-3 py-1.5 bg-amber-50/50 rounded-lg">
                            <span className="text-amber-500 shrink-0">!</span>
                            <span className="text-slate-600">Row {r.row}: {r.reason}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => { setResult(null); setUploadError(''); }}
                      className="flex-1 py-2.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-sm font-semibold hover:bg-slate-50"
                    >
                      Upload Another
                    </button>
                    <button
                      onClick={() => { setUploadOpen(false); setResult(null); setUploadError(''); }}
                      className="flex-1 py-2.5 bg-gradient-to-r from-teal-600 to-cyan-600 text-white rounded-xl text-sm font-semibold shadow-lg shadow-cyan-500/25"
                    >
                      Done
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
