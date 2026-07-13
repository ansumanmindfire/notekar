import { Router } from 'express';
import { createSharesController, type SharesControllerEnv } from '../controllers/shares.controller';

export type SharesRouterEnv = SharesControllerEnv;

// mergeParams so req.params.id (the note id) from the parent notes.router.ts
// mount is visible here. No requireAuth call - auth is already applied by
// notes.router.ts's router.use(requireAuth(...)) before this sub-router is
// reached.
export function createSharesRouter(env: SharesRouterEnv): Router {
  const controller = createSharesController(env);
  const router = Router({ mergeParams: true });

  router.post('/', controller.create);
  router.get('/', controller.list);
  router.delete('/:token', controller.revoke);

  return router;
}
