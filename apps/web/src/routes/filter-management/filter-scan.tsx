import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient } from '../../lib/api-client';

export function FilterScanPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [value, setValue] = useState(searchParams.get('id') ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const scannerRef = useRef<any>(null);
  const videoRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = searchParams.get('id');
    if (id) lookup(id);
  }, []);

  // Cleanup scanner on unmount
  useEffect(() => {
    return () => {
      if (scannerRef.current) {
        scannerRef.current.stop().catch(() => {});
        scannerRef.current = null;
      }
    };
  }, []);

  const lookup = async (scanValue: string) => {
    if (!scanValue.trim()) return;
    setLoading(true);
    setError('');

    try {
      const result = await apiClient.get<any>(`/api/assets/identifiers/lookup/${encodeURIComponent(scanValue.trim())}`);
      if (result?.asset?.id) {
        // Stop scanner before navigating
        if (scannerRef.current) {
          await scannerRef.current.stop().catch(() => {});
          scannerRef.current = null;
        }
        navigate(`/filters/${result.asset.id}/operate`);
        return;
      }
      setError('No filter found with this identifier');
    } catch (e: any) {
      if (scanValue.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        navigate(`/filters/${scanValue}/operate`);
        return;
      }
      setError(e.message ?? 'Filter not found');
    }
    setLoading(false);
  };

  const startScanner = useCallback(async () => {
    setScanning(true);
    setError('');

    try {
      const { Html5Qrcode } = await import('html5-qrcode');

      if (scannerRef.current) {
        await scannerRef.current.stop().catch(() => {});
      }

      const scanner = new Html5Qrcode('qr-reader');
      scannerRef.current = scanner;

      await scanner.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 },
          aspectRatio: 1.0,
        },
        (decodedText: string) => {
          // QR scanned successfully
          scanner.stop().then(() => {
            scannerRef.current = null;
            setScanning(false);

            // Check if it's a URL with entity ID
            const urlMatch = decodedText.match(/\/m\/([0-9a-f-]+)/i);
            if (urlMatch) {
              navigate(`/filters/${urlMatch[1]}/operate`);
            } else {
              // Treat as identifier value
              setValue(decodedText);
              lookup(decodedText);
            }
          }).catch(() => {});
        },
        () => {} // ignore scan errors (no QR in frame yet)
      );
    } catch (e: any) {
      setScanning(false);
      if (e.message?.includes('NotAllowedError') || e.message?.includes('Permission')) {
        setError('Camera permission denied. Please allow camera access and try again.');
      } else if (e.message?.includes('NotFoundError')) {
        setError('No camera found on this device.');
      } else {
        setError('Could not start camera: ' + (e.message ?? 'Unknown error'));
      }
    }
  }, [navigate]);

  const stopScanner = useCallback(async () => {
    if (scannerRef.current) {
      await scannerRef.current.stop().catch(() => {});
      scannerRef.current = null;
    }
    setScanning(false);
  }, []);

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
          <p className="text-gray-400 mt-2">Scan QR code or enter identifier</p>
        </div>

        {/* Scanner */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          {scanning ? (
            <div>
              <div id="qr-reader" ref={videoRef} className="w-full" style={{ minHeight: 300 }} />
              <div className="p-3 text-center">
                <button onClick={stopScanner} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-500 transition-colors">
                  Stop Camera
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center">
              <button
                onClick={startScanner}
                className="w-full py-4 bg-cyan-600 text-white rounded-lg font-semibold text-lg hover:bg-cyan-500 transition-colors flex items-center justify-center gap-3"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9V5a2 2 0 012-2h4M15 3h4a2 2 0 012 2v4M21 15v4a2 2 0 01-2 2h-4M9 21H5a2 2 0 01-2-2v-4" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v8M8 12h8" />
                </svg>
                Open Camera &amp; Scan QR
              </button>
            </div>
          )}
        </div>

        {/* Manual Input */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-3">
          <label className="text-sm font-medium text-gray-400">Or enter identifier manually</label>
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              className="flex-1 bg-gray-900 border border-gray-600 rounded-lg px-4 py-3 text-gray-100 text-lg font-mono placeholder:text-gray-600 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 outline-none"
              placeholder="Type identifier value..."
              value={value}
              onChange={e => { setValue(e.target.value); setError(''); }}
              onKeyDown={e => { if (e.key === 'Enter') lookup(value); }}
            />
            <button
              onClick={() => lookup(value)}
              disabled={loading || !value.trim()}
              className="px-6 py-3 bg-cyan-600 text-white rounded-lg font-semibold hover:bg-cyan-500 disabled:opacity-50 transition-colors"
            >
              {loading ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Go'}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-3 bg-red-900/30 border border-red-800 rounded-lg text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Links */}
        <div className="text-center space-y-2">
          <button onClick={() => navigate('/cleaning-cycles')} className="text-sm text-gray-500 hover:text-cyan-400 transition-colors block mx-auto">
            View Cleaning Cycle History →
          </button>
        </div>
      </div>
    </div>
  );
}
