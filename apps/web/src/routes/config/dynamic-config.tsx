import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/hooks/use-auth';
import { useReauth } from '@/hooks/use-reauth';
import { ReauthDialog } from '@/components/reauth-dialog';
import { apiClient } from '@/lib/api-client';

interface SettingDef {
  key: string;
  type: string;
  label: string;
  description?: string;
  required?: boolean;
  default?: any;
  placeholder?: string;
  group?: string;
  options?: { value: string | number; label: string }[];
  dynamicOptionsSource?: string;
  min?: number;
  max?: number;
  maskedInApi?: boolean;
  visibleWhen?: { field: string; value: any; operator?: string };
  helpText?: string;
  width?: 'full' | 'half';
}

interface ManifestEntry {
  moduleKey: string;
  moduleName: string;
  description: string;
  icon: string;
  category: string;
  requiresReauth: boolean;
  /** The re-auth row the API enforces on this page's save (2026-09-24). */
  reauthAction?: string | null;
  hasCustomPage: boolean;
  settings: SettingDef[];
}

function isVisible(setting: SettingDef, values: Record<string, any>): boolean {
  if (!setting.visibleWhen) return true;
  const { field, value, operator = 'eq' } = setting.visibleWhen;
  const actual = values[field];
  if (operator === 'eq') return actual === value;
  if (operator === 'neq') return actual !== value;
  if (operator === 'in') return Array.isArray(value) && value.includes(actual);
  return true;
}

/**
 * Order-insensitive serialisation of a settings object, used to decide whether
 * the form differs from what the server holds. Object keys are sorted (a key
 * the server never stored lands at the end of the local object) and array
 * members are sorted (the multiselect editor removes-and-re-appends on toggle).
 * Everything else is compared by value.
 */
function normalise(values: Record<string, any>): string {
  const sortValue = (v: any): any => {
    if (Array.isArray(v)) return [...v].map(sortValue).sort();
    if (v && typeof v === 'object') {
      return Object.keys(v).sort().reduce((acc: Record<string, any>, k) => {
        acc[k] = sortValue(v[k]);
        return acc;
      }, {});
    }
    return v;
  };
  return JSON.stringify(sortValue(values));
}

