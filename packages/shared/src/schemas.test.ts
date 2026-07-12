import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  createNoteSchema,
  updateNoteSchema,
  paginationQuerySchema,
  noteSortSchema,
  listNotesQuerySchema,
  TAG_COLORS,
  tagColorSchema,
  tagNameSchema,
  createTagSchema,
  updateTagSchema,
  tagIdsQuerySchema,
  searchQuerySchema,
} from './schemas';

describe('registerSchema', () => {
  it('accepts a valid email and a password meeting all complexity rules', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'Passw0rd',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid email format', () => {
    const result = registerSchema.safeParse({
      email: 'not-an-email',
      password: 'Passw0rd',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'email')).toBe(true);
    }
  });

  it('rejects a password shorter than 8 characters', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'Pw0aB1a', // 7 chars
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'password')).toBe(true);
    }
  });

  it('rejects a password longer than 72 characters', () => {
    const longPassword = `Aa1${'a'.repeat(70)}`; // 73 chars, still has upper/lower/number
    expect(longPassword.length).toBeGreaterThan(72);

    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: longPassword,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'password')).toBe(true);
    }
  });

  it('rejects a password missing an uppercase letter', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'passw0rd',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'password')).toBe(true);
    }
  });

  it('rejects a password missing a lowercase letter', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'PASSW0RD',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'password')).toBe(true);
    }
  });

  it('rejects a password missing a number', () => {
    const result = registerSchema.safeParse({
      email: 'user@example.com',
      password: 'Passworda',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'password')).toBe(true);
    }
  });
});

describe('loginSchema', () => {
  it('accepts a valid email and any non-empty password, regardless of complexity', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'anyoldpassword', // no uppercase, no number - would fail registerSchema
    });

    expect(result.success).toBe(true);
  });

  it('does not enforce password complexity rules (unlike registerSchema)', () => {
    // A password that is short, all-lowercase, and has no digits still passes
    // loginSchema, since login must work for passwords created under
    // historical/pre-existing rules.
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: 'a',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid email format', () => {
    const result = loginSchema.safeParse({
      email: 'not-an-email',
      password: 'somepassword',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'email')).toBe(true);
    }
  });

  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({
      email: 'user@example.com',
      password: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'password')).toBe(true);
    }
  });
});

describe('forgotPasswordSchema', () => {
  it('accepts a valid email', () => {
    const result = forgotPasswordSchema.safeParse({
      email: 'user@example.com',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid email format', () => {
    const result = forgotPasswordSchema.safeParse({
      email: 'not-an-email',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'email')).toBe(true);
    }
  });
});

describe('resetPasswordSchema', () => {
  it('accepts a valid email, a 6-digit OTP, and a password meeting all complexity rules', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '123456',
      newPassword: 'Passw0rd',
    });

    expect(result.success).toBe(true);
  });

  it('rejects an invalid email format', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'not-an-email',
      otp: '123456',
      newPassword: 'Passw0rd',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'email')).toBe(true);
    }
  });

  it('rejects an OTP shorter than 6 digits', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '12345',
      newPassword: 'Passw0rd',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'otp')).toBe(true);
    }
  });

  it('rejects an OTP longer than 6 digits', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '1234567',
      newPassword: 'Passw0rd',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'otp')).toBe(true);
    }
  });

  it('rejects an OTP containing non-numeric characters', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '12a456',
      newPassword: 'Passw0rd',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'otp')).toBe(true);
    }
  });

  it('rejects a newPassword shorter than 8 characters', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '123456',
      newPassword: 'Pw0aB1a', // 7 chars
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'newPassword')).toBe(true);
    }
  });

  it('rejects a newPassword longer than 72 characters', () => {
    const longPassword = `Aa1${'a'.repeat(70)}`; // 73 chars, still has upper/lower/number
    expect(longPassword.length).toBeGreaterThan(72);

    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '123456',
      newPassword: longPassword,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'newPassword')).toBe(true);
    }
  });

  it('rejects a newPassword missing an uppercase letter', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '123456',
      newPassword: 'passw0rd',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'newPassword')).toBe(true);
    }
  });

  it('rejects a newPassword missing a lowercase letter', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '123456',
      newPassword: 'PASSW0RD',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'newPassword')).toBe(true);
    }
  });

  it('rejects a newPassword missing a number', () => {
    const result = resetPasswordSchema.safeParse({
      email: 'user@example.com',
      otp: '123456',
      newPassword: 'Passworda',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'newPassword')).toBe(true);
    }
  });
});

