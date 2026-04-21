import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useSWR from 'swr';
import SignaturePad from 'signature_pad';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';


// =============================================
// Types
// =============================================

interface ChecklistQuestion {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  helpText?: string;
  unit?: string;
  min?: number;
  max?: number;
  formula?: string;
  condition?: { questionId: string; value: string };
}

interface ChecklistSchema {
  questions: ChecklistQuestion[];
  title?: string;
  description?: string;
}

interface EntityInstance {
  id: string;
  name: string;
  description?: string;
  status: string;
  template: {
    id: string;
    name: string;
    icon: string;
    checklistSchema?: ChecklistSchema;
  };
}

type AnswerValue = string | string[] | null;

type AnswerMap = Record<string, AnswerValue>;

// =============================================
// Question type constants
// =============================================

const QTYPE = {
  PASS_FAIL: 'PASS_FAIL',
  YES_NO: 'YES_NO',
  YES_NO_NA: 'YES_NO_NA',
  MCQ: 'MCQ',
  MULTI_SELECT: 'MULTI_SELECT',
  TEXT: 'TEXT',
  NUMERIC: 'NUMERIC',
  DROPDOWN: 'DROPDOWN',
  PHOTO: 'PHOTO',
  DATE_TIME: 'DATE_TIME',
  SIGNATURE: 'SIGNATURE',
  YES_NO_COMMENT: 'YES_NO_COMMENT',
  CALCULATED: 'CALCULATED',
  CONDITIONAL: 'CONDITIONAL',
} as const;

// =============================================
// Helpers
// =============================================

function evaluateFormula(formula: string, answers: AnswerMap): string {
  try {
    // Replace question IDs with their numeric values
    let expression = formula;
    Object.entries(answers).forEach(([qId, val]) => {
      const num = parseFloat(String(val ?? ''));
      if (!isNaN(num)) {
        expression = expression.replaceAll(qId, String(num));
      }
    });
    // Simple safe eval â€” only allow numbers, operators, parens, whitespace
    if (/^[\d\s+\-*/().]+$/.test(expression)) {
      // eslint-disable-next-line no-new-func
      const result = Function(`"use strict"; return (${expression})`)();
      if (typeof result === 'number' && isFinite(result)) {
        return String(Math.round(result * 1000) / 1000);
      }
    }
  } catch {
    // fall through
  }
  return 'â€”';
}

function isQuestionVisible(
  question: ChecklistQuestion,
  answers: AnswerMap,
): boolean {
  if (question.type !== QTYPE.CONDITIONAL || !question.condition) return true;
  const { questionId, value } = question.condition;
  const ans = answers[questionId];
  if (Array.isArray(ans)) return ans.includes(value);
  return String(ans ?? '') === value;
}

// =============================================
// Sub-components for each question type
// =============================================

// Toggle button group (PASS_FAIL / YES_NO / YES_NO_NA)
interface ToggleGroupProps {
  options: { label: string; value: string; activeClass: string }[];
  value: string | null;
  onChange: (v: string) => void;
  disabled?: boolean;
}
function ToggleGroup({ options, value, onChange, disabled }: ToggleGroupProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={[
            'flex-1 min-w-[80px] px-4 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all duration-150 active:scale-[0.98]',
            value === opt.value
              ? `${opt.activeClass} border-transparent shadow-md`
              : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
          ].join(' ')}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// MCQ â€” radio group
interface RadioGroupProps {
  options: string[];
  value: string | null;
  onChange: (v: string) => void;
}
function RadioGroup({ options, value, onChange }: RadioGroupProps) {
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt}
          onClick={() => onChange(opt)}
          className={[
            'flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-150',
            value === opt
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
          ].join(' ')}
        >
          <div
            className={[
              'w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0',
              value === opt ? 'border-blue-500' : 'border-slate-300',
            ].join(' ')}
          >
            {value === opt && (
              <div className="w-2 h-2 rounded-full bg-blue-500" />
            )}
          </div>
          <span className="text-sm text-slate-700 font-medium">{opt}</span>
        </label>
      ))}
    </div>
  );
}

