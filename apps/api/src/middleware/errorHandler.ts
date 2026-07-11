import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import type { ApiError } from 'shared/types';
import { AppError } from '../lib/AppError';
import { logger } from '../lib/logger';

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    const body: ApiError = {
      code: err.code,
      message: err.message,
      ...(err.fields !== undefined && { fields: err.fields }),
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (err instanceof ZodError) {
    const body: ApiError = {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      fields: err.issues.map((issue) => issue.path.join('.')),
    };
    res.status(400).json(body);
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const body: ApiError = { code: 'CONFLICT', message: 'Resource already exists' };
      res.status(409).json(body);
      return;
    }

    if (err.code === 'P2025') {
      const body: ApiError = { code: 'NOT_FOUND', message: 'Resource not found' };
      res.status(404).json(body);
      return;
    }
  }

  logger.error({ err }, 'Unhandled error');
  const body: ApiError = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' };
  res.status(500).json(body);
}
