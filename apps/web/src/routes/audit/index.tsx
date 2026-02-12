import { useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AUDIT_ACTIONS } from '@digilog/shared';

export function AuditTrailPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<any>(null);

  const params = new URLSearchParams({ page: String(page), limit: '20' });
  if (action) params.set('action', action);
  if (userId) params.set('userId', userId);

  const { data } = useSWR(`/api/audit?${params}`);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Audit Trail</h1>

      {/* Filters */}
      <div className="flex gap-3">
        <Input
          placeholder="Filter by User ID..."
          value={userId}
          onChange={(e) => { setUserId(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">All Actions</option>
          {Object.values(AUDIT_ACTIONS).map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </Select>
      </div>

      <p className="text-xs text-muted-foreground">
        Note: Super Admin actions are not recorded in the audit trail.
      </p>

      {/* Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Timestamp</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data?.data?.map((record: any) => (
            <TableRow key={record.id}>
              <TableCell className="text-sm whitespace-nowrap">
                {new Date(record.timestamp).toLocaleString()}
              </TableCell>
              <TableCell>{record.userId}</TableCell>
              <TableCell>
                <Badge variant="outline">{record.userRole}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="secondary">{record.action}</Badge>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {record.targetType} {record.targetId ? `(${record.targetId.slice(0, 8)}...)` : ''}
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => setSelectedRecord(record)}>
                  View
                </Button>
              </TableCell>
            </TableRow>
          ))}
          {(!data?.data || data.data.length === 0) && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                No audit records found.
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

      {/* Detail dialog */}
      <Dialog open={!!selectedRecord} onClose={() => setSelectedRecord(null)} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Audit Record Detail</DialogTitle>
        </DialogHeader>
        {selectedRecord && (
          <div className="space-y-3 text-sm max-h-96 overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              <div><strong>Record ID:</strong> {selectedRecord.id}</div>
              <div><strong>Timestamp:</strong> {new Date(selectedRecord.timestamp).toLocaleString()}</div>
              <div><strong>User ID:</strong> {selectedRecord.userId}</div>
              <div><strong>User Role:</strong> {selectedRecord.userRole}</div>
              <div><strong>Action:</strong> {selectedRecord.action}</div>
              <div><strong>IP Address:</strong> {selectedRecord.ipAddress ?? '-'}</div>
              <div><strong>Target Type:</strong> {selectedRecord.targetType ?? '-'}</div>
              <div><strong>Target ID:</strong> {selectedRecord.targetId ?? '-'}</div>
            </div>
            {selectedRecord.beforeValue && (
              <div>
                <strong>Previous Value:</strong>
                <pre className="mt-1 rounded bg-muted p-2 text-xs overflow-x-auto">
                  {JSON.stringify(selectedRecord.beforeValue, null, 2)}
                </pre>
              </div>
            )}
            {selectedRecord.afterValue && (
              <div>
                <strong>New Value:</strong>
                <pre className="mt-1 rounded bg-muted p-2 text-xs overflow-x-auto">
                  {JSON.stringify(selectedRecord.afterValue, null, 2)}
                </pre>
              </div>
            )}
            {selectedRecord.reason && (
              <div><strong>Reason:</strong> {selectedRecord.reason}</div>
            )}
            <div><strong>Checksum:</strong> <code className="text-xs">{selectedRecord.checksum}</code></div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
