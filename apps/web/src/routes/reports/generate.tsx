import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '../../lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

export function ReportGeneratePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const reauth = useReauth();

  const [step, setStep] = useState(1);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [reportName, setReportName] = useState('');
  const [entitySlots, setEntitySlots] = useState<Record<string, string>>({});
  const [timeRangeStart, setTimeRangeStart] = useState('');
  const [timeRangeEnd, setTimeRangeEnd] = useState('');
  const [generating, setGenerating] = useState(false);

  const { data: templates } = useSWR('/api/report-templates?status=ACTIVE&limit=100');
  const { data: templateDetail } = useSWR(selectedTemplate ? `/api/report-templates/${selectedTemplate}` : null);
  const templateConfig = templateDetail?.latestConfig;

  const handleGenerate = () => {
    if (!selectedTemplate) return;
    reauth.execute('GENERATE_REPORT', async (password?: string) => {
      setGenerating(true);
      try {
        const body = {
          templateId: selectedTemplate,
          entitySlots,
          timeRangeStart: timeRangeStart || undefined,
          timeRangeEnd: timeRangeEnd || undefined,
          name: reportName || undefined,
        };
        let result;
        if (password) result = await apiClient.postWithReauth('/api/reports/generate', body, password);
        else result = await apiClient.post('/api/reports/generate', body);
        toast.success('Report generated');
        navigate(`/reports/${(result as any).id}`);
      } catch (err: any) {
        toast.error('Generation failed', err.message || 'Could not generate report');
        throw err;
      } finally {
        setGenerating(false);
      }
    });
  };

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/reports')} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h1 className="text-2xl font-bold text-slate-800">Generate Report</h1>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3].map(s => (
          <div key={s} className="flex items-center gap-2 flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${step >= s ? 'text-white' : 'text-slate-400 bg-slate-100'}`}
              style={step >= s ? { backgroundColor: 'var(--theme-primary)' } : undefined}>
              {s}
            </div>
            <span className={`text-sm font-medium ${step >= s ? 'text-slate-700' : 'text-slate-400'}`}>
              {s === 1 ? 'Select Template' : s === 2 ? 'Configure' : 'Generate'}
            </span>
            {s < 3 && <div className={`flex-1 h-0.5 ${step > s ? 'bg-blue-400' : 'bg-slate-200'}`} style={step > s ? { backgroundColor: 'var(--theme-primary)' } : undefined} />}
          </div>
        ))}
      </div>

      {/* Step 1: Select Template */}
      {step === 1 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Choose a report template</h2>
          {(templates?.data ?? []).map((t: any) => (
            <button key={t.id} onClick={() => { setSelectedTemplate(t.id); setStep(2); }}
              className={`w-full p-4 border-2 rounded-xl text-left transition-colors ${selectedTemplate === t.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <div className="font-semibold text-slate-800">{t.name}</div>
              {t.description && <div className="text-sm text-slate-500 mt-1">{t.description}</div>}
              <div className="text-xs text-slate-400 mt-1">Version {t.currentVersion}</div>
            </button>
          ))}
          {(templates?.data ?? []).length === 0 && (
            <div className="text-center py-12 text-slate-400">
              <p>No active templates available.</p>
              <button onClick={() => navigate('/report-templates')} className="mt-2 text-sm font-medium text-theme-primary">
                Create a template first
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step 2: Configure */}
      {step === 2 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-slate-800">Configure report</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Report Name (optional)</label>
            <input value={reportName} onChange={e => setReportName(e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:ring-2"
              style={{ '--tw-ring-color': 'color-mix(in srgb, var(--theme-primary) 20%, transparent)' } as React.CSSProperties}
              placeholder="Leave blank for auto-generated name" />
          </div>

          {/* Entity Slots */}
          {(templateConfig?.entitySlots ?? []).length > 0 && (
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">Entity Slots</label>
              <div className="space-y-3">
                {(templateConfig?.entitySlots ?? []).map((slot: any) => (
                  <div key={slot.name}>
                    <label className="block text-sm font-medium text-slate-600 mb-1">{slot.label || slot.name}</label>
                    <input value={entitySlots[slot.name] ?? ''} placeholder={`Enter ${slot.type} ID`}
                      onChange={e => setEntitySlots(prev => ({ ...prev, [slot.name]: e.target.value }))}
                      className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Time Range */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Time Range</label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">From</label>
                <input type="datetime-local" value={timeRangeStart} onChange={e => setTimeRangeStart(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">To</label>
                <input type="datetime-local" value={timeRangeEnd} onChange={e => setTimeRangeEnd(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none" />
              </div>
            </div>
          </div>

          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(1)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl">Back</button>
            <button onClick={() => setStep(3)} className="px-5 py-2 text-sm font-semibold text-white rounded-xl shadow-md"
              style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
              Next
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Generate */}
      {step === 3 && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold text-slate-800">Review & Generate</h2>
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
            <div className="flex justify-between text-sm"><span className="text-slate-500">Template</span><span className="font-medium text-slate-800">{templateDetail?.name}</span></div>
            {reportName && <div className="flex justify-between text-sm"><span className="text-slate-500">Report Name</span><span className="font-medium text-slate-800">{reportName}</span></div>}
            {timeRangeStart && <div className="flex justify-between text-sm"><span className="text-slate-500">From</span><span className="font-medium text-slate-800">{new Date(timeRangeStart).toLocaleString()}</span></div>}
            {timeRangeEnd && <div className="flex justify-between text-sm"><span className="text-slate-500">To</span><span className="font-medium text-slate-800">{new Date(timeRangeEnd).toLocaleString()}</span></div>}
            {Object.entries(entitySlots).filter(([, v]) => v).map(([k, v]) => (
              <div key={k} className="flex justify-between text-sm"><span className="text-slate-500">{k}</span><span className="font-mono text-xs text-slate-600">{v}</span></div>
            ))}
          </div>

          <div className="flex justify-between pt-4">
            <button onClick={() => setStep(2)} className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-xl">Back</button>
            <button onClick={handleGenerate} disabled={generating}
              className="px-6 py-2.5 text-sm font-semibold text-white rounded-xl shadow-md disabled:opacity-50"
              style={{ background: 'linear-gradient(to right, var(--theme-gradient-from), var(--theme-gradient-to))' }}>
              {generating ? 'Generating...' : 'Generate Report'}
            </button>
          </div>
        </div>
      )}

      <ReauthDialog open={reauth.isOpen} password={reauth.password} error={reauth.error} isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword} onConfirm={reauth.confirm} onCancel={reauth.cancel} />
    </div>
  );
}
