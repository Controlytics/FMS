import { QTYPE, type ChecklistQuestion, type AnswerMap } from './types';

export function evaluateFormula(formula: string, answers: AnswerMap): string {
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

export function isQuestionVisible(
  question: ChecklistQuestion,
  answers: AnswerMap,
): boolean {
  if (question.type !== QTYPE.CONDITIONAL || !question.condition) return true;
  const { questionId, value } = question.condition;
  const ans = answers[questionId];
  if (Array.isArray(ans)) return ans.includes(value);
  return String(ans ?? '') === value;
}
