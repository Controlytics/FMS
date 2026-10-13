import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1, 'User ID is required'),
  password: z.string().min(1, 'Password is required'),
  force: z.boolean().optional(),
  // 'tablet' = the DigiLog FilterOps app. The server then refuses a role
  // without tablet login access BEFORE it ends any existing session.
  client: z.enum(['web', 'tablet']).optional(),
});

export const passwordChangeSchema = z.object({
  currentPassword: z.string().optional(), // Optional for temporary password users
  newPassword: z.string().min(8, 'Minimum 8 characters'),
  confirmPassword: z.string().min(1, 'Please confirm your password'),
}).refine((d) => d.newPassword === d.confirmPassword, {
  message: 'Passwords must match',
  path: ['confirmPassword'],
});

export type LoginInput = z.infer<typeof loginSchema>;
export type PasswordChangeInput = z.infer<typeof passwordChangeSchema>;
