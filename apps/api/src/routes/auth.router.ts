import { Router, type Request } from 'express';
import { ipKeyGenerator } from 'express-rate-limit';
import type { Env } from '../lib/env';
import { createAuthController, type AuthControllerEnv } from '../controllers/auth.controller';
import { createRateLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';

export type AuthRouterEnv = AuthControllerEnv & Pick<Env, 'JWT_SECRET'>;

// SDS §17 scopes forgot-password's limit "per Email Address", unlike every
// other auth route (IP-keyed). Falls back to the (IPv6-safe) IP key when the
// body has no usable email so a malformed/omitted-email request still gets
// bucketed, rather than bypassing the limit entirely.
function forgotPasswordRateLimitKey(req: Request): string {
  const body = req.body as { email?: unknown } | undefined;
  const email = typeof body?.email === 'string' ? body.email.toLowerCase() : undefined;
  return email ?? ipKeyGenerator(req.ip ?? '');
}

export function createAuthRouter(env: AuthRouterEnv): Router {
  const controller = createAuthController(env);
  const router = Router();

  // Created per router instance (not module-level) so each createApp() call
  // gets isolated counters — this is also what lets integration tests spin
  // up a fresh app with clean rate-limit state instead of sharing one global
  // in-memory bucket across the whole test process.
  const registerLimiter = createRateLimiter({ windowMs: 60 * 60 * 1000, max: 3 });
  const loginLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 5 });
  const refreshLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });
  const logoutLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 20 });
  const forgotPasswordLimiter = createRateLimiter({
    windowMs: 60 * 60 * 1000,
    max: 3,
    keyGenerator: forgotPasswordRateLimitKey,
  });

  router.post('/register', registerLimiter, controller.register);
  router.post('/login', loginLimiter, controller.login);
  router.post('/refresh', refreshLimiter, controller.refresh);
  router.post('/logout', logoutLimiter, requireAuth(env.JWT_SECRET), controller.logout);
  router.post('/forgot-password', forgotPasswordLimiter, controller.forgotPassword);
  // No rate limiter here (per spec.md Non-Goals): the OTP's 5-attempt cap is
  // the sole guard, matching SDS §17's consolidated table which lists no
  // separate limit for password-reset verification.
  router.post('/reset-password', controller.resetPassword);

  return router;
}