// MULTI_SELECT â€” checkbox group
interface CheckboxGroupProps {
  options: string[];
  value: string[];
  onChange: (v: string[]) => void;
}
function CheckboxGroup({ options, value, onChange }: CheckboxGroupProps) {
  const toggle = (opt: string) => {
    if (value.includes(opt)) {
      onChange(value.filter((v) => v !== opt));
    } else {
      onChange([...value, opt]);
    }
  };
  return (
    <div className="space-y-2">
      {options.map((opt) => (
        <label
          key={opt}
          onClick={() => toggle(opt)}
          className={[
            'flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all duration-150',
            value.includes(opt)
              ? 'border-blue-500 bg-blue-50'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
          ].join(' ')}
        >
          <div
            className={[
              'w-4 h-4 rounded-lg border-2 flex items-center justify-center flex-shrink-0',
              value.includes(opt)
                ? 'border-blue-500 bg-blue-500'
                : 'border-slate-300 bg-white',
            ].join(' ')}
          >
            {value.includes(opt) && (
              <svg
                className="w-3 h-3 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={3}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
          </div>
          <span className="text-sm text-slate-700 font-medium">{opt}</span>
        </label>
      ))}
    </div>
  );
}

// SIGNATURE â€” canvas pad
interface SignatureInputProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}
function SignatureInput({ value, onChange }: SignatureInputProps) {
  const canvasRef = useRef<HTMLCanvasElement>(undefined as unknown as HTMLCanvasElement);
  const padRef = useRef<SignaturePad>(undefined as unknown as SignaturePad);

  useEffect(() => {
    if (!canvasRef.current) return;
    const pad = new SignaturePad(canvasRef.current, {
      backgroundColor: 'rgb(248, 250, 252)',
      penColor: '#1e3a5f',
      minWidth: 1,
      maxWidth: 3,
    });
    padRef.current = pad;
    pad.addEventListener('endStroke', () => {
      onChange(pad.isEmpty() ? null : pad.toDataURL('image/png'));
    });
    // Resize canvas to display size
    const canvas = canvasRef.current;
    const ratio = Math.max(window.devicePixelRatio ?? 1, 1);
    canvas.width = canvas.offsetWidth * ratio;
    canvas.height = canvas.offsetHeight * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.scale(ratio, ratio);
    pad.clear();
    return () => {
      pad.off();
    };
  }, [onChange]);

  // Restore existing signature if provided
  useEffect(() => {
    if (!padRef.current || !value) return;
    padRef.current.fromDataURL(value);
  }, [value]);

  const handleClear = () => {
    padRef.current?.clear();
    onChange(null);
  };

  const handleUndo = () => {
    if (!padRef.current) return;
    const data = padRef.current.toData();
    if (data && data.length > 0) {
      data.pop();
      padRef.current.fromData(data);
      onChange(
        padRef.current.isEmpty()
          ? null
          : padRef.current.toDataURL('image/png'),
      );
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl border-2 border-slate-200 overflow-hidden bg-slate-50">
        <canvas
          ref={canvasRef}
          className="w-full touch-none"
          style={{ height: '160px', display: 'block' }}
        />
        {!value && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm text-slate-400 italic">Sign here...</span>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleUndo}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
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
              d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
            />
          </svg>
          Undo
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 transition-colors"
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
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          Clear
        </button>
        {value && (
          <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-emerald-600 bg-emerald-50">
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
                d="M5 13l4 4L19 7"
              />
            </svg>
            Signed
          </span>
        )}
      </div>
    </div>
  );
}

// PHOTO â€” file input
interface PhotoInputProps {
  value: string | null;
  onChange: (dataUrl: string | null) => void;
}
function PhotoInput({ value, onChange }: PhotoInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB

  const compressImage = (dataUrl: string, quality: number, maxDim: number): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = dataUrl;
    });
  };

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;

      // Check if base64 size exceeds limit
      if (dataUrl.length > MAX_PHOTO_BYTES) {
        const sizeMB = (file.size / 1024 / 1024).toFixed(1);
        const shouldCompress = window.confirm(
          `Photo is ${sizeMB} MB which exceeds the 5 MB limit.\n\nWould you like to compress it automatically? The image will be resized and quality reduced to fit.`
        );
        if (!shouldCompress) {
          if (fileRef.current) fileRef.current.value = '';
          return;
        }
        // Progressively compress until under limit
        let compressed = dataUrl;
        const attempts = [
          { quality: 0.7, maxDim: 1920 },
          { quality: 0.5, maxDim: 1280 },
          { quality: 0.3, maxDim: 800 },
        ];
        for (const { quality, maxDim } of attempts) {
          compressed = await compressImage(dataUrl, quality, maxDim);
          if (compressed.length <= MAX_PHOTO_BYTES) break;
        }
        if (compressed.length > MAX_PHOTO_BYTES) {
          alert('Could not compress the image enough. Please use a smaller photo.');
          if (fileRef.current) fileRef.current.value = '';
          return;
        }
        const compressedMB = (compressed.length / 1024 / 1024).toFixed(1);
        onChange(compressed);
        return;
      }
      onChange(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleRemove = () => {
    onChange(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative inline-block">
          <img
            src={value}
            alt="Captured"
            className="w-full max-h-48 object-cover rounded-xl border border-slate-200"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center shadow-md hover:bg-red-700 transition-colors"
          >
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="w-full py-8 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 hover:border-blue-400 transition-all flex flex-col items-center gap-2 text-slate-500 hover:text-blue-600"
        >
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          <span className="text-sm font-medium">Tap to capture photo</span>
          <span className="text-xs text-slate-400">Camera or gallery</span>
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleChange}
      />
    </div>
  );
}

// =============================================
// Question card
// =============================================

interface QuestionCardProps {
  question: ChecklistQuestion;
  index: number;
  answer: AnswerValue;
  onAnswer: (id: string, value: AnswerValue) => void;
  error: string | null;
  answers: AnswerMap; // needed for CALCULATED
}

function QuestionCard({
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

// =============================================
// Loading skeleton
// =============================================

function LoadingSkeleton() {
  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-4 animate-pulse">
      <div className="bg-white rounded-2xl shadow-soft border border-slate-100 p-5 space-y-3">
        <div className="h-4 bg-slate-200 rounded-lg w-3/4" />
        <div className="h-3 bg-slate-100 rounded-lg w-1/2" />
      </div>
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-2xl shadow-soft border border-slate-100 p-5 space-y-4"
        >
          <div className="flex items-start gap-3">
            <div className="w-7 h-7 rounded-lg bg-slate-200 flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3.5 bg-slate-200 rounded-lg w-4/5" />
              <div className="h-3 bg-slate-100 rounded-lg w-2/3" />
            </div>
          </div>
          <div className="pl-10 h-12 bg-slate-100 rounded-xl" />
        </div>
      ))}
    </div>
  );
}

