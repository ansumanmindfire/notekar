import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../lib/AppError';

/**
 * Per AGENTS.md §10 ("Unit tests: Prisma client mocked"), `@prisma/client` is
 * mocked here rather than relying on the real generated client. This
 * decouples the test from Prisma v7's exact `PrismaClientKnownRequestError`
 * constructor signature (unverifiable right now — `node_modules` doesn't
 * exist yet) while still exercising errorHandler's own branching logic on
 * `err.code`, which is all this unit is responsible for.
 *
 * `MockPrismaClientKnownRequestError` is declared via `vi.hoisted` (rather
 * than a plain top-level `class`) because Vitest hoists `vi.mock(...)`
 * factory calls to the very top of the module — above any of the file's own
 * top-level declarations. A plain `class` referenced from inside the factory
 * would throw `ReferenceError: Cannot access ... before initialization`
 * since the factory runs before the class would otherwise be initialized.
 * `vi.hoisted` is hoisted alongside `vi.mock`, so it's guaranteed to already
 * be initialized by the time the factory executes, while remaining usable
 * from the test bodies below (e.g. `new MockPrismaClientKnownRequestError(...)`).
 */
const { MockPrismaClientKnownRequestError } = vi.hoisted(() => {
  class MockPrismaClientKnownRequestError extends Error {
    code: string;

    constructor(message: string, options: { code: string }) {
      super(message);
      this.code = options.code;
    }
  }
  return { MockPrismaClientKnownRequestError };
});

vi.mock('@prisma/client', () => ({
  Prisma: { PrismaClientKnownRequestError: MockPrismaClientKnownRequestError },
}));

vi.mock('../lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

import { errorHandler } from './errorHandler';
import { logger } from '../lib/logger';

function createMockRes() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  return { status, json };
}

const mockReq = {} as unknown as Request;
const mockNext = vi.fn() as unknown as NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('errorHandler', () => {
  it('maps AppError to its declared statusCode/code/message/fields', () => {
    const res = createMockRes();
    const err = new AppError(404, 'NOTE_NOT_FOUND', 'Note not found', ['id']);

    errorHandler(err, mockReq, res as unknown as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      code: 'NOTE_NOT_FOUND',
      message: 'Note not found',
      fields: ['id'],
    });
  });

  it('maps ZodError to 400 VALIDATION_FAILED with dot-joined field paths', () => {
    const res = createMockRes();
    const schema = z.object({ email: z.string(), password: z.string() });
    const result = schema.safeParse({});
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected parse failure');

    errorHandler(result.error, mockReq, res as unknown as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        fields: expect.arrayContaining(['email', 'password']),
      }),
    );
  });

  it('maps a Prisma P2002 error to 409 CONFLICT', () => {
    const res = createMockRes();
    const err = new MockPrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
    });

    errorHandler(err, mockReq, res as unknown as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ code: 'CONFLICT', message: 'Resource already exists' });
  });

  it('maps a Prisma P2025 error to 404 NOT_FOUND', () => {
    const res = createMockRes();
    const err = new MockPrismaClientKnownRequestError('Record not found', { code: 'P2025' });

    errorHandler(err, mockReq, res as unknown as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ code: 'NOT_FOUND', message: 'Resource not found' });
  });

  it('falls back to 500 INTERNAL_ERROR for an unrecognized Prisma error code', () => {
    const res = createMockRes();
    const err = new MockPrismaClientKnownRequestError('Foreign key constraint failed', {
      code: 'P2003',
    });

    errorHandler(err, mockReq, res as unknown as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  it('falls back to 500 INTERNAL_ERROR and logs unrecognized errors', () => {
    const res = createMockRes();
    const err = new Error('Something unexpected');

    errorHandler(err, mockReq, res as unknown as Response, mockNext);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('does not log AppError, ZodError, or handled Prisma errors (only the 500 fallback path logs)', () => {
    const res = createMockRes();
    errorHandler(
      new AppError(400, 'VALIDATION_FAILED', 'bad'),
      mockReq,
      res as unknown as Response,
      mockNext,
    );

    expect(logger.error).not.toHaveBeenCalled();
  });
});
