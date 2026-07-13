import { ErrorCodes, type ErrorCode } from 'shared';

const messages: Record<ErrorCode, string> = {
  [ErrorCodes.VALIDATION_FAILED]: 'Please check the highlighted fields and try again.',
  [ErrorCodes.AUTH_INVALID_CREDENTIALS]: 'Incorrect email or password.',
  [ErrorCodes.AUTH_TOKEN_INVALID]: 'Your session has expired. Please sign in again.',
  [ErrorCodes.AUTH_REFRESH_INVALID]: 'Your session has expired. Please sign in again.',
  [ErrorCodes.USER_EXISTS]: 'An account with this email already exists.',
  [ErrorCodes.AUTH_OTP_INVALID]: 'That code is invalid or has expired.',
  [ErrorCodes.RATE_LIMITED]: 'Too many attempts. Please wait a moment and try again.',
  [ErrorCodes.NOTE_NOT_FOUND]: 'This note could not be found.',
  [ErrorCodes.TAG_NOT_FOUND]: 'This tag could not be found.',
  [ErrorCodes.TAG_NAME_DUPLICATE]: 'A tag with this name already exists.',
  [ErrorCodes.INVALID_TAG]: 'This tag is invalid.',
  [ErrorCodes.SHARE_NOT_FOUND]: 'This share link could not be found.',
  [ErrorCodes.GONE_LINK_INVALID]: 'This link is no longer valid.',
  [ErrorCodes.VERSION_NOT_FOUND]: 'This version could not be found.',
};

const GENERIC_MESSAGE = 'Something went wrong. Please try again.';

export function getErrorMessage(code: string): string {
  return messages[code as ErrorCode] ?? GENERIC_MESSAGE;
}
