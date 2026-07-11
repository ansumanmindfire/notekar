import type { NextFunction, Request, Response } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import { verifyAccessToken } from '../lib/jwt';
import { AppError } from '../lib/AppError';

const BEARER_PREFIX = 'Bearer ';

export function requireAuth(secret: string) {
  return function (req: Request, _res: Response, next: NextFunction): void {
    const header = req.headers.authorization;

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      next(new AppError(401, ErrorCodes.AUTH_TOKEN_INVALID, 'Invalid or missing access token'));
      return;
    }

    const token = header.slice(BEARER_PREFIX.length);

    try {
      const payload = verifyAccessToken(token, secret);
      req.userId = payload.sub;
      next();
    } catch {
      next(new AppError(401, ErrorCodes.AUTH_TOKEN_INVALID, 'Invalid or missing access token'));
    }
  };
}