function groupSettings(settings: SettingDef[]) {
  const map = new Map<string, SettingDef[]>();
  for (const s of settings) {
    const group = s.group ?? 'General';
    if (!map.has(group)) map.set(group, []);
    map.get(group)!.push(s);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
}

export function DynamicConfigPage() {
  const { moduleKey } = useParams<{ moduleKey: string }>();
  const navigate = useNavigate();
  // 2026-05-26 audit fix (PA-FE-1): gate Save on CONFIG_UPDATE.
  // dynamic-config.tsx renders every module's settings page that
  // doesn't have a hardcoded route, so this gate covers many config
  // surfaces with one change.
  const { user } = useAuth();
  const perms = (user?.permissions as string[] | undefined) ?? [];
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const canWrite = isSuperAdmin || perms.includes('CONFIG_UPDATE');
  const reauth = useReauth();

  const { data: manifest } = useSWR<ManifestEntry[]>(
    '/api/config/registry/manifest',
    { revalidateOnMount: true, dedupingInterval: 5000 }
  );
  const moduleDef = manifest?.find(m => m.moduleKey === moduleKey);

  const { data: savedValues, error: savedValuesError, mutate } = useSWR(
    moduleKey ? `/api/config/dynamic/${moduleKey}` : null,
    { revalidateOnMount: true, dedupingInterval: 0 }
  );

  const [values, setValues] = useState<Record<string, any>>({});
  // Snapshot of the values as last seeded from the server, used to gate the
  // Save button. Snapshotted (rather than compared against `savedValues`
  // directly) because the editors coerce as you type — number fields hold ''
  // for empty and the json/textarea field stores parsed-or-raw — so only a
  // baseline taken through the same seeding path compares reliably.
  // `null` means "this module has no saved row yet", in which case Save stays
  // enabled so an admin can persist the def defaults on a first visit.
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  // Cache of dynamically loaded options, keyed by dynamicOptionsSource URL.
  const [dynamicOptions, setDynamicOptions] = useState<Record<string, { value: string | number; label: string }[]>>({});

  // Fetch options for any settings that declare a dynamicOptionsSource. Each
  // unique URL is fetched once per module view. The response is expected to
  // be an array of objects; field mapping is resilient:
  //   value ← item.value ?? item.name ?? item.id
  //   label ← item.label ?? item.displayName ?? item.name ?? item.id
  useEffect(() => {
    if (!moduleDef) return;
    const urls = Array.from(new Set(
      moduleDef.settings
        .map(s => s.dynamicOptionsSource)
        .filter((u): u is string => !!u && !(u in dynamicOptions))
    ));
    if (urls.length === 0) return;
    let cancelled = false;
    (async () => {
      const results: Record<string, { value: string | number; label: string }[]> = {};
      for (const url of urls) {
        try {
          const data = await apiClient.get<any>(url);
          const list = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
          results[url] = list.map((item: any) => ({
            value: item.value ?? item.name ?? item.id,
            label: item.label ?? item.displayName ?? item.name ?? String(item.id ?? ''),
          }));
        } catch {
          results[url] = [];
        }
      }
      if (!cancelled) setDynamicOptions(prev => ({ ...prev, ...results }));
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleDef]);

  useEffect(() => {
    if (savedValues) {
      setValues(savedValues);
      setBaseline(normalise(savedValues));
    } else if (moduleDef) {
      const defaults: Record<string, any> = {};
      for (const s of moduleDef.settings) {
        if (s.default !== undefined) defaults[s.key] = s.default;
      }
      setValues(defaults);
      setBaseline(null);
    }
  }, [savedValues, moduleDef]);

  if (!moduleDef) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-slate-800">Configuration Not Found</h2>
          <p className="text-sm text-slate-500">Module "{moduleKey}" is not registered.</p>
          <Button variant="outline" onClick={() => navigate('/config')}>Back to Settings</Button>
        </div>
      </div>
    );
  }

  // D4(b): if the GET returned a permission error (401/403), show a clear
  // message instead of a blank form. SWR puts the thrown error object here;
  // api-client.ts attaches `status` on structured errors and throws objects
  // with `error` field (e.g. 'UNAUTHORIZED', 'FORBIDDEN') for 4xx responses.
  if (savedValuesError) {
    const isPermissionError =
      savedValuesError?.status === 401 ||
      savedValuesError?.status === 403 ||
      savedValuesError?.error === 'UNAUTHORIZED' ||
      savedValuesError?.error === 'FORBIDDEN' ||
      savedValuesError?.error === 'INSUFFICIENT_PERMISSIONS';
    if (isPermissionError) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="text-center space-y-3">
            <h2 className="text-lg font-semibold text-slate-800">{moduleDef.moduleName}</h2>
            <p className="text-sm text-slate-500">Insufficient permissions to view this configuration.</p>
            <Button variant="outline" onClick={() => navigate('/config')}>Back to Settings</Button>
          </div>
        </div>
      );
    }
  }

  if (moduleDef.settings.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center space-y-3">
          <h2 className="text-lg font-semibold text-slate-800">{moduleDef.moduleName}</h2>
          <p className="text-sm text-slate-500">This module uses a custom configuration page.</p>
          <Button variant="outline" onClick={() => navigate('/config')}>Back to Settings</Button>
        </div>
      </div>
    );
  }

  // Save is enabled only after an actual change (or when the module has never
  // been saved — see `baseline` above). `handleSave` calls `mutate()` inside
  // the reauth-wrapped success path, which reseeds the effect and advances the
  // baseline, so the button disables again with no reload. A cancelled reauth
  // or a 4xx never revalidates, so the edits stay dirty and re-savable.
  //
  // `normalise` sorts keys and array members before stringifying. Keys because
  // a value the server never stored is appended to the end of the object;
  // arrays because the multiselect editor removes-and-re-appends on toggle, so
  // unchecking a box and re-checking it would otherwise register as a change.
  const dirty = baseline === null || normalise(values) !== baseline;

  const handleChange = (key: string, value: any) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setSuccess('');
    setError('');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      // 2026-05-26 audit fix (PA-CLEANUP-2): pre-fix this constructed
      // `UPDATE_${KEY}` from the URL path. For `session` that produced
      // `UPDATE_SESSION` — which is NOT declared in shared types.
      // The declared key is `UPDATE_SESSION_CONFIG`. Maintain a small
      // override map for the keys that don't follow the suffix-strip
      // convention; the BE hardcoded fallback in config/routes.ts:99
      // already enforces reauth, so the failure mode pre-fix was that
      // operators got a retroactive 401 instead of a clean dialog.
      const reauthActionByModuleKey: Record<string, string> = {
        session: 'UPDATE_SESSION_CONFIG',
        datetime: 'UPDATE_DATETIME_CONFIG',
      };
      // 2026-09-24: the manifest now says which row the API enforces
      // (`def.reauthAction`, e.g. the UPDATE_CONFIG_PAGE umbrella), so the
      // dialog opens up front instead of on a retroactive 401.
      const action =
        moduleDef?.reauthAction ??
        reauthActionByModuleKey[moduleKey!] ??
        `UPDATE_${moduleKey!.toUpperCase().replace(/-/g, '_')}`;
      await reauth.execute(action, async (password?) => {
        const body = { ...values };
        if (password) (body as any)._currentPassword = password;
        await apiClient.put(`/api/config/dynamic/${moduleKey}`, body);
        mutate();
      }, {
        onSuccess: () => {
          setSuccess('Settings saved successfully');
          setSaving(false);
        },
        onError: (err: any) => {
          setError(err?.message || 'Failed to save');
          setSaving(false);
        },
      });
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
      setSaving(false);
    }
  };

  const groups = groupSettings(moduleDef.settings);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{moduleDef.moduleName}</h1>
          <p className="text-sm text-slate-500 mt-1">{moduleDef.description}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate('/config')}>
          Back to Settings
        </Button>
      </div>

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">
          {success}
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      {groups.map(group => (
        <Card key={group.name}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{group.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {group.items
              .filter(s => isVisible(s, values))
              .map(setting => (
                <div key={setting.key} className={setting.width === 'half' ? 'w-1/2' : 'w-full'}>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {setting.label}
                    {setting.required && <span className="text-red-500 ml-1">*</span>}
                  </label>

                  {setting.type === 'boolean' ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={values[setting.key] ?? false}
                        onChange={e => handleChange(setting.key, e.target.checked)}
                        className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-sm text-slate-600">{setting.description || `Enable ${setting.label.toLowerCase()}`}</span>
                    </label>
                  ) : setting.type === 'select' ? (
                    (() => {
                      const liveOptions = setting.dynamicOptionsSource ? (dynamicOptions[setting.dynamicOptionsSource] ?? []) : [];
                      const staticOptions = setting.options ?? [];
                      const combined = [...staticOptions, ...liveOptions];
                      // Deduplicate by value (string-compared), keeping the first occurrence
                      const seen = new Set<string>();
                      const finalOptions = combined.filter(o => {
                        const k = String(o.value);
                        if (seen.has(k)) return false;
                        seen.add(k);
                        return true;
                      });
                      const currentValue = values[setting.key] ?? '';
                      const loading = setting.dynamicOptionsSource && !(setting.dynamicOptionsSource in dynamicOptions);
                      return (
                        <select
                          value={currentValue}
                          onChange={e => handleChange(setting.key, e.target.value)}
                          disabled={!!loading}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60 disabled:cursor-wait"
                        >
                          <option value="">{loading ? 'Loading…' : 'Select...'}</option>
                          {!loading && finalOptions.length === 0 && (
                            <option value="" disabled>No options available</option>
                          )}
                          {finalOptions.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                          {/* If the saved value isn't in the loaded list, still render it so the user sees what's stored */}
                          {currentValue && !finalOptions.some(o => String(o.value) === String(currentValue)) && !loading && (
                            <option key={`stale-${currentValue}`} value={currentValue}>{currentValue} (not found)</option>
                          )}
                        </select>
                      );
                    })()
                  ) : setting.type === 'multiselect' ? (
                    (() => {
                      const liveOptions = setting.dynamicOptionsSource ? (dynamicOptions[setting.dynamicOptionsSource] ?? []) : [];
                      const staticOptions = setting.options ?? [];
                      const combined = [...staticOptions, ...liveOptions];
                      const seen = new Set<string>();
                      const finalOptions = combined.filter(o => { const k = String(o.value); if (seen.has(k)) return false; seen.add(k); return true; });
                      const selected: string[] = Array.isArray(values[setting.key]) ? values[setting.key] : [];
                      const loading = setting.dynamicOptionsSource && !(setting.dynamicOptionsSource in dynamicOptions);
                      const toggle = (val: string) => {
                        const next = selected.includes(val) ? selected.filter(v => v !== val) : [...selected, val];
                        handleChange(setting.key, next);
                      };
                      return (
                        <div className="space-y-1.5 border border-slate-200 rounded-lg p-3">
                          {loading && <p className="text-sm text-slate-400">Loading…</p>}
                          {!loading && finalOptions.length === 0 && <p className="text-sm text-slate-400">No options available</p>}
                          {finalOptions.map(opt => (
                            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selected.includes(String(opt.value))}
                                onChange={() => toggle(String(opt.value))}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                              />
                              <span className="text-sm text-slate-600">{opt.label}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })()
                  ) : setting.type === 'number' ? (
                    <input
                      type="number"
                      value={values[setting.key] ?? ''}
                      min={setting.min}
                      max={setting.max}
                      onChange={e => handleChange(setting.key, e.target.value ? Number(e.target.value) : '')}
                      placeholder={setting.placeholder}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  ) : setting.type === 'secret' ? (
                    <input
                      type="password"
                      value={values[setting.key] ?? ''}
                      onChange={e => handleChange(setting.key, e.target.value)}
                      placeholder={setting.placeholder || '••••••••'}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  ) : setting.type === 'textarea' || setting.type === 'json' ? (
                    <textarea
                      value={typeof values[setting.key] === 'object' ? JSON.stringify(values[setting.key], null, 2) : (values[setting.key] ?? '')}
                      onChange={e => {
                        try { handleChange(setting.key, JSON.parse(e.target.value)); }
                        catch { handleChange(setting.key, e.target.value); }
                      }}
                      rows={4}
                      placeholder={setting.placeholder}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  ) : setting.type === 'color' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={values[setting.key] ?? '#000000'}
                        onChange={e => handleChange(setting.key, e.target.value)}
                        className="w-10 h-10 rounded border border-slate-300 cursor-pointer"
                      />
                      <input
                        type="text"
                        value={values[setting.key] ?? ''}
                        onChange={e => handleChange(setting.key, e.target.value)}
                        className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm"
                      />
                    </div>
                  ) : (
                    <input
                      type={setting.type === 'email' ? 'email' : setting.type === 'url' ? 'url' : 'text'}
                      value={values[setting.key] ?? ''}
                      onChange={e => handleChange(setting.key, e.target.value)}
                      placeholder={setting.placeholder}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  )}

                  {setting.helpText && (
                    <p className="text-xs text-slate-400 mt-1">{setting.helpText}</p>
                  )}
                </div>
              ))}
          </CardContent>
        </Card>
      ))}

      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => navigate('/config')}>Cancel</Button>
        <Button onClick={handleSave} disabled={saving || !canWrite || !dirty} title={!canWrite ? 'CONFIG_UPDATE permission required' : undefined}>
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </div>

      <ReauthDialog
        open={reauth.isOpen}
        password={reauth.password}
        error={reauth.error}
        isVerifying={reauth.isVerifying}
        onPasswordChange={reauth.setPassword}
        onConfirm={reauth.confirm}
        onCancel={reauth.cancel}
        actionLabel="Save Configuration"
      />
    </div>
  );
}
