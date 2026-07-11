import { describe, it, expect } from 'vitest';
import { AppError } from './AppError';

describe('AppError', () => {
  it('sets statusCode, code, and message from the constructor', () => {
    const err = new AppError(404, 'NOTE_NOT_FOUND', 'Note not found');

    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('NOTE_NOT_FOUND');
    expect(err.message).toBe('Note not found');
    expect(err.fields).toBeUndefined();
  });

  it('accepts an optional fields array', () => {
    const err = new AppError(400, 'VALIDATION_FAILED', 'Invalid input', ['email', 'password']);

    expect(err.fields).toEqual(['email', 'password']);
  });

  it('is a real Error instance, catchable via instanceof', () => {
    let caught: unknown;

    try {
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Bad credentials');
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toBeInstanceOf(Error);
  });

  it('preserves a usable stack trace', () => {
    const err = new AppError(500, 'INTERNAL_ERROR', 'Something broke');

    expect(err.stack).toBeDefined();
    expect(typeof err.stack).toBe('string');
  });
});
