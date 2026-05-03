import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Badge } from '@/components/ui/badge';
import { QTYPE, type ChecklistQuestion, type AnswerValue, type AnswerMap, type EntityInstance } from './types';
import { evaluateFormula, isQuestionVisible } from './helpers';
import { QuestionCard } from './components/QuestionCard';
import { LoadingSkeleton } from './components/LoadingSkeleton';
import { SuccessCard } from './components/SuccessCard';

// =============================================
// Main page component
// =============================================

export function ChecklistPage() {
  const { entityId } = useParams<{ entityId: string }>();
  const navigate = useNavigate();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // Fetch entity details
  const {
    data: entity,
    error: entityError,
    isLoading: entityLoading,
  } = useSWR<EntityInstance>(
    entityId ? `/api/assets/instances/${entityId}` : null,
  );

  // Answers map: questionId -> value
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      navigate(`/login?returnUrl=${encodeURIComponent(`/checklist/${entityId}`)}`, { replace: true });
    }
  }, [authLoading, user, navigate]);

  // Sync CALCULATED answers automatically
  useEffect(() => {
    const rawSchema2 = entity?.template?.checklistSchema;
    const calcRaw: any[] = Array.isArray(rawSchema2) ? rawSchema2 : (rawSchema2?.questions ?? []);
    if (calcRaw.length === 0) return;
    const questions = calcRaw.map((q: any, idx: number) => ({
      id: q.id || `q_${idx}`,
      type: q.type || q.questionType || 'TEXT',
      formula: q.formula || q.calculatedExpression,
    }));
    const calcQuestions = questions.filter(
      (q) => q.type === QTYPE.CALCULATED && q.formula,
    );
    if (calcQuestions.length === 0) return;

    setAnswers((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const q of calcQuestions) {
        const computed = evaluateFormula(q.formula!, prev);
        if (next[q.id] !== computed) {
          next[q.id] = computed;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [answers, entity]);

  const handleAnswer = useCallback(
    (id: string, value: AnswerValue) => {
      setAnswers((prev) => ({ ...prev, [id]: value }));
      // Clear error on change
      setErrors((prev) => {
        if (!prev[id]) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    },
    [],
  );

  // Normalize checklist schema â€” DB may store as flat array or {questions:[...]} object
  const rawSchema = entity?.template?.checklistSchema;
  const rawQuestions: any[] = Array.isArray(rawSchema)
    ? rawSchema
    : (rawSchema?.questions ?? []);
  const questions: ChecklistQuestion[] = rawQuestions.map((q: any, idx: number) => ({
    id: q.id || `q_${idx}`,
    label: q.label || q.question || `Question ${idx + 1}`,
    type: q.type || q.questionType || 'TEXT',
    required: q.required ?? false,
    options: q.options,
    helpText: q.helpText || q.description,
    unit: q.unit || q.numericUnit,
    min: q.min ?? q.numericMin,
    max: q.max ?? q.numericMax,
    formula: q.formula || q.calculatedExpression,
    condition: q.condition || (q.conditionalField ? { questionId: q.conditionalField, value: q.conditionalValue } : undefined),
  }));

  const visibleQuestions = questions.filter((q) =>
    isQuestionVisible(q, answers),
  );

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    for (const q of visibleQuestions) {
      if (!q.required) continue;
      if (q.type === QTYPE.CALCULATED) continue; // auto-computed

      const val = answers[q.id];

      if (q.type === QTYPE.MULTI_SELECT) {
        if (!Array.isArray(val) || val.length === 0) {
          newErrors[q.id] = 'Please select at least one option.';
        }
      } else if (q.type === QTYPE.YES_NO_COMMENT) {
        // Require the yes/no part
        const yn = typeof val === 'string'
          ? val.split('|')[0]
          : null;
        if (!yn) {
          newErrors[q.id] = 'Please answer Yes or No.';
        }
      } else {
        const strVal = val != null ? String(val).trim() : '';
        if (!strVal) {
          newErrors[q.id] = 'This field is required.';
        }
      }
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) {
      // Scroll to first error
      const firstErrId = Object.keys(errors)[0];
      if (firstErrId) {
        const el = document.getElementById(`question-${firstErrId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      toast.error('Please answer all required questions.');
      return;
    }

    setSubmitting(true);
    try {
      // Convert answers to flat object for API
      const responsesObj: Record<string, unknown> = {};
      Object.entries(answers).forEach(([questionId, value]) => {
        if (value !== null && value !== undefined) {
          responsesObj[questionId] = value;
        }
      });

      await apiClient.post('/api/data/checklist', {
        entityId,
        responses: responsesObj,
      });

      setSubmitted(true);
      toast.success('Checklist submitted successfully.');
    } catch (err: any) {
      const msg = err?.message ?? 'Please try again.';
      const isBodyTooLarge = msg.includes('too large') || msg.includes('BODY_TOO_LARGE');
      toast.error(
        isBodyTooLarge ? 'File too large' : 'Submission failed',
        isBodyTooLarge ? 'Photo exceeds the maximum size limit. Please use a smaller image (under 5 MB).' : msg,
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Render states ----

  if (authLoading || entityLoading) {
    return <LoadingSkeleton />;
  }

  if (!user) {
    // Redirect handled by useEffect above
    return null;
  }

  if (entityError) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <div className="bg-white rounded-2xl shadow-soft border border-red-100 p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto">
            <svg
              className="w-8 h-8 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-800">
            Entity Not Found
          </h2>
          <p className="text-sm text-slate-500">
            Unable to load the entity. It may not exist or you may not have
            access.
          </p>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (!entity) return null;

  const checklistSchema = entity.template?.checklistSchema;
  const hasQuestions = questions.length > 0;

  if (submitted) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50 pb-12">
        <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
          <SuccessCard
            entityName={entity.name}
            onBack={() => navigate(`/assets`)}
          />
          <div className="text-center">
            <button
              type="button"
              onClick={() => {
                setSubmitted(false);
                setAnswers({});
                setErrors({});
              }}
              className="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
            >
              Submit Another Checklist
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Main render ----

  const answeredCount = visibleQuestions.filter((q) => {
    if (q.type === QTYPE.CALCULATED) return true;
    const val = answers[q.id];
    if (Array.isArray(val)) return val.length > 0;
    return val != null && String(val).trim() !== '';
  }).length;
  const requiredCount = visibleQuestions.filter(
    (q) => q.required && q.type !== QTYPE.CALCULATED,
  ).length;
  const answeredRequiredCount = visibleQuestions.filter((q) => {
    if (!q.required || q.type === QTYPE.CALCULATED) return false;
    const val = answers[q.id];
    if (Array.isArray(val)) return val.length > 0;
    if (q.type === QTYPE.YES_NO_COMMENT) {
      const yn = typeof val === 'string' ? val.split('|')[0] : null;
      return !!yn;
    }
    return val != null && String(val).trim() !== '';
  }).length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100/50 pb-24">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-fade-in">

        {/* ---- Header card ---- */}
        <div className="bg-white rounded-2xl shadow-soft border border-slate-100 overflow-hidden">
          {/* Gradient accent bar */}
          <div className="h-1.5 bg-gradient-to-r from-[#1e3a5f] via-[#3b82f6] to-[#1e3a5f]" />
          <div className="p-5">
            {/* Back button + breadcrumb */}
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors mb-3"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back
            </button>

            <div className="flex items-start gap-3">
              {/* Entity icon */}
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#1e3a5f] to-[#3b82f6] flex items-center justify-center text-xl shadow-md flex-shrink-0">
                {entity.template?.icon ?? 'ðŸ“‹'}
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-bold text-slate-800 leading-tight truncate">
                  {entity.name}
                </h1>
                <p className="text-xs text-slate-500 mt-0.5 truncate">
                  {entity.template?.name}
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge variant="default" className="text-xs">
                    Checklist
                  </Badge>
                  <Badge
                    variant={
                      entity.status === 'ACTIVE'
                        ? 'success'
                        : entity.status === 'INACTIVE'
                        ? 'destructive'
                        : 'default'
                    }
                    className="text-xs"
                  >
                    {entity.status}
                  </Badge>
                </div>
              </div>
            </div>

            {checklistSchema?.title && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-sm font-semibold text-slate-700">
                  {checklistSchema.title}
                </p>
                {checklistSchema.description && (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {checklistSchema.description}
                  </p>
                )}
              </div>
            )}

            {/* Progress bar */}
            {hasQuestions && (
              <div className="mt-4 space-y-1.5">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">
                    {answeredCount} of {visibleQuestions.length} answered
                  </span>
                  <span className="text-xs text-slate-500">
                    {answeredRequiredCount}/{requiredCount} required
                  </span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#1e3a5f] to-[#3b82f6] rounded-full transition-all duration-500"
                    style={{
                      width:
                        visibleQuestions.length > 0
                          ? `${(answeredCount / visibleQuestions.length) * 100}%`
                          : '0%',
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---- No checklist configured ---- */}
        {!hasQuestions && (
          <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-8 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
              <svg
                className="w-7 h-7 text-slate-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
                />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-600">
              No checklist configured
            </p>
            <p className="text-xs text-slate-400">
              This entity's template does not have a checklist schema defined.
            </p>
          </div>
        )}

        {/* ---- Question cards ---- */}
        {hasQuestions && (
          <div className="space-y-3">
            {visibleQuestions.map((q, idx) => (
              <div id={`question-${q.id}`} key={q.id}>
                <QuestionCard
                  question={q}
                  index={idx}
                  answer={answers[q.id] ?? null}
                  onAnswer={handleAnswer}
                  error={errors[q.id] ?? null}
                  answers={answers}
                />
              </div>
            ))}
          </div>
        )}

        {/* ---- Spacer for fixed submit button ---- */}
        {hasQuestions && <div className="h-24" />}
      </div>

      {/* ---- Fixed submit button ---- */}
      {hasQuestions && (
        <div className="fixed bottom-0 left-0 right-0 z-30 p-4 bg-white/95 backdrop-blur-sm border-t border-slate-200">
          <div className="max-w-lg mx-auto">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className={[
                'w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl',
                'bg-gradient-to-r from-[#1e3a5f] to-[#3b82f6] text-white text-sm font-semibold',
                'shadow-md hover:shadow-lg active:scale-[0.98] transition-all duration-200',
                submitting ? 'opacity-70 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              {submitting ? (
                <>
                  {/* Loading spinner */}
                  <svg
                    className="w-4 h-4 animate-spin"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                    />
                  </svg>
                  Submitting...
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Submit Checklist
                </>
              )}
            </button>
            {Object.keys(errors).length > 0 && (
              <p className="text-center text-xs text-red-500 mt-2">
                Please answer all required fields before submitting.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}