import { Router } from 'express';
import type { Env } from '../lib/env';
import { createAuthController, type AuthControllerEnv } from '../controllers/auth.controller';
import { createRateLimiter } from '../middleware/rateLimit';
import { requireAuth } from '../middleware/auth';

export type AuthRouterEnv = AuthControllerEnv & Pick<Env, 'JWT_SECRET'>;

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

  router.post('/register', registerLimiter, controller.register);
  router.post('/login', loginLimiter, controller.login);
  router.post('/refresh', refreshLimiter, controller.refresh);
  router.post('/logout', logoutLimiter, requireAuth(env.JWT_SECRET), controller.logout);

  return router;
}
