import { useState, useRef, useEffect } from 'react';
import useSWR from 'swr';

interface BulkUploadFiltersDialogProps {
  open: boolean;
  onClose: () => void;
  ahuId: string;
  ahuName: string;
  onSuccess: () => void;
}

interface ParsedRow {
  name: string;
  filterSet: string;
  ahuType: string;
  filterType: string;
  filterSize: string;
  filterDimensions: string;
  cleaningFrequencyTolerance: string;
  lastCleaningDate: string;
}

interface ResultRow {
  row: number;
  name: string;
  status: 'success' | 'error';
  id?: string;
  error?: string;
}

type Step = 'select' | 'upload' | 'preview' | 'uploading' | 'results';

const FILTER_TYPES = ['Pre', 'HEPA', 'Fine', 'ULPA', 'Carbon', 'Bag'];
const AHU_TYPES = ['Process', 'Non Process'];

export function BulkUploadFiltersDialog({ open, onClose, ahuId, ahuName, onSuccess }: BulkUploadFiltersDialogProps) {
  const [step, setStep] = useState<Step>('select');
  const [file, setFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parseError, setParseError] = useState('');
  const [results, setResults] = useState<ResultRow[]>([]);
  const [created, setCreated] = useState(0);
  const [failed, setFailed] = useState(0);
  const [selectedBlock, setSelectedBlock] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch blocks for dropdown
  const { data: templatesData } = useSWR(open ? '/api/assets/templates?limit=1000' : null);
  const { data: instancesData } = useSWR(open ? '/api/assets/instances?limit=500' : null);

  const blockTemplateId = (templatesData?.data ?? []).find((t: any) => t.name === 'Block')?.id;
  const blocks = (instancesData?.data ?? []).filter((e: any) => e.templateId === blockTemplateId);

  useEffect(() => { if (!open) reset(); }, [open]);

  if (!open) return null;

  function reset() {
    setStep('select');
    setFile(null);
    setParsedRows([]);
    setParseError('');
    setResults([]);
    setCreated(0);
    setFailed(0);
    setSelectedBlock('');
  }

  const handleClose = () => { reset(); onClose(); };

  const downloadTemplate = () => {
    const header = 'name,filterSet,ahuType,filterType,filterSize,filterDimensions,cleaningFrequencyTolerance,lastCleaningDate';
    const example1 = 'HEPA-A-001,A,Process,HEPA,0.3 micron,24x24x12,30 days,2026-03-01';
    const example2 = 'PRE-B-001,B,Non Process,Pre,5 micron,24x24x4,15 days,2026-02-15';
    const csv = `${header}\n${example1}\n${example2}\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'filter-upload-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setParseError('');

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { setParseError('CSV must have a header row and at least one data row'); return; }

        const header = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
        const colMap: Record<string, number> = {};
        header.forEach((h, i) => { colMap[h] = i; });

        const nameIdx = colMap['name'] ?? colMap['filtername'] ?? colMap['filterid'] ?? -1;
        const setIdx = colMap['filterset'] ?? -1;

        if (nameIdx === -1) { setParseError('CSV must have a "name" column'); return; }
        if (setIdx === -1) { setParseError('CSV must have a "filterSet" column'); return; }

        const getCol = (line: string[], key: string) => {
          const idx = colMap[key];
          return idx !== undefined && idx < line.length ? line[idx].trim() : '';
        };

        const rows: ParsedRow[] = [];
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(',').map(c => c.trim());
          const name = cols[nameIdx] || '';
          if (!name) continue;
          rows.push({
            name,
            filterSet: cols[setIdx] || '',
            ahuType: getCol(cols, 'ahutype'),
            filterType: getCol(cols, 'filtertype'),
            filterSize: getCol(cols, 'filtersize'),
            filterDimensions: getCol(cols, 'filterdimensions'),
            cleaningFrequencyTolerance: getCol(cols, 'cleaningfrequencytolerance'),
            lastCleaningDate: getCol(cols, 'lastcleaningdate'),
          });
        }

        if (rows.length === 0) { setParseError('No valid rows found'); return; }
        if (rows.length > 200) { setParseError('Maximum 200 filters per upload'); return; }

        setParsedRows(rows);
        setStep('preview');
      } catch { setParseError('Failed to parse CSV file'); }
    };
    reader.readAsText(f);
  };

  const handleUpload = async () => {
    if (!file) return;
    setStep('uploading');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('ahuId', ahuId);
      if (selectedBlock) formData.append('blockId', selectedBlock);

      const token = sessionStorage.getItem('access_token');
      const res = await fetch('/api/assets/instances/bulk-upload-filters', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        setResults([{ row: 0, name: '', status: 'error', error: data.message || 'Upload failed' }]);
        setFailed(1);
        setStep('results');
        return;
      }

      setResults(data.results || []);
      setCreated(data.created || 0);
      setFailed(data.failed || 0);
      setStep('results');
      if (data.created > 0) onSuccess();
    } catch (e: any) {
      setResults([{ row: 0, name: '', status: 'error', error: e.message || 'Network error' }]);
      setFailed(1);
      setStep('results');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[55] p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-4 shrink-0">
          <h2 className="text-lg font-bold text-white">Bulk Upload Filters</h2>
          <p className="text-cyan-100 text-sm">Add filters to {ahuName}</p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">

          {/* Step: Select Block */}
          {step === 'select' && (
            <>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">Block (optional)</label>
                  <select value={selectedBlock} onChange={e => setSelectedBlock(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-slate-800 text-sm">
                    <option value="">-- No block --</option>
                    {blocks.map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-500 mb-1">AHU</label>
                  <div className="w-full bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-slate-600 text-sm">{ahuName} (selected)</div>
                </div>
              </div>

              <div className="bg-slate-50/50 border border-slate-200 rounded-xl p-4">
                <h4 className="text-sm font-medium text-slate-600 mb-2">CSV Columns</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-cyan-600 font-mono">name</span><span className="text-slate-400">Filter ID/Name (required)</span>
                  <span className="text-cyan-600 font-mono">filterSet</span><span className="text-slate-400">A or B (required)</span>
                  <span className="text-cyan-600 font-mono">ahuType</span><span className="text-slate-400">Process / Non Process</span>
                  <span className="text-cyan-600 font-mono">filterType</span><span className="text-slate-400">Pre, HEPA, Fine, ULPA, Carbon, Bag</span>
                  <span className="text-cyan-600 font-mono">filterSize</span><span className="text-slate-400">Size in micron</span>
                  <span className="text-cyan-600 font-mono">filterDimensions</span><span className="text-slate-400">L x W x H</span>
                  <span className="text-cyan-600 font-mono">cleaningFrequencyTolerance</span><span className="text-slate-400">e.g. 30 days</span>
                  <span className="text-cyan-600 font-mono">lastCleaningDate</span><span className="text-slate-400">YYYY-MM-DD</span>
                </div>
              </div>

              <button onClick={downloadTemplate}
                className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Download CSV Template
              </button>
            </>
          )}

          {/* Step: Upload */}
          {step === 'upload' && (
            <>
              <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-cyan-600 transition-colors cursor-pointer"
                onClick={() => fileRef.current?.click()}>
                <svg className="w-10 h-10 mx-auto text-slate-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                <p className="text-sm text-slate-500">{file ? file.name : 'Click to select CSV file'}</p>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={handleFileSelect} />
              </div>
              {parseError && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">{parseError}</div>}
            </>
          )}

          {/* Step: Preview */}
          {step === 'preview' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">{parsedRows.length} filter(s) ready to create</p>
                <button onClick={() => { setStep('upload'); setFile(null); setParsedRows([]); }}
                  className="text-xs text-cyan-600 hover:text-cyan-700">Change file</button>
              </div>

              <div className="max-h-72 overflow-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">#</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Name</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Set</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">AHU Type</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Filter Type</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Size</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Dimensions</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Freq/Tol</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Last Clean</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((r, i) => (
                      <tr key={r.name + '-' + i} className="border-t border-slate-200">
                        <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-1.5 text-slate-700">{r.name}</td>
                        <td className="px-3 py-1.5 text-slate-600">{r.filterSet}</td>
                        <td className="px-3 py-1.5 text-slate-500">{r.ahuType || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{r.filterType || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{r.filterSize || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{r.filterDimensions || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{r.cleaningFrequencyTolerance || '-'}</td>
                        <td className="px-3 py-1.5 text-slate-500">{r.lastCleaningDate || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Step: Uploading */}
          {step === 'uploading' && (
            <div className="flex flex-col items-center py-8 gap-4">
              <div className="w-10 h-10 border-3 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-500">Creating {parsedRows.length} filters...</p>
            </div>
          )}

          {/* Step: Results */}
          {step === 'results' && (
            <>
              <div className="flex gap-4">
                {created > 0 && (
                  <div className="flex-1 bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{created}</div>
                    <div className="text-xs text-green-500">Created</div>
                  </div>
                )}
                {failed > 0 && (
                  <div className="flex-1 bg-red-50 border border-red-200 rounded-xl p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{failed}</div>
                    <div className="text-xs text-red-500">Failed</div>
                  </div>
                )}
              </div>

              <div className="max-h-64 overflow-y-auto border border-slate-200 rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-4 py-2 text-slate-500 font-medium">Row</th>
                      <th className="text-left px-4 py-2 text-slate-500 font-medium">Name</th>
                      <th className="text-left px-4 py-2 text-slate-500 font-medium">Status</th>
                      <th className="text-left px-4 py-2 text-slate-500 font-medium">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((r, i) => (
                      <tr key={r.name + '-' + r.row + '-' + i} className="border-t border-slate-200">
                        <td className="px-4 py-2 text-slate-400">{r.row}</td>
                        <td className="px-4 py-2 text-slate-700">{r.name}</td>
                        <td className="px-4 py-2">
                          {r.status === 'success'
                            ? <span className="text-green-600">Created</span>
                            : <span className="text-red-600">Failed</span>}
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-400">{r.error || (r.id ? r.id.slice(0, 8) : '')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-200 flex gap-3 shrink-0">
          {step === 'results' ? (
            <button onClick={handleClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors">Close</button>
          ) : (
            <>
              <button onClick={handleClose} className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl font-medium hover:bg-slate-200 transition-colors">Cancel</button>
              {step === 'select' && (
                <button onClick={() => setStep('upload')}
                  className="flex-1 py-3 bg-cyan-600 text-white rounded-xl font-bold hover:bg-cyan-500 transition-colors">
                  Next: Select CSV File
                </button>
              )}
              {step === 'preview' && (
                <button onClick={handleUpload}
                  className="flex-1 py-3 bg-cyan-600 text-white rounded-xl font-bold hover:bg-cyan-500 transition-colors flex items-center justify-center gap-2">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  Upload {parsedRows.length} Filters
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
