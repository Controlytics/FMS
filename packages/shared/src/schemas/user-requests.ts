import { z } from 'zod';

export const createUserRequestSchema = z.object({
  requestedUserId: z.string().min(1, 'User ID is required').max(50),
  fullName: z.string().min(1, 'Full name is required').max(100),
  department: z.string().max(50).optional(),
  email: z.string().email('Invalid email address').max(100),
  roleName: z.string().min(1, 'Role is required'),
});

export const userRequestQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const rejectUserRequestSchema = z.object({
  rejectionReason: z.string().min(1, 'Rejection reason is required').max(500),
});

export type CreateUserRequestInput = z.infer<typeof createUserRequestSchema>;
export type UserRequestQueryInput = z.infer<typeof userRequestQuerySchema>;
export type RejectUserRequestInput = z.infer<typeof rejectUserRequestSchema>;
