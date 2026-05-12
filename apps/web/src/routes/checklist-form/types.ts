export interface ChecklistQuestion {
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

export interface ChecklistSchema {
  questions: ChecklistQuestion[];
  title?: string;
  description?: string;
}

export interface EntityInstance {
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

export type AnswerValue = string | string[] | null;

export type AnswerMap = Record<string, AnswerValue>;

// =============================================
// Question type constants
// =============================================

export const QTYPE = {
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
