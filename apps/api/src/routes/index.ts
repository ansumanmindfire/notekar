import { Router } from 'express';
import type { ApiError } from 'shared/types';
import type { Env } from '../lib/env';
import { createAuthRouter, type AuthRouterEnv } from './auth.router';
import { createNotesRouter } from './notes.router';
import { createTagsRouter } from './tags.router';
import { createSearchRouter } from './search.router';
import { createPublicRouter } from './public.router';

export type RouterEnv = AuthRouterEnv & Pick<Env, 'WEB_ORIGIN'>;

export function createRouter(env: RouterEnv): Router {
  const router = Router();

  // AB-1016: unauthenticated, unrate-limited health check for Playwright's
  // webServer readiness probe — must be registered before any auth middleware.
  router.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  router.use('/auth', createAuthRouter(env));
  router.use('/notes', createNotesRouter(env));
  router.use('/tags', createTagsRouter(env));
  router.use('/search', createSearchRouter(env));
  router.use('/public/shares', createPublicRouter());

  router.use((req, res) => {
    const body: ApiError = {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.originalUrl}`,
    };
    res.status(404).json(body);
  });

  return router;
}
