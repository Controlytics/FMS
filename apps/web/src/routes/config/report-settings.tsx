import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import type { ReportConfig } from '@/hooks/use-report-config';

const DEFAULTS: ReportConfig = {
  showHeader: true,
  showLogo: true,
  showCompanyName: true,
  showReportTitle: true,
  showDateTime: true,
  showGeneratedBy: true,
  customHeaderText: '',
  showFooter: true,
  showPageNumbers: true,
  showTotalRecords: true,
  customFooterText: '',
  recordsPerPage: 25,
  compactMode: false,
};

function Toggle({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-3 cursor-pointer group">
      <div>
        <p className="text-sm font-medium text-slate-700 group-hover:text-slate-900">{label}</p>
        {description && <p className="text-xs text-slate-400 mt-0.5">{description}</p>}
      </div>
      <button type="button" onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors ${checked ? '' : 'bg-slate-300'}`}
        style={checked ? { backgroundColor: 'var(--theme-primary)' } : undefined}>
        <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-md transition-transform ${checked ? 'translate-x-5' : ''}`} />
      </button>
    </label>
  );
}

export function ReportSettingsPage() {
  // 2026-05-26 audit fix (PA-FE-1): gate Save on CONFIG_UPDATE.
  const { user } = useAuth();
  const perms = (user?.permissions as string[] | undefined) ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canWrite = isSuperAdmin || perms.includes('CONFIG_UPDATE');
  const { toast } = useToast();
  const { data, mutate } = useSWR('/api/config/report-settings/current', { revalidateOnMount: true });
  const [config, setConfig] = useState<ReportConfig>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data && Object.keys(data).length > 0) {
      setConfig({ ...DEFAULTS, ...data });
    }
  }, [data]);

  const update = (key: keyof ReportConfig, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.put('/api/config/dynamic/report-settings', config);
      mutate();
      setDirty(false);
      toast.success('Saved', 'Report settings updated');
    } catch (e: any) {
      toast.error('Error', e.message || 'Failed to save');
    }
    setSaving(false);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-2xl p-6 text-white shadow-2xl"
        style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/config" className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 transition-all border border-white/10">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </Link>
            <div className="p-3 rounded-xl bg-white/20 shadow-lg">
              <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold">Report Settings</h1>
              <p className="text-white/70 text-sm">Configure how reports display across the application</p>
            </div>
          </div>
          {dirty && (
            <button onClick={handleSave} disabled={saving || !canWrite} title={!canWrite ? 'CONFIG_UPDATE permission required' : undefined}
              className="px-5 py-2.5 bg-white text-slate-800 rounded-xl text-sm font-semibold shadow-lg hover:bg-slate-50 disabled:opacity-50 transition-all">
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Header Settings */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }} />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl text-white shadow-lg"
                style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Report Header</h3>
                <p className="text-xs text-slate-500">What to show at the top of every report</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              <Toggle label="Show Header" description="Display the report header section" checked={config.showHeader} onChange={v => update('showHeader', v)} />
              <Toggle label="Show Logo" description="Display company logo in the header" checked={config.showLogo} onChange={v => update('showLogo', v)} />
              <Toggle label="Show Company Name" description="Display the company name from branding" checked={config.showCompanyName} onChange={v => update('showCompanyName', v)} />
              <Toggle label="Show Report Title" description="Display the report name (e.g. Audit Trail)" checked={config.showReportTitle} onChange={v => update('showReportTitle', v)} />
              <Toggle label="Show Date & Time" description="Show when the report was generated" checked={config.showDateTime} onChange={v => update('showDateTime', v)} />
              <Toggle label="Show Generated By" description="Show the name of the user viewing the report" checked={config.showGeneratedBy} onChange={v => update('showGeneratedBy', v)} />
            </div>
            <div className="mt-4">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Custom Header Text</label>
              <input type="text" value={config.customHeaderText} onChange={e => update('customHeaderText', e.target.value)}
                placeholder="e.g. CONFIDENTIAL â€” Internal Use Only"
                className="w-full mt-1.5 px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--theme-focus-ring)' } as React.CSSProperties} />
            </div>
          </div>
        </div>

        {/* Footer Settings */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }} />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl text-white shadow-lg"
                style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Report Footer</h3>
                <p className="text-xs text-slate-500">What to show at the bottom of every report</p>
              </div>
            </div>
            <div className="divide-y divide-slate-100">
              <Toggle label="Show Footer" description="Display the report footer section" checked={config.showFooter} onChange={v => update('showFooter', v)} />
              <Toggle label="Show Page Numbers" description="Display Page X of Y" checked={config.showPageNumbers} onChange={v => update('showPageNumbers', v)} />
              <Toggle label="Show Total Records" description="Display total record count" checked={config.showTotalRecords} onChange={v => update('showTotalRecords', v)} />
            </div>
            <div className="mt-4">
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Custom Footer Text</label>
              <input type="text" value={config.customFooterText} onChange={e => update('customFooterText', e.target.value)}
                placeholder="e.g. 21 CFR Part 11 Compliant Report"
                className="w-full mt-1.5 px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-700 focus:outline-none focus:ring-2"
                style={{ '--tw-ring-color': 'var(--theme-focus-ring)' } as React.CSSProperties} />
            </div>
          </div>
        </div>

        {/* Layout Settings */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }} />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl text-white shadow-lg"
                style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Layout & Display</h3>
                <p className="text-xs text-slate-500">Control how data is displayed in reports</p>
              </div>
            </div>
            <div className="space-y-5">
              <div>
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wider">Records Per Page</label>
                <p className="text-xs text-slate-400 mt-0.5 mb-2">How many rows to show per page on report tables</p>
                <div className="flex items-center gap-2">
                  {[10, 25, 50, 100].map(n => (
                    <button key={n} type="button" onClick={() => update('recordsPerPage', n)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${config.recordsPerPage === n ? 'text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                      style={config.recordsPerPage === n ? { backgroundColor: 'var(--theme-primary)' } : undefined}>
                      {n}
                    </button>
                  ))}
                  <input type="number" value={config.recordsPerPage} min={5} max={500}
                    onChange={e => update('recordsPerPage', Math.max(5, Math.min(500, parseInt(e.target.value) || 25)))}
                    className="w-20 px-3 py-2 border border-slate-200 rounded-lg text-sm text-center text-slate-700 focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': 'var(--theme-focus-ring)' } as React.CSSProperties} />
                </div>
              </div>
              <div className="border-t border-slate-100 pt-4">
                <Toggle label="Compact Mode" description="Reduce padding and font size for more data per screen" checked={config.compactMode} onChange={v => update('compactMode', v)} />
              </div>
            </div>
          </div>
        </div>

        {/* Live Preview */}
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="h-1" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }} />
          <div className="p-6">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl text-white shadow-lg"
                style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
              </div>
              <div>
                <h3 className="font-bold text-slate-800">Preview</h3>
                <p className="text-xs text-slate-500">How reports will look with current settings</p>
              </div>
            </div>

            {/* Mini preview */}
            <div className="border border-slate-200 rounded-xl overflow-hidden text-[10px] bg-slate-50">
              {config.showHeader && (
                <div className="bg-white px-3 py-2 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {config.showLogo && <div className="w-5 h-5 rounded flex items-center justify-center text-white text-[7px] font-bold" style={{ background: 'linear-gradient(to bottom right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>DL</div>}
                      <div>
                        {config.showCompanyName && <p className="text-[8px] text-slate-400 font-medium">Company Name</p>}
                        {config.showReportTitle && <p className="text-[10px] font-bold text-slate-700">Sample Report</p>}
                      </div>
                    </div>
                    <div className="text-right text-[8px] text-slate-400">
                      {config.showDateTime && <p>14-04-2026 10:30 AM</p>}
                      {config.showGeneratedBy && <p>By: Admin</p>}
                    </div>
                  </div>
                  <div className="h-px mt-1.5 rounded-full" style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }} />
                </div>
              )}
              <div className="px-3 py-2">
                <div className="space-y-1">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex gap-2">
                      <div className="h-2 bg-slate-200 rounded w-8" />
                      <div className="h-2 bg-slate-200 rounded flex-1" />
                      <div className="h-2 bg-slate-200 rounded w-12" />
                      <div className="h-2 bg-slate-200 rounded w-10" />
                    </div>
                  ))}
                </div>
              </div>
              {config.showFooter && (
                <div className="bg-white px-3 py-1.5 border-t border-slate-200 flex justify-between text-[8px] text-slate-400">
                  <span>{config.customFooterText || 'Footer text'} {config.showTotalRecords && '| 150 records'}</span>
                  {config.showPageNumbers && <span>Page 1 of 6</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Save Bar */}
      {dirty && (
        <div className="fixed bottom-6 right-6 z-40">
          <button onClick={handleSave} disabled={saving || !canWrite} title={!canWrite ? 'CONFIG_UPDATE permission required' : undefined}
            className="px-6 py-3 text-white rounded-xl text-sm font-semibold shadow-2xl disabled:opacity-50 transition-all flex items-center gap-2"
            style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}
