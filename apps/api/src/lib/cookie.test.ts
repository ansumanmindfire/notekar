import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { setRefreshCookie, clearRefreshCookie } from './cookie';

function createMockResponse(): Response {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response;
}

describe('setRefreshCookie', () => {
  it('calls res.cookie with name "refreshToken", the raw token, and httpOnly/sameSite/path/secure=false when isProd is false', () => {
    const res = createMockResponse();
    const rawToken = 'raw-token-value';
    const expiresAt = new Date('2026-01-01T00:00:00.000Z');

    setRefreshCookie(res, rawToken, expiresAt, false);

    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      rawToken,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/auth',
        secure: false,
      }),
    );
  });

  it('calls res.cookie with secure=true when isProd is true', () => {
    const res = createMockResponse();
    const rawToken = 'raw-token-value';
    const expiresAt = new Date('2026-01-01T00:00:00.000Z');

    setRefreshCookie(res, rawToken, expiresAt, true);

    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      rawToken,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/auth',
        secure: true,
      }),
    );
  });

  it('passes the given expiresAt Date through as the expires option', () => {
    const res = createMockResponse();
    const expiresAt = new Date('2026-06-15T12:30:00.000Z');

    setRefreshCookie(res, 'raw-token-value', expiresAt, false);

    expect(res.cookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.any(String),
      expect.objectContaining({ expires: expiresAt }),
    );
  });
});

describe('clearRefreshCookie', () => {
  it('calls res.clearCookie with name "refreshToken" and matching options when isProd is false', () => {
    const res = createMockResponse();

    clearRefreshCookie(res, false);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/auth',
        secure: false,
      }),
    );
  });

  it('calls res.clearCookie with secure=true when isProd is true', () => {
    const res = createMockResponse();

    clearRefreshCookie(res, true);

    expect(res.clearCookie).toHaveBeenCalledWith(
      'refreshToken',
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'strict',
        path: '/auth',
        secure: true,
      }),
    );
  });
});
