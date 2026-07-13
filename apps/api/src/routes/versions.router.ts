import { Router } from 'express';
import { createVersionsController } from '../controllers/versions.controller';

export function createVersionsRouter(): Router {
  const controller = createVersionsController();
  const router = Router({ mergeParams: true });

  router.get('/', controller.list);
  router.get('/:versionId', controller.preview);
  router.post('/:versionId/restore', controller.restore);

  return router;
}
