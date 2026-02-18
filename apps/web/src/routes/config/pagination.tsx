import { useState, useEffect } from 'react';
import useSWR from 'swr';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { apiClient } from '@/lib/api-client';

interface PaginationConfig {
  options: [number, number, number];
}

export function PaginationConfigPage() {
  const { data, mutate } = useSWR<PaginationConfig>('/api/config/pagination');
  const [options, setOptions] = useState<[number, number, number]>([10, 25, 50]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (data?.options) {
      setOptions([...data.options]);
    }
  }, [data]);

  const handleChange = (index: number, value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num)) return;
    const updated = [...options] as [number, number, number];
    updated[index] = num;
    setOptions(updated);
  };

  const handleSave = async () => {
    // Validate
    const sorted = [...options].sort((a, b) => a - b);
    if (sorted[0] < 5 || sorted[2] > 100) {
      setMessage({ type: 'error', text: 'All values must be between 5 and 100.' });
      return;
    }
    if (new Set(options).size !== 3) {
      setMessage({ type: 'error', text: 'All three values must be different.' });
      return;
    }

    setSaving(true);
    setMessage(null);
    try {
      // Auto-sort ascending before saving
      const sortedOptions = [...options].sort((a, b) => a - b) as [number, number, number];
      await apiClient.put('/api/config/pagination', { options: sortedOptions });
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
    setOptions([10, 25, 50]);
  };

  const sorted = [...options].sort((a, b) => a - b);

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 shadow-lg shadow-sky-500/25">
          <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Pagination Settings</h1>
          <p className="text-sm text-slate-500 mt-0.5">Configure records per page options for all list views</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Records Per Page Options</CardTitle>
          <CardDescription>
            Set three record count options that users can choose from on all paginated pages (Users, Audit Trail, Notifications, Templates, Hierarchy). Values will be auto-sorted in ascending order.
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

          <div className="grid grid-cols-3 gap-4">
            {options.map((opt, i) => (
              <div key={i}>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Option {i + 1}</label>
                <Input
                  type="number"
                  min={5}
                  max={100}
                  value={opt}
                  onChange={(e) => handleChange(i, e.target.value)}
                />
              </div>
            ))}
          </div>

          <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
            <p className="text-sm font-medium text-slate-700 mb-2">Preview</p>
            <p className="text-xs text-slate-500 mb-3">This is how the selector will appear on all paginated pages:</p>
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-500">Rows per page:</span>
              <div className="flex items-center gap-1">
                {sorted.map((opt, i) => (
                  <span
                    key={i}
                    className={`px-2.5 py-1 rounded-md text-sm font-medium ${
                      i === 0 ? 'bg-indigo-500 text-white shadow-sm' : 'text-slate-600 bg-white border border-slate-200'
                    }`}
                  >
                    {opt}
                  </span>
                ))}
              </div>
              <span className="text-slate-300">|</span>
              <span className="text-sm text-slate-600">
                Page <span className="font-semibold text-slate-800">1</span> of <span className="font-semibold text-slate-800">10</span>
                <span className="text-slate-400 ml-2">(100 total records)</span>
              </span>
            </div>
          </div>

          <div className="bg-blue-50 rounded-lg p-3 border border-blue-200">
            <p className="text-xs text-blue-700">
              <strong>Note:</strong> Min value: 5, Max value: 100. All three values must be different. Changes apply to all users across all paginated pages immediately.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
            <Button variant="outline" onClick={handleReset}>
              Reset to Default
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
