import { z } from 'zod';

export const createUserSchema = z.object({
  username: z.string().min(6, 'Minimum 6 characters').max(50, 'Maximum 50 characters'),
  fullName: z.string().min(1, 'Full name is required').max(100),
  // Email is optional (not mandatory at creation). Must be a valid email when
  // provided; '' / omitted are both accepted.
  email: z.union([z.literal(''), z.string().email('Invalid email address').max(100)]).optional(),
  department: z.string().max(50).optional(),
  role: z.string().min(1, 'Role is required'),
  password: z.string().min(8, 'Minimum 8 characters'),
  confirmPassword: z.string(),
  status: z.enum(["ENABLED", "DISABLED"]).default("ENABLED"),
}).refine((d) => d.password === d.confirmPassword, {
  message: 'Passwords must match',
  path: ['confirmPassword'],
});

export const updateUserSchema = z.object({
  fullName: z.string().min(1).max(100).optional(),
  // Email is optional on update (mirrors create). Must be a valid email when a
  // non-empty value is given; '' and null (an emailless user's edit form) are
  // both accepted so a role-only change isn't blocked by the email field.
  email: z.union([z.literal(''), z.string().email('Invalid email address').max(100)]).nullish(),
  department: z.string().max(50).optional(),
  role: z.string().min(1).optional(),
  status: z.enum(["ENABLED", "DISABLED"]).optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Minimum 8 characters'),
});

export const userQuerySchema = z.object({
  role: z.string().optional(),
  status: z.enum(['ENABLED', 'DISABLED', 'LOCKED', 'EXPIRED']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  // The `.default(20)` is what stops a MISSING limit pulling thousands of rows;
  // the `.max()` is the separate hard ceiling on an explicit request.
  //
  // Raised 100 → 1000 (2026-08-08). Recipient pickers legitimately need every
  // user in one page — the notification-rules rule/group editors and
  // SendForReviewButton all ask for `?limit=500`, and this install has 154
  // users. At the old ceiling those callers 500'd (zod threw past the error
  // handler); capping them at 100 instead would have been worse — 54 users
  // would silently vanish from a recipient picker with nothing on screen to
  // say so. The response carries only id/username/fullName/role/status-class
  // fields, so a 1000-row page is cheap.
  limit: z.coerce.number().min(1).max(1000).default(20),
});

export const bulkDeleteUsersSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1, 'At least one user ID is required').max(50, 'Maximum 50 users at once'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UserQueryInput = z.infer<typeof userQuerySchema>;
export type BulkDeleteUsersInput = z.infer<typeof bulkDeleteUsersSchema>;
