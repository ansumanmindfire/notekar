import { Router } from 'express';
import type { ApiError } from 'shared/types';
import { createAuthRouter, type AuthRouterEnv } from './auth.router';
import { createNotesRouter } from './notes.router';
import { createTagsRouter } from './tags.router';

export function createRouter(env: AuthRouterEnv): Router {
  const router = Router();

  router.use('/auth', createAuthRouter(env));
  router.use('/notes', createNotesRouter(env));
  router.use('/tags', createTagsRouter(env));

  router.use((req, res) => {
    const body: ApiError = {
      code: 'NOT_FOUND',
      message: `No route for ${req.method} ${req.originalUrl}`,
    };
    res.status(404).json(body);
  });

  return router;
}
