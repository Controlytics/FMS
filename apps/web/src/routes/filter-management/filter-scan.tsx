import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '../../lib/api-client';

export function FilterScanPage() {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch all filters that have a profile assigned
  const { data: filters } = useSWR('/api/assets/instances?limit=50');

  const filterList = (filters?.data ?? []).filter((f: any) => f.filterProfileId || f.filterSet);

  const lookup = async (scanValue: string) => {
    if (!scanValue.trim()) return;
    setLoading(true);
    setError('');
    try {
      const result = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(scanValue.trim())}`);
      if (result?.asset?.id) {
        navigate(`/filters/${result.asset.id}/operate`);
        return;
      }
      setError('No filter found with this identifier');
    } catch {
      if (scanValue.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        navigate(`/filters/${scanValue}/operate`);
        return;
      }
      setError('Filter not found. Check the identifier and try again.');
    }
    setLoading(false);
  };

  useEffect(() => { inputRef.current?.focus(); }, []);

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-100">Filter Operations</h1>
        <p className="text-gray-400 mt-1">Scan identifier or select a filter to start cleaning</p>
      </div>

      {/* Scan Input */}
      <div className="bg-gray-800 border border-gray-700 rounded-2xl p-5">
        <label className="text-sm font-medium text-gray-400 mb-2 block">Scan QR / Enter Identifier</label>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            className="flex-1 bg-gray-900 border border-gray-600 rounded-xl px-4 py-3 text-gray-100 text-lg font-mono placeholder:text-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
            placeholder="Type identifier value..."
            value={value}
            onChange={e => { setValue(e.target.value); setError(''); }}
            onKeyDown={e => { if (e.key === 'Enter') lookup(value); }}
          />
          <button onClick={() => lookup(value)} disabled={loading || !value.trim()}
            className="px-6 py-3 bg-cyan-600 text-white rounded-xl font-semibold hover:bg-cyan-500 disabled:opacity-50 transition-colors">
            {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Go'}
          </button>
        </div>
        {error && <div className="mt-3 px-4 py-2 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">{error}</div>}
      </div>

      {/* Filter List */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Available Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filterList.length === 0 && (
            <div className="col-span-2 text-center py-8 text-gray-500">No filters with assigned profiles found</div>
          )}
          {filterList.map((f: any) => (
            <div
              key={f.id}
              onClick={() => navigate(`/filters/${f.id}/operate`)}
              className="bg-gray-800 border border-gray-700 rounded-xl p-4 cursor-pointer hover:border-cyan-600 hover:bg-gray-800/80 transition-all"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-100">{f.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    {f.filterSet && (
                      <span className="px-2 py-0.5 text-[10px] bg-indigo-900/60 text-indigo-300 rounded-full">
                        Set {f.filterSet.replace('SET_', '')}
                      </span>
                    )}
                    {f.currentLifecycleState && (
                      <span className="px-2 py-0.5 text-[10px] bg-gray-700 text-gray-300 rounded-full">
                        {f.currentLifecycleState.replace(/_/g, ' ')}
                      </span>
                    )}
                  </div>
                </div>
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
