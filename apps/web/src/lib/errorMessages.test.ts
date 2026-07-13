import { describe, it, expect } from 'vitest';
import { ErrorCodes } from 'shared';
import { getErrorMessage } from './errorMessages';

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

describe('getErrorMessage', () => {
  it('returns a specific, non-empty message for VALIDATION_FAILED', () => {
    const message = getErrorMessage(ErrorCodes.VALIDATION_FAILED);
    expect(message).toBeTruthy();
    expect(message).not.toBe(GENERIC_MESSAGE);
  });

  it('returns a specific, non-empty message for AUTH_INVALID_CREDENTIALS', () => {
    const message = getErrorMessage(ErrorCodes.AUTH_INVALID_CREDENTIALS);
    expect(message).toBeTruthy();
    expect(message).not.toBe(GENERIC_MESSAGE);
  });

  it('returns a specific, non-empty message for AUTH_TOKEN_INVALID', () => {
    const message = getErrorMessage(ErrorCodes.AUTH_TOKEN_INVALID);
    expect(message).toBeTruthy();
    expect(message).not.toBe(GENERIC_MESSAGE);
  });

  it('returns a specific, non-empty message for AUTH_REFRESH_INVALID', () => {
    const message = getErrorMessage(ErrorCodes.AUTH_REFRESH_INVALID);
    expect(message).toBeTruthy();
    expect(message).not.toBe(GENERIC_MESSAGE);
  });

  it('returns a specific, non-empty message for USER_EXISTS', () => {
    const message = getErrorMessage(ErrorCodes.USER_EXISTS);
    expect(message).toBeTruthy();
    expect(message).not.toBe(GENERIC_MESSAGE);
  });

  it('returns a specific, non-empty message for AUTH_OTP_INVALID', () => {
    const message = getErrorMessage(ErrorCodes.AUTH_OTP_INVALID);
    expect(message).toBeTruthy();
    expect(message).not.toBe(GENERIC_MESSAGE);
  });

  it('returns a specific, non-empty message for RATE_LIMITED', () => {
    const message = getErrorMessage(ErrorCodes.RATE_LIMITED);
    expect(message).toBeTruthy();
    expect(message).not.toBe(GENERIC_MESSAGE);
  });

  it('falls back to the generic message for an unknown error code', () => {
    const message = getErrorMessage('SOME_MADE_UP_CODE_THAT_DOES_NOT_EXIST');
    expect(message).toBe(GENERIC_MESSAGE);
  });
});
