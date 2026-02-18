import { z } from 'zod';

export const checklistResponseSchema = z.object({
  questionId: z.string().min(1),
  value: z.unknown(),
  timestamp: z.string().datetime().optional(),
  photoUrls: z.array(z.string()).optional(),
});

export const submitChecklistSchema = z.object({
  checklistTemplateId: z.string().uuid(),
  assetId: z.string().uuid(),
  responses: z.array(checklistResponseSchema).min(1),
  signatureMeaning: z.string().default('Checklist performed and submitted'),
});

export const reviewChecklistSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  comments: z.string().optional(),
  signatureMeaning: z.string().optional(),
}).refine(data => {
  if (data.action === 'REJECT' && (!data.comments || data.comments.trim() === '')) {
    return false;
  }
  return true;
}, { message: 'Comments are required when rejecting', path: ['comments'] });

export type ChecklistResponse = z.infer<typeof checklistResponseSchema>;
export type SubmitChecklistInput = z.infer<typeof submitChecklistSchema>;
export type ReviewChecklistInput = z.infer<typeof reviewChecklistSchema>;
