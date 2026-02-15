import { z } from 'zod';

export const QUESTION_TYPES = [
  'PASS_FAIL', 'MCQ', 'MULTI_SELECT', 'FILL_BLANK', 'DROPDOWN',
  'NUMERIC_WITH_LIMITS', 'PHOTO', 'DATE_TIME', 'SIGNATURE',
  'YES_NO_COMMENT', 'CALCULATED', 'CONDITIONAL',
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export const CHECKLIST_RECORD_STATUSES = [
  'DRAFT', 'SUBMITTED', 'PENDING_CHECK', 'PENDING_VERIFY', 'COMPLETED', 'REJECTED',
] as const;

export type ChecklistRecordStatus = (typeof CHECKLIST_RECORD_STATUSES)[number];

export const questionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1, 'Question label is required'),
  type: z.enum(QUESTION_TYPES),
  required: z.boolean().default(true),
  // MCQ / MULTI_SELECT / DROPDOWN options
  options: z.array(z.string()).optional(),
  // NUMERIC_WITH_LIMITS
  minValue: z.number().optional(),
  maxValue: z.number().optional(),
  unit: z.string().optional(),
  // CALCULATED
  formula: z.string().optional(),
  dependsOn: z.array(z.string()).optional(),
  // CONDITIONAL
  condition: z.object({
    questionId: z.string(),
    operator: z.enum(['equals', 'not_equals', 'gt', 'lt', 'contains']),
    value: z.unknown(),
  }).optional(),
  // General
  helpText: z.string().optional(),
  placeholder: z.string().optional(),
});

export type Question = z.infer<typeof questionSchema>;

export const createChecklistTemplateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().optional(),
  questions: z.array(questionSchema).min(1, 'At least one question is required'),
  performedByRole: z.string().optional(),
  checkedByEnabled: z.boolean().default(false),
  checkedByRole: z.string().optional(),
  verifiedByEnabled: z.boolean().default(false),
  verifiedByRole: z.string().optional(),
  templateId: z.string().uuid().optional(),
});

export const updateChecklistTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  questions: z.array(questionSchema).optional(),
  performedByRole: z.string().optional(),
  checkedByEnabled: z.boolean().optional(),
  checkedByRole: z.string().optional(),
  verifiedByEnabled: z.boolean().optional(),
  verifiedByRole: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  reason: z.string().min(1, 'Reason for change is required'),
});

export const attachChecklistSchema = z.object({
  checklistTemplateId: z.string().uuid('Checklist template ID is required'),
  enabled: z.boolean().default(true),
  overrideApproval: z.boolean().default(false),
});

export const submitChecklistRecordSchema = z.object({
  responses: z.record(z.unknown()),
  performedSignature: z.string().optional(),
  scheduleRef: z.string().optional(),
  deviceInfo: z.object({
    type: z.string().optional(),
    ip: z.string().optional(),
    userAgent: z.string().optional(),
    sessionId: z.string().optional(),
  }).optional(),
});

export const approveRejectSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comments: z.string().optional(),
  signature: z.string().optional(),
});

export const checklistQuerySchema = z.object({
  status: z.string().optional(),
  search: z.string().optional(),
});

export const checklistParamsSchema = z.object({
  id: z.string().uuid(),
});

export const nodeChecklistParamsSchema = z.object({
  checklistId: z.string().uuid(),
});

export const recordParamsSchema = z.object({
  id: z.string().uuid(),
});

export type CreateChecklistTemplateInput = z.infer<typeof createChecklistTemplateSchema>;
export type UpdateChecklistTemplateInput = z.infer<typeof updateChecklistTemplateSchema>;
export type AttachChecklistInput = z.infer<typeof attachChecklistSchema>;
export type SubmitChecklistRecordInput = z.infer<typeof submitChecklistRecordSchema>;
export type ApproveRejectInput = z.infer<typeof approveRejectSchema>;
