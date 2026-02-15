import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR, { mutate } from 'swr';
import { type Question } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function ChecklistReviewPage() {
  const { recordId } = useParams();
  const navigate = useNavigate();
  const [comments, setComments] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: record } = useSWR(recordId ? `/api/checklists/records/${recordId}` : null);

  if (!record) return <div className="text-muted-foreground p-6">Loading record...</div>;

  const questions = (record.nodeChecklist?.checklistTemplate?.questions ?? []) as Question[];
  const responses = (record.responses ?? {}) as Record<string, unknown>;
  const isPendingCheck = record.status === 'PENDING_CHECK';
  const isPendingVerify = record.status === 'PENDING_VERIFY';
  const isReadOnly = !isPendingCheck && !isPendingVerify;

  const statusColors: Record<string, string> = {
    DRAFT: 'outline', SUBMITTED: 'secondary', PENDING_CHECK: 'warning',
    PENDING_VERIFY: 'warning', COMPLETED: 'success', REJECTED: 'destructive',
  };

  const handleAction = async (action: 'APPROVE' | 'REJECT') => {
    setError('');
    setSubmitting(true);
    try {
      const endpoint = isPendingCheck
        ? `/api/checklists/records/${recordId}/check`
        : `/api/checklists/records/${recordId}/verify`;
      await apiClient.post(endpoint, { action, comments: comments || undefined });
      mutate(`/api/checklists/records/${recordId}`);
      navigate(-1);
    } catch (err: any) {
      setError(err.message || 'Failed to process review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              {isReadOnly ? 'Record Detail' : isPendingCheck ? 'Review: Checked By' : 'Review: Verified By'}
            </CardTitle>
            <Badge variant={(statusColors[record.status] ?? 'outline') as any}>{record.status}</Badge>
          </div>
          {record.nodeChecklist?.node && (
            <p className="text-sm text-muted-foreground">
              Asset: {record.nodeChecklist.node.name} ({record.nodeChecklist.node.nodeType})
            </p>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          {/* Response display */}
          {questions.map((q, idx) => (
            <div key={q.id} className="rounded-md border border-border p-3 space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Q{idx + 1}</Badge>
                <span className="font-medium text-sm">{q.label}</span>
              </div>
              <div className="text-sm pl-8">
                <span className="text-muted-foreground">Answer: </span>
                <span className="font-medium">{formatResponse(responses[q.id])}</span>
              </div>
            </div>
          ))}

          {/* Signature trail */}
          <div className="space-y-2 rounded-md border border-border p-3 bg-muted/30">
            <h4 className="text-sm font-semibold">Signature Trail</h4>
            {record.performedAt && (
              <div className="text-sm"><span className="text-muted-foreground">Performed By:</span> {record.performedBy} at {new Date(record.performedAt).toLocaleString()}</div>
            )}
            {record.checkedAt && (
              <div className="text-sm">
                <span className="text-muted-foreground">Checked By:</span> {record.checkedBy} at {new Date(record.checkedAt).toLocaleString()}
                {record.checkComments && <span className="ml-2 text-xs">({record.checkComments})</span>}
              </div>
            )}
            {record.verifiedAt && (
              <div className="text-sm">
                <span className="text-muted-foreground">Verified By:</span> {record.verifiedBy} at {new Date(record.verifiedAt).toLocaleString()}
                {record.verifyComments && <span className="ml-2 text-xs">({record.verifyComments})</span>}
              </div>
            )}
            <div className="text-xs text-muted-foreground">Checksum: {record.checksum}</div>
          </div>

          {/* Review actions */}
          {!isReadOnly && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Comments</label>
              <Input value={comments} onChange={e => setComments(e.target.value)} placeholder="Add review comments (optional)" />
            </div>
          )}
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>Back</Button>
          {!isReadOnly && (
            <>
              <Button variant="destructive" onClick={() => handleAction('REJECT')} disabled={submitting}>Reject</Button>
              <Button onClick={() => handleAction('APPROVE')} disabled={submitting}>
                {submitting ? 'Processing...' : isPendingCheck ? 'Approve (Check)' : 'Approve (Verify)'}
              </Button>
            </>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}

function formatResponse(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
