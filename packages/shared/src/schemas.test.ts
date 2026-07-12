import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema, forgotPasswordSchema, resetPasswordSchema } from './schemas';

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
