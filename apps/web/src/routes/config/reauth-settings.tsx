import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

const OPERATION_LABELS: Record<string, string> = {
  'config:password-policy': 'Update Password Policy',
  'config:login-security': 'Update Login Security',
  'config:session': 'Update Session Config',
  'user:create': 'Create User',
  'user:update': 'Update User',
  'user:delete': 'Delete User',
  'user:enable': 'Enable User',
  'user:disable': 'Disable User',
  'user:reset-password': 'Reset User Password',
  'node:create': 'Create Hierarchy Node',
  'node:delete': 'Delete Hierarchy Node',
};

export function ReauthSettingsPage() {
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [enabled, setEnabled] = useState<string[]>([]);
  const { data } = useSWR<{ enabledOperations: string[]; availableOperations: string[] }>('/api/config/reauth-settings');

  useEffect(() => {
    if (data?.enabledOperations) {
      setEnabled(data.enabledOperations);
    }
  }, [data]);

  const toggleOperation = (op: string) => {
    setEnabled((prev) =>
      prev.includes(op) ? prev.filter((o) => o !== op) : [...prev, op],
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await apiClient.put('/api/config/reauth-settings', { enabledOperations: enabled });
      setSuccess('Re-authentication settings updated successfully');
    } catch (err: any) {
      setError(err.message || 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  const operations = data?.availableOperations ?? Object.keys(OPERATION_LABELS);

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader>
          <CardTitle>Re-authentication Settings</CardTitle>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

            <p className="text-sm text-muted-foreground">
              Select which operations require users to re-enter their password before proceeding.
            </p>

            <div className="space-y-2">
              {operations.map((op) => (
                <label key={op} className="flex items-center gap-2 text-sm p-2 rounded hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={enabled.includes(op)}
                    onChange={() => toggleOperation(op)}
                    className="rounded"
                  />
                  {OPERATION_LABELS[op] ?? op}
                  <span className="text-xs text-muted-foreground ml-auto font-mono">{op}</span>
                </label>
              ))}
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/config')}>Cancel</Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
