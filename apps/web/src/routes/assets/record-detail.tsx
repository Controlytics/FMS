import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { type Question } from '@digilog/shared';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

export function RecordDetailPage() {
  const { recordId } = useParams();
  const navigate = useNavigate();

  const { data: record } = useSWR(recordId ? `/api/checklists/records/${recordId}` : null);

  if (!record) return <div className="text-muted-foreground p-6">Loading record...</div>;

  const questions = (record.nodeChecklist?.checklistTemplate?.questions ?? []) as Question[];
  const responses = (record.responses ?? {}) as Record<string, unknown>;

  const statusColors: Record<string, string> = {
    DRAFT: 'outline', SUBMITTED: 'secondary', PENDING_CHECK: 'warning',
    PENDING_VERIFY: 'warning', COMPLETED: 'success', REJECTED: 'destructive',
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Checklist Record</h1>
        <div className="flex gap-2">
          <Badge variant={(statusColors[record.status] ?? 'outline') as any}>{record.status}</Badge>
          <Button variant="outline" onClick={() => navigate(-1)}>Back</Button>
        </div>
      </div>

      {record.nodeChecklist?.node && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex gap-4 text-sm">
              <span><strong>Asset:</strong> {record.nodeChecklist.node.name}</span>
              <span><strong>Type:</strong> {record.nodeChecklist.node.nodeType}</span>
              <span><strong>Checklist:</strong> {record.nodeChecklist.checklistTemplate?.name}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Responses</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>Question</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Answer</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {questions.map((q, idx) => (
                <TableRow key={q.id}>
                  <TableCell>{idx + 1}</TableCell>
                  <TableCell className="font-medium">{q.label}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{q.type.replace(/_/g, ' ')}</Badge></TableCell>
                  <TableCell>{formatResponse(responses[q.id])}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Signature Trail</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {record.performedAt && (
            <div className="flex justify-between border-b border-border pb-2">
              <span><strong>Performed By:</strong> {record.performedBy}</span>
              <span>{new Date(record.performedAt).toLocaleString()}</span>
            </div>
          )}
          {record.checkedAt && (
            <div className="flex justify-between border-b border-border pb-2">
              <span><strong>Checked By:</strong> {record.checkedBy} {record.checkComments && `— ${record.checkComments}`}</span>
              <span>{new Date(record.checkedAt).toLocaleString()}</span>
            </div>
          )}
          {record.verifiedAt && (
            <div className="flex justify-between border-b border-border pb-2">
              <span><strong>Verified By:</strong> {record.verifiedBy} {record.verifyComments && `— ${record.verifyComments}`}</span>
              <span>{new Date(record.verifiedAt).toLocaleString()}</span>
            </div>
          )}
          <div className="pt-2 text-xs text-muted-foreground">
            <strong>Checksum:</strong> {record.checksum}
            {record.complianceStatus && <> | <strong>Compliance:</strong> {record.complianceStatus}</>}
            {record.scheduleRef && <> | <strong>Schedule:</strong> {record.scheduleRef}</>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function formatResponse(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (obj.answer !== undefined) return `${obj.answer}${obj.comment ? ` (${obj.comment})` : ''}`;
    return JSON.stringify(value);
  }
  return String(value);
}
