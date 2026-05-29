import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient, api } from '../../lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';

type ListKey = 'ahuType' | 'filterType' | 'micronSize';
type FieldOptions = { ahuType: string[]; filterType: string[]; micronSize: string[] };

const DEFAULT_VALUE: FieldOptions = { ahuType: ['Process', 'Non Process'], filterType: [], micronSize: [] };

const SECTIONS: { key: ListKey; title: string; placeholder: string }[] = [
  { key: 'ahuType',    title: 'AHU Type',    placeholder: 'e.g. Process' },
  { key: 'filterType', title: 'Filter Type', placeholder: 'e.g. HEPA' },
  { key: 'micronSize', title: 'Micron Size', placeholder: 'e.g. 0.3' },
];

export function FilterFieldOptionsConfigPage() {
  const { user } = useAuth();
  const perms = (user?.permissions as string[] | undefined) ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canWrite = isSuperAdmin || perms.includes('CONFIG_UPDATE');
  const navigate = useNavigate();
  const { data: config } = useSWR('/api/config/dynamic/filter-field-options');
  const [value, setValue] = useState<FieldOptions>(DEFAULT_VALUE);
  const [draft, setDraft] = useState<Record<ListKey, string>>({ ahuType: '', filterType: '', micronSize: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reauth = useReauth();

  useEffect(() => {
    const v = config?.value as Partial<FieldOptions> | undefined;
    if (v) {
      setValue({
        ahuType: Array.isArray(v.ahuType) ? v.ahuType : [],
        filterType: Array.isArray(v.filterType) ? v.filterType : [],
        micronSize: Array.isArray(v.micronSize) ? v.micronSize : [],
      });
    }
  }, [config]);

  const addValue = (key: ListKey) => {
    const next = draft[key].trim();
    if (!next) return;
    if (value[key].some(v => v.toLowerCase() === next.toLowerCase())) {
      setError(`"${next}" already exists in ${key}`);
      return;
    }
    setValue({ ...value, [key]: [...value[key], next] });
    setDraft({ ...draft, [key]: '' });
    setError(null);
  };

  const removeValue = (key: ListKey, idx: number) => {
    setValue({ ...value, [key]: value[key].filter((_, i) => i !== idx) });
  };

  const move = (key: ListKey, idx: number, dir: -1 | 1) => {
    const list = [...value[key]];
    const j = idx + dir;
    if (j < 0 || j >= list.length) return;
    [list[idx], list[j]] = [list[j], list[idx]];
    setValue({ ...value, [key]: list });
  };

  const save = () => {
    setSaving(true);
    const body = { value };
    reauth.execute(
      'UPDATE_CONFIG_PAGE',
      async (password?: string) => {
        if (password) await api.putWithReauth('/api/config/dynamic/filter-field-options', body, password);
        else await apiClient.put('/api/config/dynamic/filter-field-options', body);
      },
      {
        onSuccess: () => {
          mutate('/api/config/dynamic/filter-field-options');
          setError(null);
          setSaving(false);
        },
        onError: (e: any) => {
          setError(e.message || 'Failed to save field options');
          setSaving(false);
        },
      },
    );
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto">
      {/* Header — visual style mirrors cleaning-reasons */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/config')}
          className="p-2 rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors shadow-sm"
          title="Back to Config">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-3 flex-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Filter Field Options</h1>
            <p className="text-sm text-slate-500">Configure the dropdown values shown on the single-filter add/edit screens</p>
          </div>
        </div>
        <button onClick={save} disabled={saving || !canWrite}
          title={!canWrite ? 'CONFIG_UPDATE permission required' : undefined}
          className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white rounded-lg hover:from-cyan-500 hover:to-blue-500 disabled:opacity-50 transition-all shadow-sm font-medium text-sm">
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4 text-lg font-medium">&times;</button>
        </div>
      )}

      {/* Three sections — one per list */}
      <div className="bg-white rounded-2xl border border-slate-200/60 shadow-xl divide-y divide-slate-100">
        {SECTIONS.map(({ key, title, placeholder }) => (
          <div key={key} className="px-5 py-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">{title}</h2>
              <span className="text-xs text-slate-400">{value[key].length} value{value[key].length === 1 ? '' : 's'}</span>
            </div>

            {value[key].length === 0 ? (
              <p className="text-sm text-slate-400 italic">No values configured yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {value[key].map((v, idx) => (
                  <li key={idx} className="flex items-center gap-2 px-3 py-2 bg-slate-50 rounded-lg">
                    <span className="flex-1 text-sm text-slate-800">{v}</span>
                    <button disabled={!canWrite || idx === 0} onClick={() => move(key, idx, -1)}
                      className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-xs">↑</button>
                    <button disabled={!canWrite || idx === value[key].length - 1} onClick={() => move(key, idx, 1)}
                      className="text-slate-400 hover:text-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-xs">↓</button>
                    <button disabled={!canWrite} onClick={() => removeValue(key, idx)}
                      className="text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-medium">Remove</button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2 pt-1">
              <input value={draft[key]} disabled={!canWrite}
                onChange={e => setDraft({ ...draft, [key]: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addValue(key); } }}
                placeholder={placeholder}
                className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent disabled:bg-slate-50" />
              <button disabled={!canWrite || !draft[key].trim()} onClick={() => addValue(key)}
                className="px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium text-sm">
                + Add
              </button>
            </div>
          </div>
        ))}
      </div>

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={() => { reauth.cancel(); setSaving(false); }}
        actionLabel="Update Filter Field Options"
      />
    </div>
  );
}
