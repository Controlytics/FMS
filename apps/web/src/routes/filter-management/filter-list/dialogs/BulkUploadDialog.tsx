import { Fragment } from 'react';
import { themeButton } from '@/lib/theme-styles';
import type { AhuOption, BulkUploadStep, DiagramFilterState, TemplateField } from '../types';

type Props = {
  step: BulkUploadStep;
  ahu: string;
  ahus: AhuOption[];
  file: File | null;
  rows: any[];
  error: string;
  results: any[];
  created: number;
  failed: number;
  schema: TemplateField[];
  diagramFilter: DiagramFilterState;
  selectedBlockName: string;
  onAhuChange: (v: string) => void;
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  onClose: () => void;
  onChangeFile: () => void;
  onDownloadTemplate: () => void;
};

export function BulkUploadDialog({
  step, ahu, ahus, file, rows, error, results, created, failed, schema,
  diagramFilter, selectedBlockName,
  onAhuChange, onFileSelect, onSubmit, onClose, onChangeFile, onDownloadTemplate,
}: Props) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[55] p-4">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl">
        {/* Header */}
        <div className="px-6 py-4 shrink-0 flex items-center justify-between" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
          <div>
            <h2 className="text-lg font-bold text-white">Bulk Upload Filters</h2>
            <p className="text-white/70 text-sm">
              {diagramFilter?.type === 'ahu' ? `Into ${diagramFilter.name}`
                : diagramFilter?.type === 'area' ? `Into ${diagramFilter.name} area`
                : `Into ${selectedBlockName}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/20 text-white/80 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">

          {/* Step: Select AHU + file */}
          {step === 'select' && (
            <>
              {/* AHU selector — skip if single AHU context */}
              {ahus.length !== 1 && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Target AHU <span className="text-red-500">*</span></label>
                  {ahus.length === 0 ? (
                    <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
                      No AHUs found in this scope. Create an AHU first in the Structure view.
                    </div>
                  ) : (
                    <select value={ahu} onChange={e => onAhuChange(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-700 bg-white focus:ring-2 focus:ring-[var(--theme-focus-ring)] focus:border-[var(--theme-primary)]">
                      <option value="">Select AHU...</option>
                      {ahus.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                  )}
                </div>
              )}

              {ahus.length === 1 && (
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Target AHU</label>
                  <div className="px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-700">{ahus[0].name}</div>
                </div>
              )}

              {/* CSV format info — dynamic from Filter template */}
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <h4 className="text-sm font-medium text-slate-600 mb-2">CSV Columns</h4>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="font-mono text-theme-primary">name</span><span className="text-slate-400">Filter ID/Name (required)</span>
                  <span className="font-mono text-theme-primary">filterSet</span><span className="text-slate-400">A or B (required)</span>
                  {schema.map(f => (
                    <Fragment key={f.fieldName}>
                      <span className="font-mono text-theme-primary">{f.fieldName}</span>
                      <span className="text-slate-400">
                        {f.dropdownOptions?.length ? f.dropdownOptions.join(', ') : f.dataType || 'Text'}
                        {f.required ? ' (required)' : ''}
                        {f.unit ? ` (${f.unit})` : ''}
                      </span>
                    </Fragment>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={onDownloadTemplate}
                  className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                  Download Template
                </button>
              </div>

              {/* File upload */}
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">CSV File <span className="text-red-500">*</span></label>
                <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-[var(--theme-primary)] transition-colors cursor-pointer"
                  onClick={() => document.getElementById('bulk-upload-file-input')?.click()}>
                  <svg className="w-8 h-8 mx-auto text-slate-400 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  <p className="text-sm text-slate-500">{file ? file.name : 'Click to select CSV file'}</p>
                  <input id="bulk-upload-file-input" type="file" accept=".csv,text/csv" className="hidden" onChange={onFileSelect} />
                </div>
              </div>
              {error && <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
            </>
          )}

          {/* Step: Preview */}
          {step === 'preview' && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-600"><strong>{rows.length}</strong> filter(s) ready to upload into <strong>{ahus.find(h => h.id === ahu)?.name}</strong></p>
                <button onClick={onChangeFile}
                  className="text-xs hover:opacity-80 font-medium text-theme-primary">Change file</button>
              </div>
              <div className="max-h-64 overflow-auto border border-slate-200 rounded-lg">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">#</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Name</th>
                      <th className="text-left px-3 py-2 text-slate-500 font-medium">Set</th>
                      {schema.map(f => (
                        <th key={f.fieldName} className="text-left px-3 py-2 text-slate-500 font-medium">{f.fieldName}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 text-slate-400">{i + 1}</td>
                        <td className="px-3 py-1.5 text-slate-700">{r.name}</td>
                        <td className="px-3 py-1.5 text-slate-600">{r.filterSet}</td>
                        {schema.map(f => (
                          <td key={f.fieldName} className="px-3 py-1.5 text-slate-500">{r[f.fieldName] || '--'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* Step: Uploading */}
          {step === 'uploading' && (
            <div className="flex flex-col items-center py-10 gap-4">
              <div className="w-10 h-10 border-3 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--theme-primary)', borderTopColor: 'transparent' }} />
              <p className="text-sm text-slate-500">Creating {rows.length} filters...</p>
            </div>
          )}

          {/* Step: Results */}
          {step === 'results' && (
            <>
              <div className="flex gap-4">
                {created > 0 && (
                  <div className="flex-1 bg-green-50 border border-green-200 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-green-600">{created}</div>
                    <div className="text-xs text-green-500">Created</div>
                  </div>
                )}
                {failed > 0 && (
                  <div className="flex-1 bg-red-50 border border-red-200 rounded-lg p-4 text-center">
                    <div className="text-2xl font-bold text-red-600">{failed}</div>
                    <div className="text-xs text-red-500">Failed</div>
                  </div>
                )}
              </div>
              <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg">
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
                    {results.map((r: any, i: number) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="px-4 py-2 text-slate-400">{r.row}</td>
                        <td className="px-4 py-2 text-slate-700">{r.name}</td>
                        <td className="px-4 py-2">
                          {r.status === 'success'
                            ? <span className="text-green-600 font-medium">Created</span>
                            : <span className="text-red-600 font-medium">Failed</span>}
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
            <button onClick={onClose} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-medium hover:bg-slate-200 transition-colors">Close</button>
          ) : (
            <>
              <button onClick={onClose} className="flex-1 py-2.5 bg-slate-100 text-slate-600 rounded-lg font-medium hover:bg-slate-200 transition-colors">Cancel</button>
              {step === 'preview' && (
                <button onClick={onSubmit} disabled={!ahu}
                  className="flex-1 py-2.5 text-white rounded-lg font-semibold disabled:opacity-50 hover:opacity-90 transition-all flex items-center justify-center gap-2"
                  style={themeButton}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                  Upload {rows.length} Filters
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