// =============================================
// Success card
// =============================================

function SuccessCard({
  entityName,
  onBack,
}: {
  entityName: string;
  onBack: () => void;
}) {
  return (
    <div className="max-w-lg mx-auto px-4 py-12 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-elevated border border-slate-100 p-8 text-center space-y-6">
        {/* Green checkmark */}
        <div className="w-20 h-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
          <svg
            className="w-10 h-10 text-emerald-600"
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
        </div>

        <div className="space-y-2">
          <h2 className="text-xl font-bold text-slate-800">
            Checklist Submitted
          </h2>
          <p className="text-sm text-slate-500">
            Your checklist for{' '}
            <span className="font-semibold text-slate-700">{entityName}</span>{' '}
            has been recorded successfully.
          </p>
        </div>

        {/* Compliance badge */}
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-50 border border-emerald-200">
          <svg
            className="w-4 h-4 text-emerald-600"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
          <span className="text-sm font-semibold text-emerald-700">
            21 CFR Part 11 Compliant
          </span>
        </div>

        <button
          type="button"
          onClick={onBack}
          className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-r from-[#1e3a5f] to-[#3b82f6] text-white text-sm font-semibold shadow-md hover:shadow-lg active:scale-[0.98] transition-all"
        >
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
              d="M15 19l-7-7 7-7"
            />
          </svg>
          Back to Entity
        </button>
      </div>
    </div>
  );
}

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