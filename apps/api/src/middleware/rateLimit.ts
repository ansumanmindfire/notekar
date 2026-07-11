import rateLimit, { type Options } from 'express-rate-limit';
import type { Request, Response } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import type { ApiError } from 'shared/types';

function rateLimitHandler(_req: Request, res: Response): void {
  const body: ApiError = {
    code: ErrorCodes.RATE_LIMITED,
    message: 'Too many requests, please try again later',
  };
  res.status(429).json(body);
}

export function createRateLimiter(options: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    ...options,
  });
}
