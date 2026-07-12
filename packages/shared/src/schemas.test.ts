import { describe, it, expect } from 'vitest';
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  createNoteSchema,
  updateNoteSchema,
  paginationQuerySchema,
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
