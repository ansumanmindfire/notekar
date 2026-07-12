import { Router } from 'express';
import type { Env } from '../lib/env';
import { requireAuth } from '../middleware/auth';
import { createSearchController } from '../controllers/search.controller';

export type SearchRouterEnv = Pick<Env, 'JWT_SECRET'>;

export function createSearchRouter(env: SearchRouterEnv): Router {
  const controller = createSearchController();
  const router = Router();

  router.use(requireAuth(env.JWT_SECRET));

  router.get('/', controller.search);

  return router;
}
