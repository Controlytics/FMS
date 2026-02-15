import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { QUESTION_TYPES, type QuestionType } from '@digilog/shared';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface QuestionDef {
  id: string;
  label: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  minValue?: number;
  maxValue?: number;
  unit?: string;
  helpText?: string;
}

export function ChecklistBuilderPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<QuestionDef[]>([]);
  const [checkedByEnabled, setCheckedByEnabled] = useState(false);
  const [verifiedByEnabled, setVerifiedByEnabled] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const addQuestion = () => {
    setQuestions([...questions, {
      id: `q_${Date.now()}`,
      label: '',
      type: 'PASS_FAIL',
      required: true,
    }]);
  };

  const updateQuestion = (idx: number, updates: Partial<QuestionDef>) => {
    const updated = [...questions];
    updated[idx] = { ...updated[idx], ...updates };
    setQuestions(updated);
  };

  const removeQuestion = (idx: number) => {
    setQuestions(questions.filter((_, i) => i !== idx));
  };

  const moveQuestion = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= questions.length) return;
    const updated = [...questions];
    [updated[idx], updated[newIdx]] = [updated[newIdx], updated[idx]];
    setQuestions(updated);
  };

  const handleSubmit = async () => {
    setError('');
    if (!name.trim()) { setError('Name is required'); return; }
    if (questions.length === 0) { setError('Add at least one question'); return; }
    for (const q of questions) {
      if (!q.label.trim()) { setError('All questions must have a label'); return; }
    }

    setSubmitting(true);
    try {
      await apiClient.post('/api/checklists/templates', {
        name, description: description || undefined,
        questions,
        checkedByEnabled,
        verifiedByEnabled,
      });
      navigate('/assets/templates');
    } catch (err: any) {
      setError(err.message || 'Failed to create checklist template');
    } finally {
      setSubmitting(false);
    }
  };

  const needsOptions = (type: string) => ['MCQ', 'MULTI_SELECT', 'DROPDOWN'].includes(type);
  const needsLimits = (type: string) => type === 'NUMERIC_WITH_LIMITS';

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Create Checklist Template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Template Name *</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Daily Equipment Inspection" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Description</label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional description" />
            </div>
          </div>

          {/* Approval Tiers */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Approval Workflow</h3>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={checkedByEnabled} onChange={e => setCheckedByEnabled(e.target.checked)} />
                Require "Checked By" approval
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={verifiedByEnabled} onChange={e => setVerifiedByEnabled(e.target.checked)} />
                Require "Verified By" approval
              </label>
            </div>
            <p className="text-xs text-muted-foreground">
              {!checkedByEnabled && !verifiedByEnabled && 'Records complete immediately after submission.'}
              {checkedByEnabled && !verifiedByEnabled && '2-tier: Performed By → Checked By → Completed'}
              {!checkedByEnabled && verifiedByEnabled && '2-tier: Performed By → Verified By → Completed'}
              {checkedByEnabled && verifiedByEnabled && '3-tier: Performed By → Checked By → Verified By → Completed'}
            </p>
          </div>

          {/* Questions */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Questions ({questions.length})</h3>
              <Button type="button" variant="outline" size="sm" onClick={addQuestion}>+ Add Question</Button>
            </div>

            {questions.map((q, idx) => (
              <div key={q.id} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="outline">Q{idx + 1}</Badge>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => moveQuestion(idx, -1)} disabled={idx === 0}>↑</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => moveQuestion(idx, 1)} disabled={idx === questions.length - 1}>↓</Button>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeQuestion(idx)}>X</Button>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Input value={q.label} onChange={e => updateQuestion(idx, { label: e.target.value })} placeholder="Question label *" />
                  </div>
                  <Select value={q.type} onChange={e => updateQuestion(idx, { type: e.target.value as QuestionType })}>
                    {QUESTION_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
                  </Select>
                </div>

                <div className="flex gap-4">
                  <label className="flex items-center gap-1 text-xs">
                    <input type="checkbox" checked={q.required} onChange={e => updateQuestion(idx, { required: e.target.checked })} />
                    Required
                  </label>
                  <Input className="h-8 text-xs flex-1" value={q.helpText ?? ''} onChange={e => updateQuestion(idx, { helpText: e.target.value })} placeholder="Help text (optional)" />
                </div>

                {needsOptions(q.type) && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Options (comma-separated)</label>
                    <Input value={(q.options ?? []).join(', ')} onChange={e => updateQuestion(idx, { options: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="Option A, Option B, Option C" />
                  </div>
                )}

                {needsLimits(q.type) && (
                  <div className="flex gap-2">
                    <div className="space-y-1 flex-1">
                      <label className="text-xs font-medium">Min</label>
                      <Input type="number" value={q.minValue ?? ''} onChange={e => updateQuestion(idx, { minValue: e.target.value ? Number(e.target.value) : undefined })} />
                    </div>
                    <div className="space-y-1 flex-1">
                      <label className="text-xs font-medium">Max</label>
                      <Input type="number" value={q.maxValue ?? ''} onChange={e => updateQuestion(idx, { maxValue: e.target.value ? Number(e.target.value) : undefined })} />
                    </div>
                    <div className="space-y-1 flex-1">
                      <label className="text-xs font-medium">Unit</label>
                      <Input value={q.unit ?? ''} onChange={e => updateQuestion(idx, { unit: e.target.value })} placeholder="e.g., °C" />
                    </div>
                  </div>
                )}
              </div>
            ))}

            {questions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No questions yet. Click "+ Add Question" to start building your checklist.</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Creating...' : 'Create Checklist Template'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
