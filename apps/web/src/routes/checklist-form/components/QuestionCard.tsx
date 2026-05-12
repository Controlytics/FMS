import { QTYPE, type ChecklistQuestion, type AnswerValue, type AnswerMap } from '../types';
import { evaluateFormula } from '../helpers';
import { ToggleGroup } from './ToggleGroup';
import { RadioGroup } from './RadioGroup';
import { CheckboxGroup } from './CheckboxGroup';
import { SignatureInput } from './SignatureInput';
import { PhotoInput } from './PhotoInput';

// =============================================
// Question card
// =============================================

export interface QuestionCardProps {
  question: ChecklistQuestion;
  index: number;
  answer: AnswerValue;
  onAnswer: (id: string, value: AnswerValue) => void;
  error: string | null;
  answers: AnswerMap; // needed for CALCULATED
}

export function QuestionCard({
  question,
  index,
  answer,
  onAnswer,
  error,
  answers,
}: QuestionCardProps) {
  const strVal = answer != null ? String(answer) : null;
  const arrVal: string[] = Array.isArray(answer) ? answer : [];

  const renderInput = () => {
    switch (question.type) {
      case QTYPE.PASS_FAIL:
        return (
          <ToggleGroup
            options={[
              {
                label: 'Pass',
                value: 'PASS',
                activeClass: 'bg-emerald-500 text-white',
              },
              {
                label: 'Fail',
                value: 'FAIL',
                activeClass: 'bg-red-500 text-white',
              },
            ]}
            value={strVal}
            onChange={(v) => onAnswer(question.id, v)}
          />
        );

      case QTYPE.YES_NO:
        return (
          <ToggleGroup
            options={[
              {
                label: 'Yes',
                value: 'YES',
                activeClass: 'bg-emerald-500 text-white',
              },
              {
                label: 'No',
                value: 'NO',
                activeClass: 'bg-red-500 text-white',
              },
            ]}
            value={strVal}
            onChange={(v) => onAnswer(question.id, v)}
          />
        );

      case QTYPE.YES_NO_NA:
        return (
          <ToggleGroup
            options={[
              {
                label: 'Yes',
                value: 'YES',
                activeClass: 'bg-emerald-500 text-white',
              },
              {
                label: 'No',
                value: 'NO',
                activeClass: 'bg-red-500 text-white',
              },
              {
                label: 'N/A',
                value: 'NA',
                activeClass: 'bg-slate-500 text-white',
              },
            ]}
            value={strVal}
            onChange={(v) => onAnswer(question.id, v)}
          />
        );

      case QTYPE.MCQ:
        return (
          <RadioGroup
            options={question.options ?? []}
            value={strVal}
            onChange={(v) => onAnswer(question.id, v)}
          />
        );

      case QTYPE.MULTI_SELECT:
        return (
          <CheckboxGroup
            options={question.options ?? []}
            value={arrVal}
            onChange={(v) => onAnswer(question.id, v)}
          />
        );

      case QTYPE.TEXT:
        return (
          <textarea
            value={strVal ?? ''}
            onChange={(e) => onAnswer(question.id, e.target.value || null)}
            rows={3}
            placeholder="Enter your response..."
            className={[
              'w-full px-4 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder-slate-400 bg-white resize-none',
              'focus:outline-none focus:ring-0 transition-colors',
              error
                ? 'border-red-300 focus:border-red-500'
                : 'border-slate-200 focus:border-blue-500',
            ].join(' ')}
          />
        );

      case QTYPE.NUMERIC: {
        const numStr = strVal ?? '';
        return (
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={numStr}
              min={question.min}
              max={question.max}
              step="any"
              onChange={(e) =>
                onAnswer(question.id, e.target.value || null)
              }
              placeholder="0"
              className={[
                'flex-1 px-4 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder-slate-400 bg-white',
                'focus:outline-none focus:ring-0 transition-colors',
                error
                  ? 'border-red-300 focus:border-red-500'
                  : 'border-slate-200 focus:border-blue-500',
              ].join(' ')}
            />
            {question.unit && (
              <span className="px-3 py-3 rounded-xl bg-slate-100 text-sm text-slate-600 font-medium whitespace-nowrap border-2 border-slate-200">
                {question.unit}
              </span>
            )}
          </div>
        );
      }

      case QTYPE.DROPDOWN:
        return (
          <div className="relative">
            <select
              value={strVal ?? ''}
              onChange={(e) =>
                onAnswer(question.id, e.target.value || null)
              }
              className={[
                'w-full appearance-none px-4 py-3 pr-10 rounded-xl border-2 text-sm text-slate-800 bg-white',
                'focus:outline-none focus:ring-0 transition-colors',
                error
                  ? 'border-red-300 focus:border-red-500'
                  : 'border-slate-200 focus:border-blue-500',
                !strVal ? 'text-slate-400' : '',
              ].join(' ')}
            >
              <option value="">Select an option...</option>
              {(question.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
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
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          </div>
        );

      case QTYPE.PHOTO:
        return (
          <PhotoInput
            value={strVal}
            onChange={(v) => onAnswer(question.id, v)}
          />
        );

      case QTYPE.DATE_TIME:
        return (
          <input
            type="datetime-local"
            value={strVal ?? ''}
            onChange={(e) =>
              onAnswer(question.id, e.target.value || null)
            }
            className={[
              'w-full px-4 py-3 rounded-xl border-2 text-sm text-slate-800 bg-white',
              'focus:outline-none focus:ring-0 transition-colors',
              error
                ? 'border-red-300 focus:border-red-500'
                : 'border-slate-200 focus:border-blue-500',
            ].join(' ')}
          />
        );

      case QTYPE.SIGNATURE:
        return (
          <SignatureInput
            value={strVal}
            onChange={(v) => onAnswer(question.id, v)}
          />
        );

      case QTYPE.YES_NO_COMMENT: {
        const yesNoVal = strVal
          ? strVal.startsWith('YES') || strVal === 'YES'
            ? 'YES'
            : strVal.startsWith('NO') || strVal === 'NO'
            ? 'NO'
            : null
          : null;
        // comment is stored after a pipe: "YES|comment text"
        const commentVal =
          strVal && strVal.includes('|')
            ? strVal.split('|').slice(1).join('|')
            : '';

        const updateAnswer = (yn: string | null, comment: string) => {
          if (!yn) {
            onAnswer(question.id, null);
          } else if (comment) {
            onAnswer(question.id, `${yn}|${comment}`);
          } else {
            onAnswer(question.id, yn);
          }
        };

        return (
          <div className="space-y-3">
            <ToggleGroup
              options={[
                {
                  label: 'Yes',
                  value: 'YES',
                  activeClass: 'bg-emerald-500 text-white',
                },
                {
                  label: 'No',
                  value: 'NO',
                  activeClass: 'bg-red-500 text-white',
                },
              ]}
              value={yesNoVal}
              onChange={(v) => updateAnswer(v, commentVal)}
            />
            {yesNoVal && (
              <div className="animate-fade-in">
                <textarea
                  value={commentVal}
                  onChange={(e) =>
                    updateAnswer(yesNoVal, e.target.value)
                  }
                  rows={2}
                  placeholder="Add a comment (optional)..."
                  className="w-full px-4 py-3 rounded-xl border-2 border-slate-200 text-sm text-slate-800 placeholder-slate-400 bg-white resize-none focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            )}
          </div>
        );
      }

      case QTYPE.CALCULATED: {
        const computed = question.formula
          ? evaluateFormula(question.formula, answers)
          : 'â€”';
        // Store computed value so it's included in submission
        // We use useEffect in the parent; here we just render read-only
        return (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-50 border-2 border-slate-200">
            <svg
              className="w-4 h-4 text-slate-400 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 4h16v16H4V4z"
              />
            </svg>
            <span className="text-base font-semibold text-slate-700">
              {computed}
            </span>
            {question.unit && (
              <span className="text-sm text-slate-500">{question.unit}</span>
            )}
            <span className="ml-auto text-xs text-slate-400 italic">
              Calculated
            </span>
          </div>
        );
      }

      case QTYPE.CONDITIONAL:
        // CONDITIONAL uses the same TEXT input but is shown/hidden based on condition
        return (
          <textarea
            value={strVal ?? ''}
            onChange={(e) => onAnswer(question.id, e.target.value || null)}
            rows={3}
            placeholder="Enter your response..."
            className={[
              'w-full px-4 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder-slate-400 bg-white resize-none',
              'focus:outline-none focus:ring-0 transition-colors',
              error
                ? 'border-red-300 focus:border-red-500'
                : 'border-slate-200 focus:border-blue-500',
            ].join(' ')}
          />
        );

      default:
        return (
          <p className="text-sm text-slate-400 italic">
            Unsupported question type: {question.type}
          </p>
        );
    }
  };

  return (
    <div
      className={[
        'bg-white rounded-2xl shadow-soft border border-slate-100 p-5 space-y-4',
        'animate-fade-in',
      ].join(' ')}
    >
      {/* Question header */}
      <div className="flex items-start gap-3">
        {/* Number badge */}
        <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-[#1e3a5f] to-[#3b82f6] flex items-center justify-center shadow-sm">
          <span className="text-white text-xs font-bold">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-start gap-1.5 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 leading-snug">
              {question.label}
            </span>
            {question.required && (
              <span className="text-red-500 text-sm font-bold leading-snug flex-shrink-0">
                *
              </span>
            )}
          </div>
          {question.helpText && (
            <p className="text-xs text-slate-500 leading-relaxed">
              {question.helpText}
            </p>
          )}
          {question.type === QTYPE.NUMERIC &&
            (question.min !== undefined || question.max !== undefined) && (
              <p className="text-xs text-slate-400">
                {question.min !== undefined && `Min: ${question.min}`}
                {question.min !== undefined &&
                  question.max !== undefined &&
                  ' Â· '}
                {question.max !== undefined && `Max: ${question.max}`}
              </p>
            )}
        </div>
      </div>

      {/* Input */}
      <div className="pl-10">{renderInput()}</div>

      {/* Validation error */}
      {error && (
        <div className="pl-10">
          <div className="flex items-center gap-1.5 text-xs text-red-600">
            <svg
              className="w-3.5 h-3.5 flex-shrink-0"
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
            {error}
          </div>
        </div>
      )}
    </div>
  );
}
