import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/lib/api-client';

interface PaginationConfig {
  limit: number;
  count: number;
  options: number[];
}

/**
 * Grow / shrink the options list to exactly `count` entries.
 *
 * Extracted from the count/limit effect below so the INITIAL seed can apply the
 * same normalisation. Without that, a stored row whose `count` disagrees with
 * `options.length` (or which predates the `count` field entirely) would be
 * rewritten by the effect one tick after load — making the page paint as
 * already-dirty before the user touched anything.
 */
function reconcileOptions(prev: number[], count: number, limit: number): number[] {
  if (prev.length === count) return prev;
  if (prev.length < count) {
    const next = [...prev];
    while (next.length < count) {
      const last = next[next.length - 1] || 10;
      next.push(Math.min(last + 10, limit));
    }
    return next;
  }
  return prev.slice(0, count);
}

export function PaginationConfigPage() {
  const { data, mutate } = useSWR<PaginationConfig>('/api/config/pagination', { revalidateOnMount: true, dedupingInterval: 0 });
  const [limit, setLimit] = useState(100);
  const [count, setCount] = useState(3);
  const [options, setOptions] = useState<number[]>([10, 25, 50]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // Snapshot of the seeded values, used to gate the Save button. A snapshot is
  // required here (rather than comparing straight to `data`) because the page
  // decomposes the payload into three pieces of state with fallbacks — a
  // stored row missing `count` would otherwise compare unequal forever.
  const [baseline, setBaseline] = useState<string>('');

  useEffect(() => {
    if (data) {
      const nextLimit = data.limit ?? 100;
      const nextCount = data.count ?? data.options?.length ?? 3;
      const nextOptions = reconcileOptions(data.options ?? [10, 25, 50], nextCount, nextLimit);
      setLimit(nextLimit);
      setCount(nextCount);
      setOptions(nextOptions);
      setBaseline(JSON.stringify({ limit: nextLimit, count: nextCount, options: nextOptions }));
    }
  }, [data]);

  useEffect(() => {
    setOptions(prev => reconcileOptions(prev, count, limit));
  }, [count, limit]);

  // Save is enabled only after an actual change. `handleSave` awaits `mutate()`
  // on success, which reseeds the effect above and advances the baseline — so
  // the button disables again with no reload. A failed save leaves `data`
  // untouched, so the edits stay dirty and re-savable.
  const dirty = baseline !== '' && JSON.stringify({ limit, count, options }) !== baseline;

  const handleOptionChange = (index: number, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num)) return;
    const updated = [...options];
    updated[index] = num;
    setOptions(updated);
  };

  const handleSave = async () => {
    if (limit < 1) { // no upper bound (operator decision 2026-09-04)
      setMessage({ type: 'error', text: 'Limit must be at least 1.' });
      return;
    }
    if (count < 2 || count > 10) {
      setMessage({ type: 'error', text: 'Count must be between 2 and 10.' });
      return;
    }
    for (let i = 0; i < options.length; i++) {
      if (options[i] < 5 || options[i] > limit) {
        setMessage({ type: 'error', text: 'Option ' + (i + 1) + ' must be between 5 and ' + limit + '.' });
        return;
      }
    }
    if (new Set(options).size !== options.length) {
      setMessage({ type: 'error', text: 'All option values must be different.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      const sortedOptions = [...options].sort((a, b) => a - b);
      await apiClient.put('/api/config/pagination', { limit, count, options: sortedOptions });
      await mutate();
      setOptions(sortedOptions);
      setMessage({ type: 'success', text: 'Pagination settings saved successfully.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setLimit(100);
    setCount(3);
    setOptions([10, 25, 50]);
  };

  const sorted = [...options].sort((a, b) => a - b);

  return (
    <div className="space-y-5 max-w-2xl">
      <p className="text-sm text-slate-500">Configure records per page options for all list views.</p>

      <Card>
        <CardHeader>
          <CardTitle>Page Size Configuration</CardTitle>
          <CardDescription>
            Set the maximum page size limit and how many page size options users can choose from on all paginated pages.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {message && (
            <div className={`p-3 rounded-lg text-sm ${
              message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {message.text}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Limit (Max Page Size)</label>
              <Input
                type="number"
                min={5}
                max={1000}
                value={limit}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v)) setLimit(v);
                }}
              />
              <p className="text-xs text-slate-400 mt-1">Maximum allowed value: 1000</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Count (Number of Options)</label>
              <Input
                type="number"
                min={2}
                max={10}
                value={count}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v >= 2 && v <= 10) setCount(v);
                }}
              />
              <p className="text-xs text-slate-400 mt-1">How many page size buttons to show (2-10)</p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Page Size Options</label>
            <div className="grid grid-cols-5 gap-3">
              {options.map((opt, i) => (
                <div key={i}>
                  <label className="block text-xs text-slate-500 mb-1">Option {i + 1}</label>
                  <Input
                    type="number"
                    min={5}
                    max={limit}
                    value={opt}
                    onChange={(e) => handleOptionChange(i, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <p className="text-sm font-medium text-slate-700 mb-2">Preview</p>
            <p className="text-xs text-slate-500 mb-3">This is how the selector will appear on all paginated pages:</p>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm text-slate-500">Rows per page:</span>
              <div className="flex items-center gap-1 flex-wrap">
                {sorted.map((opt, i) => (
                  <span
                    key={i}
                    className={`px-2.5 py-1 rounded-md text-sm font-medium ${
                      i === 0 ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 bg-white border border-slate-200'
                    }`}
                  >
                    {opt}
                  </span>
                ))}
              </div>
              <span className="text-slate-300">|</span>
              <span className="text-sm text-slate-600">
                Page <span className="font-semibold text-slate-800">1</span> of <span className="font-semibold text-slate-800">10</span>
                <span className="text-slate-400 ml-2">({sorted[0] * 10} total records)</span>
              </span>
            </div>
          </div>

          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <p className="text-xs text-blue-700">
              <strong>Note:</strong> Each option value must be between 5 and the limit ({limit}). All values must be different. Values are auto-sorted ascending. Changes apply to all users immediately.
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-4 mt-4 border-t border-slate-100">
            <Button variant="outline" onClick={handleReset}>
              Reset to Default
            </Button>
            <Button onClick={handleSave} disabled={saving || !dirty}>
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
