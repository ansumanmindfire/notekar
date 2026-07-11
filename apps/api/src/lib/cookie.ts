import type { Response } from 'express';

const REFRESH_COOKIE_NAME = 'refreshToken';
const REFRESH_COOKIE_PATH = '/auth';

export function setRefreshCookie(
  res: Response,
  rawToken: string,
  expiresAt: Date,
  isProd: boolean,
): void {
  res.cookie(REFRESH_COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response, isProd: boolean): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProd,
    path: REFRESH_COOKIE_PATH,
  });
}
