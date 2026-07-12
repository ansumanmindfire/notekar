import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
  .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const registerSchema = z.object({
  email: z.email('Invalid email address'),
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: z.email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

export const forgotPasswordSchema = z.object({
  email: z.email('Invalid email address'),
});

export const resetPasswordSchema = z.object({
  email: z.email('Invalid email address'),
  otp: z.string().regex(/^[0-9]{6}$/, 'OTP must be a 6-digit code'),
  newPassword: passwordSchema,
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// TipTap JSON document is not validated field-by-field - only that it is a
// plain object. Content correctness is the editor's concern, not the API's.
const tipTapBodySchema = z.record(z.string(), z.unknown());

export const titleSchema = z
  .string()
  .min(1, 'Title is required')
  .max(200, 'Title must be at most 200 characters');

export const createNoteSchema = z.object({
  title: titleSchema,
  body: tipTapBodySchema,
});

export const updateNoteSchema = z
  .object({
    title: titleSchema.optional(),
    body: tipTapBodySchema.optional(),
  })
  .refine((data) => data.title !== undefined || data.body !== undefined, {
    message: 'At least one of title or body must be provided',
  });

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const noteSortSchema = z
  .enum(['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'])
  .default('createdAt:desc');

export const listNotesQuerySchema = paginationQuerySchema.extend({
  sort: noteSortSchema,
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type NoteSort = z.infer<typeof noteSortSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;
