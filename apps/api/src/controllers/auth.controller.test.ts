import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/AppError';
import { ErrorCodes } from 'shared/errorCodes';

// Mock the Prisma singleton import so the controller (via the real
// auth.service.ts) never touches a real database connection. Declared with
// vi.hoisted so the mock object exists before the hoisted vi.mock factory
// below runs, and so tests can import/reset it directly.
const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  refreshToken: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  passwordResetOtp: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock('../lib/prisma', () => ({ prisma: mockPrisma }));

// Imported after the mock is registered so createAuthController resolves the
// mocked '../lib/prisma' module internally.
const { createAuthController } = await import('./auth.controller');
type AuthControllerEnv = Parameters<typeof createAuthController>[0];

const JWT_SECRET = 'a'.repeat(32);
const BCRYPT_ROUNDS = 4; // low rounds keep unit tests fast while still exercising real bcrypt
const FORGOT_PASSWORD_GENERIC_MESSAGE =
  'If an account with that email exists, a password reset code has been sent.';

function createEnv(nodeEnv: 'development' | 'production' | 'test' = 'development'): AuthControllerEnv {
  return { JWT_SECRET, BCRYPT_ROUNDS, NODE_ENV: nodeEnv };
}

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    cookies: {},
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

describe('auth.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('register', () => {
    it('valid input -> 201 with {id, email, createdAt} (createdAt as ISO string)', async () => {
      const controller = createAuthController(createEnv());
      const createdAt = new Date('2026-01-01T00:00:00.000Z');
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.user.create.mockResolvedValue({
        id: 'user-1',
        email: 'test@example.com',
        passwordHash: 'irrelevant-hash',
        createdAt,
        updatedAt: createdAt,
      });

      const req = createMockReq({ body: { email: 'Test@Example.com', password: 'Password1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.register(req, res, next);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        id: 'user-1',
        email: 'test@example.com',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { createdAt: unknown };
      expect(typeof jsonArg.createdAt).toBe('string');
      expect(next).not.toHaveBeenCalled();
    });

    it('invalid body (bad email) -> next(ZodError), does not call res.status/json, and never touches prisma', async () => {
      const controller = createAuthController(createEnv());
      const req = createMockReq({ body: { email: 'not-an-email', password: 'Password1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.register(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    async function setupValidUser(): Promise<void> {
      const passwordHash = await bcrypt.hash('CorrectHorse1', BCRYPT_ROUNDS);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'login@example.com',
        passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.refreshToken.create.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        token: 'hashed',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        familyId: 'fam-1',
        createdAt: new Date(),
      });
    }

    it('valid credentials -> 200 {accessToken, user}, and sets refreshToken cookie with httpOnly/sameSite=strict/path=/auth', async () => {
      await setupValidUser();
      const controller = createAuthController(createEnv('development'));
      const req = createMockReq({ body: { email: 'Login@Example.com', password: 'CorrectHorse1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.login(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        accessToken: string;
        user: { id: string; email: string };
      };
      expect(typeof jsonArg.accessToken).toBe('string');
      expect(jsonArg.accessToken.split('.')).toHaveLength(3);
      expect(jsonArg.user).toEqual({ id: 'user-1', email: 'login@example.com' });

      expect(res.cookie).toHaveBeenCalledTimes(1);
      const [cookieName, cookieValue, cookieOptions] = (res.cookie as ReturnType<typeof vi.fn>).mock.calls[0]! as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(cookieName).toBe('refreshToken');
      expect(typeof cookieValue).toBe('string');
      expect(cookieValue.length).toBeGreaterThan(0);
      expect(cookieOptions).toEqual(
        expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/auth' }),
      );
    });

    it('sets secure=false on the refreshToken cookie when NODE_ENV is development', async () => {
      await setupValidUser();
      const controller = createAuthController(createEnv('development'));
      const req = createMockReq({ body: { email: 'Login@Example.com', password: 'CorrectHorse1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.login(req, res, next);

      const [, , cookieOptions] = (res.cookie as ReturnType<typeof vi.fn>).mock.calls[0]! as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(cookieOptions.secure).toBe(false);
    });

    it('sets secure=true on the refreshToken cookie when NODE_ENV is production', async () => {
      await setupValidUser();
      const controller = createAuthController(createEnv('production'));
      const req = createMockReq({ body: { email: 'Login@Example.com', password: 'CorrectHorse1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.login(req, res, next);

      const [, , cookieOptions] = (res.cookie as ReturnType<typeof vi.fn>).mock.calls[0]! as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(cookieOptions.secure).toBe(true);
    });
  });

  describe('refresh', () => {
    it('no refreshToken cookie -> next(AppError 401 AUTH_REFRESH_INVALID), and never calls the service/DB layer', async () => {
      const controller = createAuthController(createEnv());
      const req = createMockReq({ cookies: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.refresh(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).code).toBe(ErrorCodes.AUTH_REFRESH_INVALID);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(res.cookie).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('no refreshToken cookie -> still succeeds with 204 and no body (logoutUser is a no-op)', async () => {
      const controller = createAuthController(createEnv());
      const req = createMockReq({ cookies: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.logout(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(res.clearCookie).toHaveBeenCalledTimes(1);
      expect(mockPrisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.refreshToken.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword', () => {
    it('valid body + known email -> 200 {message: <generic message>}', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'known@example.com',
        passwordHash: 'irrelevant',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.passwordResetOtp.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.passwordResetOtp.create.mockResolvedValue({});
      mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

      const controller = createAuthController(createEnv());
      const req = createMockReq({ body: { email: 'Known@Example.com' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.forgotPassword(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: FORGOT_PASSWORD_GENERIC_MESSAGE });

      infoSpy.mockRestore();
    });

    it('invalid body (malformed email) -> next(ZodError), does not call res.status/json, and never touches prisma', async () => {
      const controller = createAuthController(createEnv());
      const req = createMockReq({ body: { email: 'not-an-email' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.forgotPassword(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.passwordResetOtp.create).not.toHaveBeenCalled();
      expect(mockPrisma.passwordResetOtp.updateMany).not.toHaveBeenCalled();
    });

    it('unknown email -> still responds 200 with the SAME generic message (anti-enumeration)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const controller = createAuthController(createEnv());
      const req = createMockReq({ body: { email: 'nobody@example.com' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.forgotPassword(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: FORGOT_PASSWORD_GENERIC_MESSAGE });
    });
  });

  describe('resetPassword', () => {
    it('valid body, correct OTP, known user -> 204, res.send() called, no res.json call', async () => {
      const otpHash = await bcrypt.hash('123456', BCRYPT_ROUNDS);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'known@example.com',
        passwordHash: 'irrelevant',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        userId: 'user-1',
        otpHash,
        expiresAt: new Date(Date.now() + 60_000),
        attemptsLeft: 5,
        invalidated: false,
        createdAt: new Date(),
      });
      mockPrisma.user.update.mockResolvedValue({});
      mockPrisma.passwordResetOtp.update.mockResolvedValue({});
      mockPrisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      const controller = createAuthController(createEnv());
      const req = createMockReq({
        body: { email: 'known@example.com', otp: '123456', newPassword: 'NewPassword1' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.resetPassword(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(res.json).not.toHaveBeenCalled();
    });

    it('invalid body (OTP not 6 digits) -> next(ZodError), does not call res.status/send, and never touches prisma', async () => {
      const controller = createAuthController(createEnv());
      const req = createMockReq({
        body: { email: 'known@example.com', otp: '12', newPassword: 'NewPassword1' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.resetPassword(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.passwordResetOtp.findFirst).not.toHaveBeenCalled();
    });

    it('invalid body (weak newPassword) -> next(ZodError), does not call res.status/send, and never touches prisma', async () => {
      const controller = createAuthController(createEnv());
      const req = createMockReq({
        body: { email: 'known@example.com', otp: '123456', newPassword: 'weak' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.resetPassword(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.passwordResetOtp.findFirst).not.toHaveBeenCalled();
    });

    it('wrong OTP -> next(AppError 401 AUTH_OTP_INVALID)', async () => {
      const otpHash = await bcrypt.hash('123456', BCRYPT_ROUNDS);
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'known@example.com',
        passwordHash: 'irrelevant',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      mockPrisma.passwordResetOtp.findFirst.mockResolvedValue({
        id: 'otp-1',
        userId: 'user-1',
        otpHash,
        expiresAt: new Date(Date.now() + 60_000),
        attemptsLeft: 5,
        invalidated: false,
        createdAt: new Date(),
      });
      mockPrisma.passwordResetOtp.update.mockResolvedValue({ attemptsLeft: 4 });

      const controller = createAuthController(createEnv());
      const req = createMockReq({
        body: { email: 'known@example.com', otp: '999999', newPassword: 'NewPassword1' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.resetPassword(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(401);
      expect((err as AppError).code).toBe(ErrorCodes.AUTH_OTP_INVALID);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});
