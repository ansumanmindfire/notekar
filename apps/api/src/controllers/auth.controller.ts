import type { NextFunction, Request, Response } from 'express';
import { registerSchema, loginSchema } from 'shared/schemas';
import { ErrorCodes } from 'shared/errorCodes';
import type { RegisterResponse, LoginResponse, RefreshResponse } from 'shared/types';
import type { Env } from '../lib/env';
import { prisma } from '../lib/prisma';
import { setRefreshCookie, clearRefreshCookie } from '../lib/cookie';
import { AppError } from '../lib/AppError';
import { registerUser, loginUser, refreshSession, logoutUser } from '../services/auth.service';

export type AuthControllerEnv = Pick<Env, 'JWT_SECRET' | 'BCRYPT_ROUNDS' | 'NODE_ENV'>;

function getRefreshCookie(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  return cookies?.refreshToken;
}

export function createAuthController(env: AuthControllerEnv) {
  const isProd = env.NODE_ENV !== 'development';

  return {
    async register(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const input = registerSchema.parse(req.body);
        const user = await registerUser(prisma, input, env.BCRYPT_ROUNDS);
        const body: RegisterResponse = {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt.toISOString(),
        };
        res.status(201).json(body);
      } catch (err) {
        next(err);
      }
    },

    async login(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const input = loginSchema.parse(req.body);
        const result = await loginUser(prisma, input, env.JWT_SECRET, env.BCRYPT_ROUNDS);
        setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, isProd);
        const body: LoginResponse = {
          accessToken: result.accessToken,
          user: result.user,
        };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    },

    async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rawToken = getRefreshCookie(req);
        if (!rawToken) {
          throw new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Invalid refresh token');
        }

        const result = await refreshSession(prisma, rawToken, env.JWT_SECRET);
        setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt, isProd);
        const body: RefreshResponse = { accessToken: result.accessToken };
        res.status(200).json(body);
      } catch (err) {
        next(err);
      }
    },

    async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
      try {
        const rawToken = getRefreshCookie(req);
        await logoutUser(prisma, rawToken);
        clearRefreshCookie(res, isProd);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  };
}
