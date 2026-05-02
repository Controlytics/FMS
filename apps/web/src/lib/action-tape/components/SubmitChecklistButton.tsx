import { useState } from 'react';
import type { SubmitChecklistAction } from '../types.js';
import type { ActionPayload } from '../ActionRenderer.js';
import { BaseActionButton } from './base-action-button.js';
import { ActionDialog } from './action-dialog.js';

/**
 * `SUBMIT_CHECKLIST` — opens a question dialog parameterized by
 * `action.params.questions`. Each question renders YES / NO / N/A radios
 * plus an optional remarks textarea. Required questions must have a
 * radio selection; remarks always remain optional (matches the project
 * rule: "checklist remarks stay optional" — see CLAUDE.md).
 *
 * Submit payload mirrors what the existing `POST /:id/submit-checklist`
 * route accepts: `{ checklistProfileId, versionPin, answers: [{ questionId,
 * answer, remarks? }] }`.
 *
 * Phase 8.2 v1 supports YES/NO + N/A questions only — that's what the
 * existing checklist UI offers today, and it covers the entire current
 * checklist library. Free-text questions and structured options would be
 * a follow-up if/when the checklist surface adds them.
 */
export interface SubmitChecklistButtonProps {
  action: SubmitChecklistAction;
  disabled?: boolean;
  loading?: boolean;
  onSubmit: (payload: ActionPayload) => void | Promise<void>;
}

const ANSWER_CHOICES = ['YES', 'NO', 'N/A'] as const;
type AnswerChoice = typeof ANSWER_CHOICES[number];

export function SubmitChecklistButton({ action, disabled, loading, onSubmit }: SubmitChecklistButtonProps) {
  const questions = action.params.questions;
  const [open, setOpen] = useState(false);
  const [answers, setAnswers] = useState<Record<string, AnswerChoice | ''>>({});
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const handleClick = () => {
    setOpen(true);
    setAnswers({});
    setRemarks({});
    setError('');
  };

  const handleCancel = () => {
    if (loading) return;
    setOpen(false);
    setError('');
  };

  const handleSubmit = async () => {
    // Build object-keyed answers map matching the existing
    // POST /:id/submit-checklist contract (filter-operations.service.ts:870-882).
    // The server validates: (a) every required question key is present and
    // non-empty, and (b) NO unexpected keys (extras get rejected with 400
    // INVALID_QUESTIONS). So unanswered optional questions MUST be omitted —
    // do NOT default them to 'N/A'.
    const answersOut: Record<string, string> = {};
    const remarksOut: Record<string, string> = {};
    for (const q of questions) {
      const a = answers[q.id] ?? '';
      if (q.required && !a) {
        setError(`"${q.question}" is required.`);
        return;
      }
      if (a) answersOut[q.id] = a;
      const r = (remarks[q.id] ?? '').trim();
      if (r) remarksOut[q.id] = r;
    }
    setError('');
    try {
      await onSubmit({
        type: 'SUBMIT_CHECKLIST',
        checklistProfileId: action.params.checklistProfileId,
        versionPin: action.params.versionPin,
        afterStage: action.params.afterStage,
        answers: answersOut,
        ...(Object.keys(remarksOut).length > 0 ? { remarks: remarksOut } : {}),
      });
      setOpen(false);
      setAnswers({});
      setRemarks({});
    } catch (e: any) {
      setError(e?.message ?? 'Submit failed');
    }
  };

  return (
    <>
      <BaseActionButton
        actionType="SUBMIT_CHECKLIST"
        variant="primary"
        label={action.label}
        disabled={disabled}
        loading={loading && !open}
        onClick={handleClick}
      />
      <ActionDialog
        open={open}
        title={action.label}
        subtitle={`After stage: ${action.params.afterStage}`}
        submitLabel="Submit Answers"
        loading={loading}
        error={error}
        onCancel={handleCancel}
        onSubmit={handleSubmit}
      >
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {questions.length === 0 ? (
            <p className="text-sm text-slate-500">No questions in this checklist.</p>
          ) : null}
          {questions.map((q, idx) => (
            <div key={q.id} className="rounded border border-slate-200 bg-slate-50 p-3" data-question-id={q.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="text-sm font-medium text-slate-800">
                  {idx + 1}. {q.question}
                  {q.required ? <span className="ml-1 text-red-600">*</span> : null}
                </div>
              </div>
              {q.description ? <p className="mt-1 text-xs text-slate-500">{q.description}</p> : null}
              <div className="mt-2 flex flex-wrap gap-3">
                {ANSWER_CHOICES.map(c => (
                  <label key={c} className="inline-flex items-center gap-1 text-sm text-slate-700">
                    <input
                      type="radio"
                      name={`q-${q.id}`}
                      value={c}
                      checked={answers[q.id] === c}
                      onChange={() => setAnswers(prev => ({ ...prev, [q.id]: c }))}
                      disabled={loading}
                      data-answer-radio={c}
                    />
                    {c}
                  </label>
                ))}
              </div>
              <textarea
                rows={2}
                placeholder="Remarks (optional)"
                value={remarks[q.id] ?? ''}
                onChange={e => setRemarks(prev => ({ ...prev, [q.id]: e.target.value }))}
                disabled={loading}
                data-question-remarks
                className="mt-2 w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-blue-500 focus:outline-none"
              />
            </div>
          ))}
        </div>
      </ActionDialog>
    </>
  );
}
