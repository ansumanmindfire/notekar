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

export const TAG_COLORS = [
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'gray',
] as const;

export const tagColorSchema = z.enum(TAG_COLORS);

export const tagNameSchema = z
  .string()
  .min(1, 'Tag name is required')
  .max(50, 'Tag name must be at most 50 characters');

export const createTagSchema = z.object({
  name: tagNameSchema,
  color: tagColorSchema,
});

export const updateTagSchema = z
  .object({
    name: tagNameSchema.optional(),
    color: tagColorSchema.optional(),
  })
  .refine((data) => data.name !== undefined || data.color !== undefined, {
    message: 'At least one of name or color must be provided',
  });

const tagIdsBodySchema = z.array(z.string()).optional();

export const createNoteSchema = z.object({
  title: titleSchema,
  body: tipTapBodySchema,
  tagIds: tagIdsBodySchema,
});

export const updateNoteSchema = z
  .object({
    title: titleSchema.optional(),
    body: tipTapBodySchema.optional(),
    tagIds: tagIdsBodySchema,
  })
  .refine(
    (data) => data.title !== undefined || data.body !== undefined || data.tagIds !== undefined,
    {
      message: 'At least one of title, body, or tagIds must be provided',
    },
  );

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export const noteSortSchema = z
  .enum(['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'])
  .default('createdAt:desc');

// Comma-separated tag IDs in the query string (e.g. `?tagIds=t1,t2`), parsed
// into an array. Absent/empty input yields undefined (no filter applied).
export const tagIdsQuerySchema = z.preprocess((val) => {
  if (typeof val !== 'string' || val.length === 0) {
    return undefined;
  }
  const ids = val.split(',').filter((id) => id.length > 0);
  return ids.length > 0 ? ids : undefined;
}, z.array(z.string()).optional());

export const listNotesQuerySchema = paginationQuerySchema.extend({
  sort: noteSortSchema,
  tagIds: tagIdsQuerySchema,
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;
export type NoteSort = z.infer<typeof noteSortSchema>;
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;
export type TagColor = z.infer<typeof tagColorSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
