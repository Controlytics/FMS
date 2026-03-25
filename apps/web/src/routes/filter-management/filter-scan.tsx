import { useState, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';

export function FilterScanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [value, setValue] = useState(searchParams.get('id') ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-lookup if id param provided (from QR scan URL)
  useEffect(() => {
    const id = searchParams.get('id');
    if (id) {
      lookup(id);
    } else {
      inputRef.current?.focus();
    }
  }, []);

  const lookup = async (scanValue: string) => {
    if (!scanValue.trim()) return;
    setLoading(true);
    setError('');

    try {
      // Try identifier lookup first
      const result = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(scanValue.trim())}`);
      if (result?.asset?.id) {
        // Check if filter has a profile assigned
        if (result.asset.filterProfileId) {
          navigate(`/filters/${result.asset.id}/operate`);
        } else {
          navigate(`/filters/${result.asset.id}/operate`);
        }
        return;
      }
      setError('No filter found with this identifier');
    } catch (e: any) {
      // Maybe it's a UUID directly
      if (scanValue.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        navigate(`/filters/${scanValue}/operate`);
        return;
      }
      setError(e.message ?? 'Filter not found. Check the identifier and try again.');
    }
    setLoading(false);
  };

  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-md space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 bg-cyan-900/30 rounded-2xl flex items-center justify-center">
            <svg className="w-10 h-10 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-100">Filter Operations</h1>
          <p className="text-gray-400 mt-2">Scan QR code or enter filter identifier to start</p>
        </div>

        {/* Scan Input */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <label className="text-sm font-medium text-gray-300">Filter Identifier / QR Code</label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-gray-100 text-lg font-mono placeholder:text-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
              placeholder="Scan or type identifier..."
              value={value}
              onChange={e => { setValue(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') lookup(value); }}
              autoFocus
            />
            <button
              onClick={() => lookup(value)}
              disabled={loading || !value.trim()}
              className="px-6 py-3 bg-cyan-600 text-white rounded-lg font-semibold hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Go'
              )}
            </button>
          </div>

          {error && (
            <div className="px-4 py-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
              {error}
            </div>
          )}

          <p className="text-xs text-gray-500">
            Scan the QR code on the filter label, or type the identifier value (e.g., barcode number, RFID tag).
            The system will look up the filter and open the operations screen.
          </p>
        </div>

        {/* Recent filters shortcut */}
        <div className="text-center">
          <button onClick={() => navigate('/cleaning-cycles')} className="text-sm text-gray-500 hover:text-cyan-400 transition-colors">
            View Cleaning Cycle History →
          </button>
        </div>
      </div>
    </div>
  );
}
