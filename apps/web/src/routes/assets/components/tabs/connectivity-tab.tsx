import { useState } from 'react';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

export function ConnectivityTab({ entityId, entityName, formatDateTime }: { entityId: string; entityName: string; formatDateTime: (v: string | Date) => string }) {
  // Single fetch for status + credential + unsPath + topics
  const { data, isLoading, mutate } = useSWR<{
    connectivity: { status: string; lastActivityAt?: string; lastConnectedAt?: string; lastDisconnectedAt?: string; protocol?: string; sourceIp?: string };
    credential: { token: string; isActive: boolean; createdAt: string; lastUsedAt?: string; allowedIps?: string[]; maxDataRatePerMin?: number; allowedTopics?: string[] } | null;
    unsPath?: string;
    topics?: string[];
  }>(`/api/connectivity/${entityId}`, { refreshInterval: 15000 });

  const status = data?.connectivity;
  const credential = data?.credential;
  const topics = data?.topics ?? credential?.allowedTopics ?? [];
  const unsPath = data?.unsPath;

  // Fetch all snippets at once
  const { data: snippetsData, mutate: mutateSnippets } = useSWR<{ snippets: Record<string, string> }>(`/api/connectivity/${entityId}/snippets`, { refreshInterval: 15000 });
  const [snippetProto, setSnippetProto] = useState('curl');

  // Test connection
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  // Token management
  const [generatingToken, setGeneratingToken] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [showFullToken, setShowFullToken] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [editTokenValue, setEditTokenValue] = useState('');

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiClient.post<{ reachable: boolean; tokenStatus: string; protocol?: string; lastActivityAt?: string }>(`/api/connectivity/${entityId}/test`, { ts: Date.now() });
      setTestResult({
        success: res.reachable,
        message: res.reachable
          ? 'Device is online and reachable'
          : `Not reachable \u2014 Token status: ${res.tokenStatus}`,
      });
    } catch {
      setTestResult({ success: false, message: 'Test failed \u2014 could not reach connectivity endpoint' });
    } finally {
      setTesting(false);
    }
  };

  const handleGenerateToken = async () => {
    setGeneratingToken(true);
    setNewToken(null);
    try {
      const res = await apiClient.post<{ token: string; createdAt: string }>(`/api/connectivity/${entityId}/token`, {});
      setNewToken(res.token);
      setShowFullToken(true);
      mutate(); mutateSnippets();
    } catch {
      setTestResult({ success: false, message: 'Failed to generate token. Ensure you have ADMIN permissions.' });
    } finally {
      setGeneratingToken(false);
    }
  };

  const handleRevokeToken = async () => {
    if (!confirm('Are you sure you want to revoke the device token? The device will no longer be able to connect.')) return;
    setRevoking(true);
    try {
      await apiClient.delete(`/api/connectivity/${entityId}/token`);
      setNewToken(null);
      setShowFullToken(false);
      mutate(); mutateSnippets();
    } catch {
      setTestResult({ success: false, message: 'Failed to revoke token.' });
    } finally {
      setRevoking(false);
    }
  };

  const handleCopyToken = (token: string) => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveToken = async () => {
    if (!editTokenValue.trim() || editTokenValue.trim().length < 8) return;
    setGeneratingToken(true);
    try {
      const res = await apiClient.post<{ token: string; createdAt: string }>(`/api/connectivity/${entityId}/token`, { customToken: editTokenValue.trim() });
      setNewToken(res.token);
      setShowFullToken(true);
      setEditingToken(false);
      setEditTokenValue('');
      mutate(); mutateSnippets();
    } catch {
      setTestResult({ success: false, message: 'Failed to save custom token.' });
    } finally {
      setGeneratingToken(false);
    }
  };

  const statusColors: Record<string, string> = {
    ONLINE: 'bg-emerald-500',
    OFFLINE: 'bg-red-500',
    UNKNOWN: 'bg-slate-400',
  };

  if (isLoading) return <div className="text-center py-8"><svg className="w-6 h-6 animate-spin mx-auto text-cyan-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>;

  const displayToken = newToken ?? credential?.token;

  return (
    <div className="space-y-6">
      {/* Status Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <div className={cn('w-3 h-3 rounded-full', statusColors[status?.status ?? 'UNKNOWN'] ?? 'bg-slate-400')} />
          <span className="font-semibold text-slate-800">{status?.status ?? 'UNKNOWN'}</span>
          {status?.protocol && <Badge variant="outline" className="text-xs">{status.protocol}</Badge>}
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><span className="text-slate-500">Last Activity:</span><br/>{status?.lastActivityAt ? formatDateTime(status.lastActivityAt) : 'Never'}</div>
          <div><span className="text-slate-500">Source IP:</span><br/>{status?.sourceIp ?? 'N/A'}</div>
          <div><span className="text-slate-500">Last Connected:</span><br/>{status?.lastConnectedAt ? formatDateTime(status.lastConnectedAt) : 'Never'}</div>
          <div><span className="text-slate-500">Last Disconnected:</span><br/>{status?.lastDisconnectedAt ? formatDateTime(status.lastDisconnectedAt) : 'Never'}</div>
        </div>
      </div>

      {/* Device Credentials + Token Management Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Device Credentials</h4>
        {credential ? (
          <div className="space-y-3">
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28">Access Token:</span>
                <div className="flex items-center gap-2 flex-1">
                  {editingToken ? (
                    <>
                      <input
                        type="text"
                        value={editTokenValue}
                        onChange={(e) => setEditTokenValue(e.target.value)}
                        className="bg-white border border-slate-300 px-2 py-1 rounded text-xs font-mono flex-1 focus:outline-none focus:ring-2 focus:ring-blue-400"
                        placeholder="Enter custom token (min 8 chars)"
                      />
                      <button
                        onClick={handleSaveToken}
                        disabled={editTokenValue.trim().length < 8 || generatingToken}
                        className="px-2 py-1 text-xs rounded bg-blue-500 hover:bg-blue-600 text-white disabled:opacity-50"
                      >
                        {generatingToken ? 'Saving...' : 'Save'}
                      </button>
                      <button
                        onClick={() => { setEditingToken(false); setEditTokenValue(''); }}
                        className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <code className="bg-slate-100 px-2 py-1 rounded text-xs font-mono flex-1 truncate">
                        {showFullToken && displayToken
                          ? displayToken
                          : displayToken
                            ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' + displayToken.slice(-6)
                            : 'N/A'}
                      </code>
                      {displayToken && (
                        <>
                          <button
                            onClick={() => setShowFullToken(!showFullToken)}
                            className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                            title={showFullToken ? 'Hide token' : 'Show full token'}
                          >
                            {showFullToken ? 'Hide' : 'Show'}
                          </button>
                          <button
                            onClick={() => handleCopyToken(displayToken)}
                            className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                            title="Copy token"
                          >
                            {copied ? 'Copied!' : 'Copy'}
                          </button>
                          <button
                            onClick={() => { setEditingToken(true); setEditTokenValue(displayToken); }}
                            className="px-2 py-1 text-xs rounded bg-slate-100 hover:bg-slate-200 text-slate-600"
                            title="Edit token"
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28">Status:</span>
                <Badge variant={credential.isActive ? 'default' : 'secondary'} className="text-xs">{credential.isActive ? 'ACTIVE' : 'REVOKED'}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28">Rate Limit:</span>
                <span>{credential.maxDataRatePerMin ?? 600} msg/min</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 w-28">Created:</span>
                <span>{credential.createdAt ? formatDateTime(credential.createdAt) : 'N/A'}</span>
              </div>
            </div>
            {newToken && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>New token generated.</strong> Copy it now — it won't be shown in full again.
              </div>
            )}
            <div className="flex gap-2 pt-1">
              <Button onClick={handleGenerateToken} disabled={generatingToken} size="sm" variant="outline">
                {generatingToken ? 'Generating...' : 'Regenerate Token'}
              </Button>
              {credential.isActive && (
                <Button onClick={handleRevokeToken} disabled={revoking} size="sm" variant="outline" className="text-red-600 hover:text-red-700 hover:bg-red-50">
                  {revoking ? 'Revoking...' : 'Revoke Token'}
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500">No device credentials configured. Generate a token to enable device connectivity.</p>
            <Button onClick={handleGenerateToken} disabled={generatingToken} size="sm" className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white">
              {generatingToken ? 'Generating...' : 'Generate Token'}
            </Button>
            {newToken && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                <strong>Token generated!</strong> Copy it now — it won't be shown in full again.
                <div className="mt-2 flex items-center gap-2">
                  <code className="bg-white px-2 py-1 rounded text-xs font-mono flex-1 break-all border">{newToken}</code>
                  <button
                    onClick={() => handleCopyToken(newToken)}
                    className="px-3 py-1 text-xs rounded bg-amber-200 hover:bg-amber-300 text-amber-900 whitespace-nowrap"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* UNS Topics Card */}
      {topics.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h4 className="font-semibold text-slate-800 mb-3">MQTT Topics</h4>
          {unsPath && (
            <div className="mb-3 text-sm">
              <span className="text-slate-500">UNS Path:</span>{' '}
              <code className="bg-slate-100 px-2 py-0.5 rounded text-xs font-mono">{unsPath}</code>
            </div>
          )}
          <div className="space-y-1.5">
            {topics.map((topic: string, idx: number) => {
              const suffix = topic.split('/').pop() ?? '';
              const purposeMap: Record<string, string> = {
                telemetry: 'Send sensor/measurement data',
                attributes: 'Send device attributes & metadata',
                events: 'Send device events & alerts',
                'rpc/request': 'Receive RPC commands from server',
                'rpc/response': 'Send RPC command responses',
              };
              const topicSuffix = topic.includes('/rpc/') ? topic.split('/').slice(-2).join('/') : suffix;
              return (
                <div key={idx} className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-2">
                  <code className="text-xs font-mono text-slate-700 flex-1">{topic}</code>
                  <span className="text-[10px] text-slate-400 whitespace-nowrap">{purposeMap[topicSuffix] ?? ''}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Test Connection */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Test Connection</h4>
        <Button onClick={handleTest} disabled={testing} className="bg-gradient-to-r from-cyan-500 to-blue-600 text-white">
          {testing ? 'Testing...' : 'Test Connection'}
        </Button>
        {testResult && (
          <div className={cn('mt-3 p-3 rounded-lg text-sm', testResult.success ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
            {testResult.message}
          </div>
        )}
      </div>

      {/* Code Snippets */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h4 className="font-semibold text-slate-800 mb-3">Code Snippets</h4>
        <div className="flex gap-2 mb-3">
          {['curl', 'python', 'nodejs', 'arduino'].map(p => (
            <button key={p} onClick={() => setSnippetProto(p)} className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-colors', snippetProto === p ? 'bg-cyan-100 text-cyan-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200')}>
              {p}
            </button>
          ))}
        </div>
        <pre className="bg-slate-900 text-slate-100 rounded-lg p-4 text-xs overflow-x-auto max-h-64">
          {snippetsData?.snippets?.[snippetProto] ?? 'Loading...'}
        </pre>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Alarms Tab
   ═══════════════════════════════════════════════════════════ */
