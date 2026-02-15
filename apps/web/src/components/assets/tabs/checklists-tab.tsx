import { useState } from 'react';
import { Link } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { ScheduleEditor } from '@/components/assets/schedule-editor';

interface ChecklistsTabProps {
  nodeId: string;
  canEdit: boolean;
}

export function ChecklistsTab({ nodeId, canEdit }: ChecklistsTabProps) {
  const { data: nodeChecklists } = useSWR(`/api/checklists/nodes/${nodeId}`);
  const { data: templates } = useSWR('/api/checklists/templates?status=active');
  const [attachTemplateId, setAttachTemplateId] = useState('');
  const [scheduleDialogFor, setScheduleDialogFor] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleAttach = async () => {
    if (!attachTemplateId) return;
    setError('');
    try {
      await apiClient.post(`/api/checklists/nodes/${nodeId}`, { checklistTemplateId: attachTemplateId });
      mutate(`/api/checklists/nodes/${nodeId}`);
      setAttachTemplateId('');
    } catch (err: any) {
      setError(err.message || 'Failed to attach checklist');
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      {/* Attach checklist */}
      {canEdit && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="text-sm font-medium">Attach Checklist</label>
            <Select value={attachTemplateId} onChange={e => setAttachTemplateId(e.target.value)}>
              <option value="">-- Select checklist template --</option>
              {(templates ?? []).map((t: any) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </div>
          <Button size="sm" onClick={handleAttach} disabled={!attachTemplateId}>Attach</Button>
        </div>
      )}

      {/* Attached checklists */}
      {(nodeChecklists ?? []).map((nc: any) => (
        <Card key={nc.id}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">{nc.checklistTemplate?.name}</CardTitle>
              <div className="flex gap-2">
                <Badge variant={nc.enabled ? 'success' : 'outline'}>{nc.enabled ? 'Enabled' : 'Disabled'}</Badge>
                <Badge variant="outline">{nc._count?.records ?? 0} records</Badge>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setScheduleDialogFor(nc.id)}>+ Schedule</Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-2">
              {nc.checklistTemplate?.description ?? 'No description'}
              {nc.checklistTemplate?.checkedByEnabled && ' | 2-tier approval'}
              {nc.checklistTemplate?.verifiedByEnabled && ' | 3-tier approval'}
            </p>
            <RecordsList nodeChecklistId={nc.id} />
          </CardContent>
        </Card>
      ))}

      {(!nodeChecklists || nodeChecklists.length === 0) && (
        <p className="text-sm text-muted-foreground">No checklists attached to this asset.</p>
      )}

      {scheduleDialogFor && (
        <ScheduleEditor
          open={!!scheduleDialogFor}
          onClose={() => setScheduleDialogFor(null)}
          nodeChecklistId={scheduleDialogFor}
          onCreated={() => mutate(`/api/schedules/node/${nodeId}`)}
        />
      )}
    </div>
  );
}

function RecordsList({ nodeChecklistId }: { nodeChecklistId: string }) {
  const { data: records } = useSWR(`/api/checklists/${nodeChecklistId}/records`);

  if (!records || records.length === 0) return <p className="text-xs text-muted-foreground">No records yet.</p>;

  const statusColors: Record<string, string> = {
    COMPLETED: 'success', REJECTED: 'destructive', PENDING_CHECK: 'warning', PENDING_VERIFY: 'warning',
  };

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Performed By</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.slice(0, 10).map((r: any) => (
          <TableRow key={r.id}>
            <TableCell className="text-xs">{new Date(r.createdAt).toLocaleString()}</TableCell>
            <TableCell><Badge variant={(statusColors[r.status] ?? 'outline') as any}>{r.status}</Badge></TableCell>
            <TableCell className="text-xs">{r.performedBy}</TableCell>
            <TableCell>
              <Link to={`/assets/records/${r.id}`} className="text-xs text-primary hover:underline">View</Link>
              {(r.status === 'PENDING_CHECK' || r.status === 'PENDING_VERIFY') && (
                <Link to={`/assets/records/${r.id}/review`} className="text-xs text-primary hover:underline ml-2">Review</Link>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