describe('createNoteSchema', () => {
  it('accepts a valid title and a TipTap JSON body', () => {
    const result = createNoteSchema.safeParse({
      title: 'My Note',
      body: { type: 'doc', content: [] },
    });

    expect(result.success).toBe(true);
  });

  it('accepts a title of exactly 200 characters', () => {
    const title = 'a'.repeat(200);

    const result = createNoteSchema.safeParse({
      title,
      body: { type: 'doc', content: [] },
    });

    expect(result.success).toBe(true);
  });

  it('rejects a title of 201 characters', () => {
    const title = 'a'.repeat(201);

    const result = createNoteSchema.safeParse({
      title,
      body: { type: 'doc', content: [] },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'title')).toBe(true);
    }
  });

  it('rejects an empty title', () => {
    const result = createNoteSchema.safeParse({
      title: '',
      body: { type: 'doc', content: [] },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'title')).toBe(true);
    }
  });

  it('rejects a missing body', () => {
    const result = createNoteSchema.safeParse({
      title: 'My Note',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'body')).toBe(true);
    }
  });

  it('rejects a non-object body', () => {
    const result = createNoteSchema.safeParse({
      title: 'My Note',
      body: 'not an object',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'body')).toBe(true);
    }
  });

  it('accepts an empty object body (TipTap document shape is not deeply validated)', () => {
    const result = createNoteSchema.safeParse({
      title: 'My Note',
      body: {},
    });

    expect(result.success).toBe(true);
  });

  it('accepts a note omitting tagIds entirely (tagIds is optional)', () => {
    const result = createNoteSchema.safeParse({
      title: 'My Note',
      body: { type: 'doc', content: [] },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toBeUndefined();
    }
  });

  it('accepts a note with an array of tagIds', () => {
    const result = createNoteSchema.safeParse({
      title: 'My Note',
      body: { type: 'doc', content: [] },
      tagIds: ['tag-1', 'tag-2'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual(['tag-1', 'tag-2']);
    }
  });

  it('passes duplicate tagIds through unchanged (deduping is a service-layer concern, not schema)', () => {
    const result = createNoteSchema.safeParse({
      title: 'My Note',
      body: { type: 'doc', content: [] },
      tagIds: ['tag-1', 'tag-1', 'tag-2'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual(['tag-1', 'tag-1', 'tag-2']);
    }
  });
});

describe('updateNoteSchema', () => {
  it('accepts title only', () => {
    const result = updateNoteSchema.safeParse({
      title: 'Updated Title',
    });

    expect(result.success).toBe(true);
  });

  it('accepts body only', () => {
    const result = updateNoteSchema.safeParse({
      body: { type: 'doc', content: [] },
    });

    expect(result.success).toBe(true);
  });

  it('accepts both title and body', () => {
    const result = updateNoteSchema.safeParse({
      title: 'Updated Title',
      body: { type: 'doc', content: [] },
    });

    expect(result.success).toBe(true);
  });

  it('rejects an empty object where neither title nor body is present', () => {
    const result = updateNoteSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('rejects a title exceeding 200 characters even when it is the only field present', () => {
    const title = 'a'.repeat(201);

    const result = updateNoteSchema.safeParse({
      title,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'title')).toBe(true);
    }
  });

  it('accepts tagIds alone, satisfying the "at least one field" refinement', () => {
    const result = updateNoteSchema.safeParse({
      tagIds: ['tag-1'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual(['tag-1']);
    }
  });

  it('passes duplicate tagIds through unchanged (deduping is a service-layer concern, not schema)', () => {
    const result = updateNoteSchema.safeParse({
      tagIds: ['tag-1', 'tag-1'],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual(['tag-1', 'tag-1']);
    }
  });
});

describe('paginationQuerySchema', () => {
  it('defaults to page 1 and pageSize 10 when no input is provided', () => {
    const result = paginationQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(10);
    }
  });

  it('coerces string-based numeric query input into numbers', () => {
    const result = paginationQuerySchema.safeParse({ page: '2', pageSize: '25' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it('rejects a pageSize of 51 (over the cap of 50)', () => {
    const result = paginationQuerySchema.safeParse({ pageSize: 51 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'pageSize')).toBe(true);
    }
  });

  it('accepts a pageSize of exactly 50 (at the cap)', () => {
    const result = paginationQuerySchema.safeParse({ pageSize: 50 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe(50);
    }
  });

  it('rejects a page of 0', () => {
    const result = paginationQuerySchema.safeParse({ page: 0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'page')).toBe(true);
    }
  });

  it('rejects a negative page', () => {
    const result = paginationQuerySchema.safeParse({ page: -1 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'page')).toBe(true);
    }
  });
});

describe('noteSortSchema', () => {
  it.each(['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'] as const)(
    'accepts the valid sort value %s unchanged',
    (sortValue) => {
      const result = noteSortSchema.safeParse(sortValue);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe(sortValue);
      }
    },
  );

  it('defaults to createdAt:desc when input is undefined', () => {
    const result = noteSortSchema.safeParse(undefined);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('createdAt:desc');
    }
  });

  it('rejects a value outside the enum', () => {
    const result = noteSortSchema.safeParse('title:desc');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.length).toBeGreaterThan(0);
    }
  });
});

describe('listNotesQuerySchema', () => {
  it.each(['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc'] as const)(
    'parses a valid sort value %s unchanged',
    (sortValue) => {
      const result = listNotesQuerySchema.safeParse({ sort: sortValue });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.sort).toBe(sortValue);
      }
    },
  );

  it('defaults sort to createdAt:desc when omitted', () => {
    const result = listNotesQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sort).toBe('createdAt:desc');
    }
  });

  it('rejects an out-of-enum sort value', () => {
    const result = listNotesQuerySchema.safeParse({ sort: 'title:desc' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'sort')).toBe(true);
    }
  });

  it('rejects an arbitrary garbage sort value', () => {
    const result = listNotesQuerySchema.safeParse({ sort: 'not-a-real-sort-value' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'sort')).toBe(true);
    }
  });

  it('still defaults page to 1 and pageSize to 10 when only sort is provided', () => {
    const result = listNotesQuerySchema.safeParse({ sort: 'updatedAt:asc' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(10);
    }
  });

  it('coerces string-based numeric page/pageSize query input into numbers', () => {
    const result = listNotesQuerySchema.safeParse({
      page: '2',
      pageSize: '25',
      sort: 'updatedAt:desc',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it('rejects a pageSize of 51 (over the cap of 50) even with a valid sort', () => {
    const result = listNotesQuerySchema.safeParse({ pageSize: 51, sort: 'createdAt:asc' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'pageSize')).toBe(true);
    }
  });

  it('accepts a pageSize of exactly 50 (at the cap)', () => {
    const result = listNotesQuerySchema.safeParse({ pageSize: 50 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pageSize).toBe(50);
    }
  });

  it('rejects a page of 0 even with a valid sort', () => {
    const result = listNotesQuerySchema.safeParse({ page: 0, sort: 'createdAt:asc' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'page')).toBe(true);
    }
  });

  it('parses a comma-separated tagIds query string into an array', () => {
    const result = listNotesQuerySchema.safeParse({ tagIds: 't1,t2,t3' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toEqual(['t1', 't2', 't3']);
    }
  });

  it('parses an empty tagIds string into undefined (no filter applied)', () => {
    const result = listNotesQuerySchema.safeParse({ tagIds: '' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toBeUndefined();
    }
  });

  it('parses an omitted tagIds value into undefined (no filter applied)', () => {
    const result = listNotesQuerySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tagIds).toBeUndefined();
    }
  });
});

describe('tagColorSchema', () => {
  it.each(TAG_COLORS)('accepts the valid tag color %s', (color) => {
    const result = tagColorSchema.safeParse(color);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe(color);
    }
  });

  it('rejects a string that is not one of the 8 defined tag colors', () => {
    const result = tagColorSchema.safeParse('turquoise');

    expect(result.success).toBe(false);
  });
});

