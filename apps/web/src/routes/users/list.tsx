import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { apiClient } from '@/lib/api-client';
import { Dialog, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ReauthDialog } from '@/components/ui/reauth-dialog';
import { useReauth } from '@/hooks/use-reauth';

const statusBadge: Record<string, 'success' | 'destructive' | 'warning' | 'outline'> = {
  ENABLED: 'success',
  DISABLED: 'destructive',
  LOCKED: 'warning',
  EXPIRED: 'outline',
};

export function UserListPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [actionDialog, setActionDialog] = useState<{ type: string; userId: string; username: string } | null>(null);
  const { isOpen: reauthOpen, operation: reauthOp, executeWithReauth, onReauthSuccess, onReauthClose } = useReauth();

  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (search) params.set('search', search);
  if (roleFilter) params.set('role', roleFilter);
  if (statusFilter) params.set('status', statusFilter);

  const { data, mutate } = useSWR(`/api/users?${params}`);

  const handleAction = async () => {
    if (!actionDialog) return;
    const opMap: Record<string, string> = { enable: 'user:enable', disable: 'user:disable', unlock: 'user:enable' };
    const opKey = opMap[actionDialog.type] ?? `user:${actionDialog.type}`;
    try {
      await executeWithReauth(`${actionDialog.type} User`, async (token) => {
        const headers = token ? { 'X-Verification-Token': token } : undefined;
        await apiClient.post(`/api/users/${actionDialog.userId}/${actionDialog.type}`, {}, headers);
        mutate();
        setActionDialog(null);
      });
    } catch {
      // error handling
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">User Management</h1>
        <Link to="/users/create">
          <Button>Create User</Button>
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Input
          placeholder="Search users..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <Select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }}>
          <option value="">All Roles</option>
          {['SUPER_ADMIN', 'ADMIN', 'SUPERVISOR', 'MAINTENANCE', 'OPERATOR', 'VIEWER'].map((r) => (
            <option key={r} value={r}>{r.replace('_', ' ')}</option>
          ))}
        </Select>
        <Select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">All Statuses</option>
          {['ENABLED', 'DISABLED', 'LOCKED', 'EXPIRED'].map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User ID</TableHead>
            <TableHead>Full Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last Login</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.data?.map((user: any) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.username}</TableCell>
              <TableCell>{user.fullName}</TableCell>
              <TableCell>{user.email}</TableCell>
              <TableCell>
                <Badge variant="outline">{user.role.replace('_', ' ')}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={statusBadge[user.status] ?? 'outline'}>{user.status}</Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {user.lastLogin ? new Date(user.lastLogin).toLocaleString() : 'Never'}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Link to={`/users/${user.id}`}>
                    <Button variant="ghost" size="sm">Edit</Button>
                  </Link>
                  {user.status === 'LOCKED' && (
                    <Button variant="ghost" size="sm"
                      onClick={() => setActionDialog({ type: 'unlock', userId: user.id, username: user.username })}>
                      Unlock
                    </Button>
                  )}
                  {user.status === 'ENABLED' && (
                    <Button variant="ghost" size="sm"
                      onClick={() => setActionDialog({ type: 'disable', userId: user.id, username: user.username })}>
                      Disable
                    </Button>
                  )}
                  {user.status === 'DISABLED' && (
                    <Button variant="ghost" size="sm"
                      onClick={() => setActionDialog({ type: 'enable', userId: user.id, username: user.username })}>
                      Enable
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
          {(!data?.data || data.data.length === 0) && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                No users found.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">
            Page {data.page} of {data.totalPages} ({data.total} total)
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page >= data.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      )}

      <ReauthDialog open={reauthOpen} onClose={onReauthClose} onSuccess={onReauthSuccess} operation={reauthOp} />

      {/* Confirmation dialog */}
      <Dialog open={!!actionDialog} onClose={() => setActionDialog(null)}>
        <DialogHeader>
          <DialogTitle>
            {actionDialog?.type === 'unlock' ? 'Unlock' : actionDialog?.type === 'enable' ? 'Enable' : 'Disable'} User
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          Are you sure you want to {actionDialog?.type} user <strong>{actionDialog?.username}</strong>?
          {actionDialog?.type === 'disable' && ' This will terminate all active sessions.'}
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => setActionDialog(null)}>Cancel</Button>
          <Button variant={actionDialog?.type === 'disable' ? 'destructive' : 'default'} onClick={handleAction}>
            Confirm
          </Button>
        </DialogFooter>
      </Dialog>
    </div>
  );
}
