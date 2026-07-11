import { Router } from 'express';
import type { ApiError } from 'shared/types';

export const router = Router();

router.use((req, res) => {
  const body: ApiError = {
    code: 'NOT_FOUND',
    message: `No route for ${req.method} ${req.originalUrl}`,
  };
  res.status(404).json(body);
});
