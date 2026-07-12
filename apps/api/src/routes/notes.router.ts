import { Router } from 'express';
import type { Env } from '../lib/env';
import { requireAuth } from '../middleware/auth';
import { createNotesController } from '../controllers/notes.controller';

export type NotesRouterEnv = Pick<Env, 'JWT_SECRET'>;

export function createNotesRouter(env: NotesRouterEnv): Router {
  const controller = createNotesController();
  const router = Router();

  router.use(requireAuth(env.JWT_SECRET));

  // /trash must be registered before /:id, or Express would match it as a
  // note id lookup instead.
  router.get('/trash', controller.listTrash);
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.get('/:id', controller.get);
  router.patch('/:id', controller.update);
  router.delete('/:id', controller.remove);
  router.post('/:id/restore', controller.restore);

  return router;
}
