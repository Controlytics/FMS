import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { type Question } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export function ChecklistExecutePage() {
  const { checklistId } = useParams();
  const navigate = useNavigate();
  const [responses, setResponses] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const { data: nodeChecklists } = useSWR(checklistId ? `/api/checklists/nodes/${checklistId}` : null);
  // checklistId can be a nodeChecklistId — try fetching the node checklists
  // Or we load the template via the nodeChecklist
  const { data: records } = useSWR(checklistId ? `/api/checklists/${checklistId}/records` : null);

  // Get the checklist details — nodeChecklistId
  const { data: ncList } = useSWR('/api/checklists/templates?status=active');

  // For execute, we need the nodeChecklist data. The route param is nodeChecklistId.
  const { data: ncData } = useSWR(checklistId ? null : null);

  // Simple approach: the template's questions come from the URL-based fetch
  // We'll use the nodeChecklist records endpoint and also a direct approach
  const questions: Question[] = (() => {
    if (nodeChecklists && Array.isArray(nodeChecklists)) {
      // It returned an array — probably from nodes/:id endpoint
      const nc = nodeChecklists[0];
      if (nc?.checklistTemplate?.questions) return nc.checklistTemplate.questions as Question[];
    }
    return [];
  })();

  const setResponse = (questionId: string, value: unknown) => {
    setResponses(prev => ({ ...prev, [questionId]: value }));
  };

  const handleSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await apiClient.post(`/api/checklists/${checklistId}/records`, {
        responses,
        deviceInfo: { userAgent: navigator.userAgent },
      });
      navigate(-1);
    } catch (err: any) {
      setError(err.message || 'Failed to submit record');
    } finally {
      setSubmitting(false);
    }
  };

  const renderQuestion = (q: Question, idx: number) => {
    const value = responses[q.id];

    switch (q.type) {
      case 'PASS_FAIL':
        return (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant={value === 'PASS' ? 'default' : 'outline'} onClick={() => setResponse(q.id, 'PASS')}>Pass</Button>
            <Button type="button" size="sm" variant={value === 'FAIL' ? 'destructive' : 'outline'} onClick={() => setResponse(q.id, 'FAIL')}>Fail</Button>
          </div>
        );
      case 'YES_NO_COMMENT':
        return (
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button type="button" size="sm" variant={value === 'YES' || (value as any)?.answer === 'YES' ? 'default' : 'outline'} onClick={() => setResponse(q.id, { answer: 'YES', comment: (value as any)?.comment ?? '' })}>Yes</Button>
              <Button type="button" size="sm" variant={(value as any)?.answer === 'NO' ? 'destructive' : 'outline'} onClick={() => setResponse(q.id, { answer: 'NO', comment: (value as any)?.comment ?? '' })}>No</Button>
            </div>
            <Input placeholder="Comment (optional)" value={(value as any)?.comment ?? ''} onChange={e => setResponse(q.id, { answer: (value as any)?.answer ?? '', comment: e.target.value })} />
          </div>
        );
      case 'MCQ':
      case 'DROPDOWN':
        return (
          <Select value={String(value ?? '')} onChange={e => setResponse(q.id, e.target.value)}>
            <option value="">-- Select --</option>
            {(q.options ?? []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
          </Select>
        );
      case 'MULTI_SELECT':
        return (
          <div className="flex flex-wrap gap-2">
            {(q.options ?? []).map(opt => {
              const selected = Array.isArray(value) && value.includes(opt);
              return (
                <Button key={opt} type="button" size="sm" variant={selected ? 'default' : 'outline'}
                  onClick={() => {
                    const current = Array.isArray(value) ? value : [];
                    setResponse(q.id, selected ? current.filter(v => v !== opt) : [...current, opt]);
                  }}>
                  {opt}
                </Button>
              );
            })}
          </div>
        );
      case 'NUMERIC_WITH_LIMITS':
        return (
          <div className="flex items-center gap-2">
            <Input type="number" value={String(value ?? '')} onChange={e => setResponse(q.id, e.target.value ? Number(e.target.value) : '')} placeholder={`Enter value${q.unit ? ` (${q.unit})` : ''}`} />
            {q.minValue !== undefined && <span className="text-xs text-muted-foreground">Min: {q.minValue}</span>}
            {q.maxValue !== undefined && <span className="text-xs text-muted-foreground">Max: {q.maxValue}</span>}
          </div>
        );
      case 'FILL_BLANK':
        return <Input value={String(value ?? '')} onChange={e => setResponse(q.id, e.target.value)} placeholder={q.placeholder ?? 'Enter value'} />;
      case 'DATE_TIME':
        return <Input type="datetime-local" value={String(value ?? '')} onChange={e => setResponse(q.id, e.target.value)} />;
      case 'SIGNATURE':
        return (
          <div className="space-y-1">
            <Input value={String(value ?? '')} onChange={e => setResponse(q.id, e.target.value)} placeholder="Type your name as e-signature" />
            <p className="text-xs text-muted-foreground">By typing your name, you confirm this as your electronic signature per 21 CFR Part 11.</p>
          </div>
        );
      case 'PHOTO':
        return <Input type="file" accept="image/*" onChange={e => setResponse(q.id, e.target.files?.[0]?.name ?? '')} />;
      default:
        return <Input value={String(value ?? '')} onChange={e => setResponse(q.id, e.target.value)} placeholder="Enter value" />;
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Execute Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          {questions.length === 0 && (
            <p className="text-muted-foreground">Loading checklist questions...</p>
          )}

          {questions.map((q, idx) => (
            <div key={q.id} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline">Q{idx + 1}</Badge>
                <span className="font-medium text-sm">{q.label}</span>
                {q.required && <span className="text-destructive text-xs">*</span>}
                <Badge variant="secondary" className="text-xs ml-auto">{q.type.replace(/_/g, ' ')}</Badge>
              </div>
              {q.helpText && <p className="text-xs text-muted-foreground">{q.helpText}</p>}
              {renderQuestion(q, idx)}
            </div>
          ))}
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting...' : 'Submit Record'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