describe('tagNameSchema / createTagSchema', () => {
  it('rejects an empty (0-character) tag name', () => {
    const result = createTagSchema.safeParse({ name: '', color: 'red' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'name')).toBe(true);
    }
  });

  it('accepts a 1-character tag name', () => {
    const result = createTagSchema.safeParse({ name: 'a', color: 'red' });

    expect(result.success).toBe(true);
  });

  it('accepts a tag name of exactly 50 characters', () => {
    const name = 'a'.repeat(50);

    const result = createTagSchema.safeParse({ name, color: 'red' });

    expect(result.success).toBe(true);
  });

  it('rejects a tag name of 51 characters', () => {
    const name = 'a'.repeat(51);

    const result = createTagSchema.safeParse({ name, color: 'red' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'name')).toBe(true);
    }
  });

  it('rejects a missing color', () => {
    const result = createTagSchema.safeParse({ name: 'Work' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'color')).toBe(true);
    }
  });

  it('rejects an invalid color value', () => {
    const result = createTagSchema.safeParse({ name: 'Work', color: 'not-a-color' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'color')).toBe(true);
    }
  });

  it('exposes tagNameSchema directly with the same boundary rules', () => {
    expect(tagNameSchema.safeParse('a'.repeat(50)).success).toBe(true);
    expect(tagNameSchema.safeParse('a'.repeat(51)).success).toBe(false);
    expect(tagNameSchema.safeParse('').success).toBe(false);
  });
});

