import { useState } from 'react';
import useSWR, { mutate } from 'swr';
import { ROLES, PERMISSIONS } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

const DELEGABLE_PRIVILEGES = [
  'MANAGE_TEMPLATES', 'CREATE_INSTANCES', 'MANAGE_CHECKLISTS',
  'MANAGE_SCHEDULES', 'MANAGE_ALARMS', 'VIEW_AUDIT',
] as const;

export function DelegatedPrivilegesPage() {
  const { data: privileges } = useSWR('/api/privileges');
  const [role, setRole] = useState('');
  const [privilege, setPrivilege] = useState('');
  const [assetType, setAssetType] = useState('');
  const [error, setError] = useState('');

  const handleGrant = async () => {
    setError('');
    if (!role || !privilege) { setError('Role and privilege are required'); return; }
    try {
      await apiClient.post('/api/privileges', {
        role,
        privilege,
        assetType: assetType || undefined,
      });
      mutate('/api/privileges');
      setRole('');
      setPrivilege('');
      setAssetType('');
    } catch (err: any) {
      setError(err.message || 'Failed to grant privilege');
    }
  };

  const handleRevoke = async (id: string) => {
    try {
      await apiClient.delete(`/api/privileges/${id}`);
      mutate('/api/privileges');
    } catch {
      // handle error
    }
  };

  const roles = Object.values(ROLES).filter(r => r !== 'SUPER_ADMIN');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Delegated Privileges</h1>
        <p className="text-muted-foreground">SuperAdmin can delegate asset-related privileges to any role.</p>
      </div>

      {/* Grant new privilege */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Grant Privilege</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          <div className="flex gap-4 items-end">
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium">Role</label>
              <Select value={role} onChange={e => setRole(e.target.value)}>
                <option value="">-- Select role --</option>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium">Privilege</label>
              <Select value={privilege} onChange={e => setPrivilege(e.target.value)}>
                <option value="">-- Select privilege --</option>
                {DELEGABLE_PRIVILEGES.map(p => <option key={p} value={p}>{p.replace(/_/g, ' ')}</option>)}
              </Select>
            </div>
            <div className="flex-1 space-y-1">
              <label className="text-sm font-medium">Asset Type (optional)</label>
              <Input value={assetType} onChange={e => setAssetType(e.target.value)} placeholder="e.g., equipment, room" />
            </div>
            <Button onClick={handleGrant}>Grant</Button>
          </div>
        </CardContent>
      </Card>

      {/* Active privileges */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Active Privileges ({(privileges ?? []).length})</CardTitle>
        </CardHeader>
        <CardContent>
          {(privileges ?? []).length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Role</TableHead>
                  <TableHead>Privilege</TableHead>
                  <TableHead>Asset Type</TableHead>
                  <TableHead>Granted At</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(privileges ?? []).map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell><Badge variant="outline">{p.role}</Badge></TableCell>
                    <TableCell><Badge>{p.privilege.replace(/_/g, ' ')}</Badge></TableCell>
                    <TableCell>{p.assetType ?? 'All'}</TableCell>
                    <TableCell className="text-xs">{new Date(p.grantedAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <Button variant="destructive" size="sm" onClick={() => handleRevoke(p.id)}>Revoke</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-muted-foreground">No delegated privileges configured.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
