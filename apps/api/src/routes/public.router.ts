import { Router, type Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import { createRateLimiter } from '../middleware/rateLimit';
import { createPublicController } from '../controllers/public.controller';

// FRS §11 scopes this limit "per IP address, per token", unlike the
// IP-only keying used elsewhere - a naive IP-only key would let one busy
// share link starve every other link's quota for the same caller. Uses the
// (IPv6-safe) ipKeyGenerator, same precedent as auth.router.ts's
// forgotPasswordRateLimitKey.
function publicShareRateLimitKey(req: Request): string {
  return `${ipKeyGenerator(req.ip ?? '')}:${req.params.token}`;
}

export function createPublicRouter(): Router {
  const controller = createPublicController();
  const router = Router();

  // Created per router instance, not module-level, so each createApp() call
  // gets isolated counters (same rationale as auth.router.ts's limiters).
  const publicShareLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 60,
    keyGenerator: publicShareRateLimitKey,
  });

  router.get('/:token', publicShareLimiter, controller.view);

  return router;
}