describe('updateTagSchema', () => {
  it('accepts name only', () => {
    const result = updateTagSchema.safeParse({ name: 'Renamed' });

    expect(result.success).toBe(true);
  });

  it('accepts color only', () => {
    const result = updateTagSchema.safeParse({ color: 'blue' });

    expect(result.success).toBe(true);
  });

  it('accepts both name and color', () => {
    const result = updateTagSchema.safeParse({ name: 'Renamed', color: 'blue' });

    expect(result.success).toBe(true);
  });

  it('rejects an empty object where neither name nor color is present', () => {
    const result = updateTagSchema.safeParse({});

    expect(result.success).toBe(false);
  });
});

describe('tagIdsQuerySchema', () => {
  it('parses a comma-separated string into an array of IDs', () => {
    const result = tagIdsQuerySchema.safeParse('t1,t2,t3');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['t1', 't2', 't3']);
    }
  });

  it('parses an empty string into undefined', () => {
    const result = tagIdsQuerySchema.safeParse('');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });

  it('drops the trailing empty segment produced by a trailing comma', () => {
    const result = tagIdsQuerySchema.safeParse('t1,t2,');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['t1', 't2']);
    }
  });

  it('parses an absent (undefined) value into undefined', () => {
    const result = tagIdsQuerySchema.safeParse(undefined);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });

  it('parses a string made up only of separators (no actual IDs) into undefined', () => {
    // Every comma-delimited segment is empty, so after filtering there are no
    // IDs left and the schema falls back to undefined (no filter applied).
    const result = tagIdsQuerySchema.safeParse(',,,');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBeUndefined();
    }
  });

  // NOTE: a whitespace-only string like ' ' is NOT collapsed to undefined by
  // the current implementation - it only checks val.length === 0 and does not
  // trim, so ' ' survives the split/filter as a single non-empty segment.
  // This is documented here as the schema's actual current behavior.
  it('does not treat a whitespace-only string as empty (current implementation does not trim)', () => {
    const result = tagIdsQuerySchema.safeParse(' ');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([' ']);
    }
  });
});

describe('searchQuerySchema', () => {
  it('parses a valid q alone, defaulting page to 1 and pageSize to 10', () => {
    const result = searchQuerySchema.safeParse({ q: 'hello' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe('hello');
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(10);
    }
  });

  it('rejects a missing q', () => {
    const result = searchQuerySchema.safeParse({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'q')).toBe(true);
    }
  });

  it('rejects an empty string q', () => {
    const result = searchQuerySchema.safeParse({ q: '' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'q')).toBe(true);
    }
  });

  it('rejects a whitespace-only q (trimmed to empty, still fails min(1))', () => {
    const result = searchQuerySchema.safeParse({ q: '   ' });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'q')).toBe(true);
    }
  });

  it('reflects q combined with explicit page/pageSize in the parsed result', () => {
    const result = searchQuerySchema.safeParse({ q: 'hello', page: 2, pageSize: 25 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe('hello');
      expect(result.data.page).toBe(2);
      expect(result.data.pageSize).toBe(25);
    }
  });

  it('trims leading/trailing whitespace around real content in q', () => {
    const result = searchQuerySchema.safeParse({ q: '  hello  ' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe('hello');
    }
  });

  it('rejects an invalid pageSize (0) combined with a valid q', () => {
    const result = searchQuerySchema.safeParse({ q: 'hello', pageSize: 0 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'pageSize')).toBe(true);
    }
  });

  it('rejects an invalid pageSize (51, over the cap) combined with a valid q', () => {
    const result = searchQuerySchema.safeParse({ q: 'hello', pageSize: 51 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === 'pageSize')).toBe(true);
    }
  });
});
