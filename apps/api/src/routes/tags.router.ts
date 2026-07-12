import { Router } from 'express';
import type { Env } from '../lib/env';
import { requireAuth } from '../middleware/auth';
import { createTagsController } from '../controllers/tags.controller';

export type TagsRouterEnv = Pick<Env, 'JWT_SECRET'>;

export function createTagsRouter(env: TagsRouterEnv): Router {
  const controller = createTagsController();
  const router = Router();

  router.use(requireAuth(env.JWT_SECRET));

  router.get('/', controller.list);
  router.post('/', controller.create);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);

  return router;
}
