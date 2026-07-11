import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { requireAuth } from './auth';
import { signAccessToken } from '../lib/jwt';
import { AppError } from '../lib/AppError';
import { ErrorCodes } from 'shared/errorCodes';

const SECRET = 'a'.repeat(32);
const OTHER_SECRET = 'b'.repeat(32);

function createReq(headers: Record<string, string | undefined> = {}): Request {
  return { headers } as unknown as Request;
}

const res = {} as Response;

describe('requireAuth', () => {
  it('sets req.userId and calls next() with no arguments for a valid Bearer token', () => {
    const userId = 'user-123';
    const token = signAccessToken(userId, SECRET);
    const req = createReq({ authorization: `Bearer ${token}` });
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(SECRET)(req, res, next);

    expect(req.userId).toBe(userId);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next() with a 401 AUTH_TOKEN_INVALID AppError when the Authorization header is missing', () => {
    const req = createReq();
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(SECRET)(req, res, next);

    expect(req.userId).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe(ErrorCodes.AUTH_TOKEN_INVALID);
  });

  it('calls next() with a 401 AUTH_TOKEN_INVALID AppError when the header is missing the "Bearer " prefix', () => {
    const token = signAccessToken('user-123', SECRET);
    const req = createReq({ authorization: token });
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(SECRET)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe(ErrorCodes.AUTH_TOKEN_INVALID);
  });

  it('calls next() with a 401 AUTH_TOKEN_INVALID AppError when the header is "Bearer" with no token', () => {
    const req = createReq({ authorization: 'Bearer' });
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(SECRET)(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe(ErrorCodes.AUTH_TOKEN_INVALID);
  });

  it('calls next() with a 401 AUTH_TOKEN_INVALID AppError for an expired token', () => {
    // Sign a token that is already expired via a negative expiresIn, matching
    // the deterministic approach used in jwt.test.ts.
    const expiredToken = jwt.sign({ sub: 'user-123' }, SECRET, {
      algorithm: 'HS256',
      expiresIn: -10,
    });
    const req = createReq({ authorization: `Bearer ${expiredToken}` });
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(SECRET)(req, res, next);

    expect(req.userId).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe(ErrorCodes.AUTH_TOKEN_INVALID);
  });

  it('calls next() with a 401 AUTH_TOKEN_INVALID AppError when the token was signed with the wrong secret', () => {
    const token = signAccessToken('user-123', OTHER_SECRET);
    const req = createReq({ authorization: `Bearer ${token}` });
    const next = vi.fn() as unknown as NextFunction;

    requireAuth(SECRET)(req, res, next);

    expect(req.userId).toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(err).toBeInstanceOf(AppError);
    expect(err.statusCode).toBe(401);
    expect(err.code).toBe(ErrorCodes.AUTH_TOKEN_INVALID);
  });
});
