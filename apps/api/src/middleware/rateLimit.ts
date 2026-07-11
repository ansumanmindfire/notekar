import rateLimit, { type Options } from 'express-rate-limit';

export function createRateLimiter(options: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
  });
}
