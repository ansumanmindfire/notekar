import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcrypt';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../lib/AppError';
import { registerUser, loginUser, refreshSession, logoutUser } from './auth.service';

const JWT_SECRET = 'a'.repeat(32);
const BCRYPT_ROUNDS = 4; // low rounds: keeps unit tests fast, still exercises real bcrypt

function createMockPrisma() {
  return {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    refreshToken: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient & {
    user: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    refreshToken: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

function expectAppError(err: unknown, statusCode: number, code: string): void {
  expect(err).toBeInstanceOf(AppError);
  const appError = err as AppError;
  expect(appError.statusCode).toBe(statusCode);
  expect(appError.code).toBe(code);
}

describe('auth.service', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
    vi.restoreAllMocks();
  });

  describe('registerUser', () => {
    it('lowercases the email, bcrypt-hashes the password, and returns the created user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(({ data }: { data: { email: string; passwordHash: string } }) =>
        Promise.resolve({
          id: 'user-1',
          email: data.email,
          passwordHash: data.passwordHash,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      );

      const result = await registerUser(
        prisma,
        { email: 'Test@Example.com', password: 'Password1' },
        BCRYPT_ROUNDS,
      );

      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'test@example.com' } });
      expect(prisma.user.create).toHaveBeenCalledTimes(1);

      const createArgs = prisma.user.create.mock.calls[0]![0] as { data: { email: string; passwordHash: string } };
      expect(createArgs.data.email).toBe('test@example.com');
      expect(createArgs.data.passwordHash).not.toBe('Password1');
      // Confirm it really is a bcrypt hash matching the plaintext, not a copy/placeholder.
      await expect(bcrypt.compare('Password1', createArgs.data.passwordHash)).resolves.toBe(true);

      expect(result).toEqual({
        id: 'user-1',
        email: 'test@example.com',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
    });

    it('throws 409 USER_EXISTS when the pre-check findUnique finds an existing user, and never calls create', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'existing-user',
        email: 'test@example.com',
        passwordHash: 'irrelevant',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      let caught: unknown;
      try {
        await registerUser(prisma, { email: 'Test@Example.com', password: 'Password1' }, BCRYPT_ROUNDS);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 409, 'USER_EXISTS');
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('translates a Prisma P2002 unique-constraint race on create into 409 USER_EXISTS (not a raw Prisma error)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      let caught: unknown;
      try {
        await registerUser(prisma, { email: 'race@example.com', password: 'Password1' }, BCRYPT_ROUNDS);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 409, 'USER_EXISTS');
    });
  });

  describe('loginUser', () => {
    it('returns an accessToken + refreshToken and persists a new refresh token on correct credentials', async () => {
      const passwordHash = await bcrypt.hash('CorrectHorse1', BCRYPT_ROUNDS);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'login@example.com',
        passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      prisma.refreshToken.create.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        token: 'hashed',
        expiresAt: new Date(),
        revokedAt: null,
        familyId: 'fam-1',
        createdAt: new Date(),
      });

      const result = await loginUser(
        prisma,
        { email: 'Login@Example.com', password: 'CorrectHorse1' },
        JWT_SECRET,
        BCRYPT_ROUNDS,
      );

      expect(result.accessToken.split('.')).toHaveLength(3); // JWT: header.payload.signature
      expect(typeof result.refreshToken).toBe('string');
      expect(result.refreshToken.length).toBeGreaterThan(0);
      expect(result.user).toEqual({ id: 'user-1', email: 'login@example.com' });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('throws 401 AUTH_INVALID_CREDENTIALS on a wrong password for a real user', async () => {
      const passwordHash = await bcrypt.hash('CorrectHorse1', BCRYPT_ROUNDS);
      prisma.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'login@example.com',
        passwordHash,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      let caught: unknown;
      try {
        await loginUser(prisma, { email: 'login@example.com', password: 'WrongPassword1' }, JWT_SECRET, BCRYPT_ROUNDS);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 401, 'AUTH_INVALID_CREDENTIALS');
    });

    it('throws the identical 401 AUTH_INVALID_CREDENTIALS for an unknown email, and still runs bcrypt.compare (timing-safety branch)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const compareSpy = vi.spyOn(bcrypt, 'compare');

      let caught: unknown;
      try {
        await loginUser(prisma, { email: 'nobody@example.com', password: 'WhoKnows1' }, JWT_SECRET, BCRYPT_ROUNDS);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 401, 'AUTH_INVALID_CREDENTIALS');
      expect(compareSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshSession', () => {
    it('rotates the token via a 2-operation $transaction and returns a new accessToken + differing refreshToken', async () => {
      const rawToken = 'old-raw-token';
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        userId: 'user-1',
        token: 'hashed-old',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: null,
        familyId: 'fam-1',
        createdAt: new Date(),
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      const result = await refreshSession(prisma, rawToken, JWT_SECRET);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = prisma.$transaction.mock.calls[0]![0] as unknown[];
      expect(transactionArg).toHaveLength(2);

      expect(result.accessToken.split('.')).toHaveLength(3);
      expect(result.refreshToken).not.toBe(rawToken);
      expect(typeof result.refreshToken).toBe('string');
    });

    it('throws 401 AUTH_REFRESH_INVALID when no token record is found, and never calls $transaction', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      let caught: unknown;
      try {
        await refreshSession(prisma, 'missing-token', JWT_SECRET);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 401, 'AUTH_REFRESH_INVALID');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('revokes the entire family on reuse of an already-revoked token, and throws 401 without calling $transaction', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-reused',
        userId: 'user-1',
        token: 'hashed-reused',
        expiresAt: new Date(Date.now() + 60_000),
        revokedAt: new Date('2026-01-01T00:00:00.000Z'),
        familyId: 'fam-compromised',
        createdAt: new Date(),
      });
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      let caught: unknown;
      try {
        await refreshSession(prisma, 'reused-raw-token', JWT_SECRET);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 401, 'AUTH_REFRESH_INVALID');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      const updateManyArgs = prisma.refreshToken.updateMany.mock.calls[0]![0] as {
        where: { familyId: string; revokedAt: null };
        data: { revokedAt: Date };
      };
      expect(updateManyArgs.where).toEqual({ familyId: 'fam-compromised', revokedAt: null });
      expect(updateManyArgs.data.revokedAt).toBeInstanceOf(Date);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 401 AUTH_REFRESH_INVALID on an expired-but-not-revoked token, without treating it as a compromise (no family revoke, no transaction)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-expired',
        userId: 'user-1',
        token: 'hashed-expired',
        expiresAt: new Date(Date.now() - 60_000),
        revokedAt: null,
        familyId: 'fam-expired',
        createdAt: new Date(),
      });

      let caught: unknown;
      try {
        await refreshSession(prisma, 'expired-raw-token', JWT_SECRET);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 401, 'AUTH_REFRESH_INVALID');
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('logoutUser', () => {
    it('revokes only the matching, not-yet-revoked refresh token by its sha256 hash', async () => {
      const { createHash } = await import('node:crypto');
      const rawToken = 'device-a-raw-token';
      const expectedHash = createHash('sha256').update(rawToken).digest('hex');
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await logoutUser(prisma, rawToken);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledTimes(1);
      const args = prisma.refreshToken.updateMany.mock.calls[0]![0] as {
        where: { token: string; revokedAt: null };
        data: { revokedAt: Date };
      };
      expect(args.where).toEqual({ token: expectedHash, revokedAt: null });
      expect(args.data.revokedAt).toBeInstanceOf(Date);
    });

    it('is a no-op that resolves without touching prisma when no raw token is provided', async () => {
      await expect(logoutUser(prisma, undefined)).resolves.toBeUndefined();

      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
      expect(prisma.refreshToken.findUnique).not.toHaveBeenCalled();
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });
});
