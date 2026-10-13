import { useState } from 'react';
import { getApiBase, setApiBase, normalizeServerUrl } from '@/lib/api-base';
import { findServer, rememberServerId } from '@/lib/server-discovery';

const isNative = () => !!(window as any).Capacitor?.isNativePlatform?.();

const FIND_REASON: Record<string, string> = {
  'not-native': 'Finding the server only works in the tablet app.',
  'nothing-open': 'No FMS server answered on this network. Check the server PC is on and connected to the same Wi-Fi.',
  'no-match': 'A server answered, but it is not the FMS server this tablet was using. Type the address shown on the FMS server PC.',
  'ambiguous': 'More than one FMS server answered. Type the address shown on the FMS server PC.',
  'no-address': 'Type the address shown on the FMS server PC.',
};

// First-launch (and re-configure) screen where the tablet operator sets the
// server address. Validates with a /api/health ping before saving so a typo or
// an untrusted cert surfaces here instead of a broken login. See spec §3.3.
export default function ServerConfigPage() {
  const [url, setUrl] = useState(getApiBase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [finding, setFinding] = useState(false);

  // 2026-10-10: search the local network for the server (lib/server-discovery.ts).
  // Fills the box; the operator still presses Connect, which re-checks it.
  async function find() {
    setError('');
    setFinding(true);
    try {
      const r = await findServer({ manual: true, base: url.trim() || undefined });
      if (r.found) setUrl(r.found);
      else setError(FIND_REASON[r.reason ?? 'nothing-open']);
    } catch (e: any) {
      setError(`Search failed: ${e?.message ?? e}`);
    } finally {
      setFinding(false);
    }
  }

  async function connect() {
    setError('');
    let norm: string;
    try { norm = normalizeServerUrl(url); }
    catch (e: any) { setError(e.message); return; }
    setBusy(true);
    try {
      const res = await fetch(`${norm}/api/health`, { method: 'GET' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      // Optional: an older server sends no serverId, and reading it must never
      // turn a successful connect into a failure.
      try { rememberServerId((await res.json())?.serverId); } catch { /* no JSON body: nothing to remember */ }
      setApiBase(norm);
      window.location.href = '/m/login';
    } catch {
      setError(
        `Couldn't reach the server at ${norm}. Check the address, that the ` +
        `server is turned on, and that you installed the DigiLog certificate on this tablet.`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-4">
        <h1 className="text-lg font-semibold text-slate-800">Connect to FMS server</h1>
        <p className="text-sm text-slate-500">Enter the address shown on the FMS server PC.</p>
        <input
          type="url"
          inputMode="url"
          autoCapitalize="none"
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-slate-800"
          placeholder="https://192.168.1.55:3000"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          disabled={busy}
          onClick={connect}
          className="w-full rounded-lg bg-cyan-600 text-white py-2 font-medium disabled:opacity-60"
        >
          {busy ? 'Connecting...' : 'Connect'}
        </button>
        {isNative() && (
          <button
            type="button"
            disabled={busy || finding}
            onClick={find}
            className="w-full rounded-lg border border-slate-200 bg-white text-slate-700 py-2 font-medium disabled:opacity-60"
          >
            {finding ? 'Searching the network...' : 'Find server'}
          </button>
        )}
      </div>
    </div>
  );
}
