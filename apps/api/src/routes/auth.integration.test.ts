import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import bcrypt from 'bcrypt';
import { ErrorCodes } from 'shared/errorCodes';
import type { RegisterResponse, LoginResponse, RefreshResponse } from 'shared/types';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { hashToken } from '../lib/refreshToken';

// Integration tier (AGENTS.md §10 / SDS §14): real Express app, real
// `notes_test` Postgres via the Prisma singleton (vitest.setup.ts already
// forces DATABASE_URL -> TEST_DATABASE_URL before this file loads). Verifies
// behavior only a real database can prove -- most importantly, atomic
// refresh-token family revocation on reuse (scenario #9).

const TEST_ENV = {
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test' as const,
  JWT_SECRET: 'a'.repeat(32),
  BCRYPT_ROUNDS: 4, // low rounds purely for wall-clock speed, no behavior change
};

const VALID_PASSWORD = 'Password123';

function buildApp(): Express {
  return createApp(TEST_ENV);
}

async function resetDb(): Promise<void> {
  // Direct test-database cleanup between tests, not the application's
  // soft-delete rule (which only ever applies to the future Note model).
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUser(
  email: string,
  rawPassword: string = VALID_PASSWORD,
): Promise<{ id: string; email: string; rawPassword: string }> {
  const passwordHash = bcrypt.hashSync(rawPassword, TEST_ENV.BCRYPT_ROUNDS);
  const user = await prisma.user.create({ data: { email: email.toLowerCase(), passwordHash } });
  return { id: user.id, email: user.email, rawPassword };
}

function getSetCookieHeaders(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  if (!raw) {
    return [];
  }
  return Array.isArray(raw) ? raw : [raw];
}

function findRefreshCookieHeader(res: request.Response): string {
  const header = getSetCookieHeaders(res).find((h) => h.startsWith('refreshToken='));
  if (!header) {
    throw new Error('Expected a refreshToken Set-Cookie header, but none was present');
  }
  return header;
}

function extractRefreshCookieValue(res: request.Response): string {
  const header = findRefreshCookieHeader(res);
  const match = /refreshToken=([^;]+)/.exec(header);
  if (!match?.[1]) {
    throw new Error(`Could not parse refreshToken value out of header: ${header}`);
  }
  return match[1];
}

interface LoginTokens {
  accessToken: string;
  refreshTokenRaw: string;
  res: request.Response;
}

async function loginAndGetTokens(
  app: Express,
  email: string,
  password: string = VALID_PASSWORD,
): Promise<LoginTokens> {
  const res = await request(app).post('/auth/login').send({ email, password });
  expect(res.status).toBe(200);
  const body = res.body as LoginResponse;
  return {
    accessToken: body.accessToken,
    refreshTokenRaw: extractRefreshCookieValue(res),
    res,
  };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /auth/register', () => {
  const app = buildApp();

  it('#1 registers with a valid email/password -> 201, lowercased email persisted, no plaintext password stored', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'Alice@Example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(201);
    const body = res.body as RegisterResponse;
    expect(body.email).toBe('alice@example.com');
    expect(typeof body.id).toBe('string');
    expect(typeof body.createdAt).toBe('string');

    const stored = await prisma.user.findUnique({ where: { email: 'alice@example.com' } });
    expect(stored).not.toBeNull();
    expect(stored?.email).toBe('alice@example.com');
    expect(stored?.passwordHash).not.toBe(VALID_PASSWORD);
    expect(stored?.passwordHash.length).toBeGreaterThan(0);
  });

  it('#2 rejects a duplicate email differing only in case -> 409 USER_EXISTS', async () => {
    const first = await request(app)
      .post('/auth/register')
      .send({ email: 'Work@Example.com', password: VALID_PASSWORD });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/auth/register')
      .send({ email: 'work@example.com', password: VALID_PASSWORD });

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: ErrorCodes.USER_EXISTS });
  });
});

describe('POST /auth/register — validation', () => {
  // Own fresh app: keeps this single extra call out of the register-core
  // block's tight 3/hr budget above.
  const app = buildApp();

  it('#3 rejects a password outside 8-72 chars / missing complexity -> 400 VALIDATION_FAILED end-to-end', async () => {
    const res = await request(app)
      .post('/auth/register')
      .send({ email: 'shorty@example.com', password: 'Ab1' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });
});

describe('POST /auth/register — rate limit', () => {
  // CRITICAL isolation: a fresh app = a fresh per-router rate limiter
  // instance, so this test's call-count math (3 allowed + 1 blocked) is
  // self-contained and never interferes with (or is interfered by) the
  // register-core/validation blocks above.
  it('#4 blocks the 4th registration within an hour from the same IP -> 429 RATE_LIMITED', async () => {
    const app = buildApp();

    const first = await request(app)
      .post('/auth/register')
      .send({ email: 'rate1@example.com', password: VALID_PASSWORD });
    const second = await request(app)
      .post('/auth/register')
      .send({ email: 'rate2@example.com', password: VALID_PASSWORD });
    const third = await request(app)
      .post('/auth/register')
      .send({ email: 'rate3@example.com', password: VALID_PASSWORD });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(201);

    const fourth = await request(app)
      .post('/auth/register')
      .send({ email: 'rate4@example.com', password: VALID_PASSWORD });

    expect(fourth.status).toBe(429);
    expect(fourth.body).toMatchObject({ code: ErrorCodes.RATE_LIMITED });
  });
});

describe('POST /auth/login', () => {
  const app = buildApp();

  it('#5 logs in with correct credentials -> 200, JWT-looking accessToken, refreshToken cookie set (HttpOnly, Path=/auth)', async () => {
    await seedUser('loginok@example.com');

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'loginok@example.com', password: VALID_PASSWORD });

    expect(res.status).toBe(200);
    const body = res.body as LoginResponse;
    expect(body.accessToken.split('.')).toHaveLength(3);
    expect(body.user).toEqual({ id: expect.any(String), email: 'loginok@example.com' });

    const cookieHeader = findRefreshCookieHeader(res);
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/Path=\/auth/i);
  });

  it('#6 returns an identical 401 AUTH_INVALID_CREDENTIALS body for wrong password and for an unknown email', async () => {
    await seedUser('knownuser@example.com');

    const wrongPassword = await request(app)
      .post('/auth/login')
      .send({ email: 'knownuser@example.com', password: 'WrongPass1' });

    const unknownEmail = await request(app)
      .post('/auth/login')
      .send({ email: 'nosuchuser@example.com', password: VALID_PASSWORD });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual({
      code: ErrorCodes.AUTH_INVALID_CREDENTIALS,
      message: expect.any(String),
    });
    expect(unknownEmail.body).toEqual(wrongPassword.body);
  });
});

describe('POST /auth/login — rate limit', () => {
  it('#7 blocks the 6th login within a minute from the same IP -> 429 RATE_LIMITED', async () => {
    const app = buildApp();
    await seedUser('ratelimited@example.com');

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/auth/login')
        .send({ email: 'ratelimited@example.com', password: 'WrongPass1' });
      expect(res.status).toBe(401);
    }

    const sixth = await request(app)
      .post('/auth/login')
      .send({ email: 'ratelimited@example.com', password: 'WrongPass1' });

    expect(sixth.status).toBe(429);
    expect(sixth.body).toMatchObject({ code: ErrorCodes.RATE_LIMITED });
  });
});

describe('POST /auth/refresh', () => {
  const app = buildApp();

  it('#8 rotates the refresh token within the same family and issues a new accessToken', async () => {
    const user = await seedUser('refreshok@example.com');
    const { refreshTokenRaw: rawA } = await loginAndGetTokens(app, user.email);

    const before = await prisma.refreshToken.findUnique({ where: { token: hashToken(rawA) } });
    expect(before).not.toBeNull();

    const res = await request(app).post('/auth/refresh').set('Cookie', `refreshToken=${rawA}`);

    expect(res.status).toBe(200);
    const body = res.body as RefreshResponse;
    expect(body.accessToken.split('.')).toHaveLength(3);

    const rawB = extractRefreshCookieValue(res);
    expect(rawB).not.toBe(rawA);

    const oldRow = await prisma.refreshToken.findUnique({ where: { token: hashToken(rawA) } });
    const newRow = await prisma.refreshToken.findUnique({ where: { token: hashToken(rawB) } });
    expect(oldRow?.revokedAt).not.toBeNull();
    expect(newRow?.revokedAt).toBeNull();
    expect(newRow?.familyId).toBe(before?.familyId);
  });

  it('#9 revokes the entire token family when a rotated (already-used) token is replayed', async () => {
    const user = await seedUser('reuse@example.com');
    const { refreshTokenRaw: rawA } = await loginAndGetTokens(app, user.email);

    const firstRefresh = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${rawA}`);
    expect(firstRefresh.status).toBe(200);
    const rawB = extractRefreshCookieValue(firstRefresh);

    // Replay the old, already-rotated token A -- this is the compromised-token
    // scenario: the whole family (including the currently-valid B) must be
    // revoked atomically as a side effect of this single request.
    const replayA = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${rawA}`);
    expect(replayA.status).toBe(401);
    expect(replayA.body).toMatchObject({ code: ErrorCodes.AUTH_REFRESH_INVALID });

    // B was valid moments ago (used successfully above) but must now also be
    // rejected, proving the entire family was revoked, not just token A.
    const attemptB = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${rawB}`);
    expect(attemptB.status).toBe(401);
    expect(attemptB.body).toMatchObject({ code: ErrorCodes.AUTH_REFRESH_INVALID });
  });

  it('#10 rejects a refresh request with no cookie at all -> 401 AUTH_REFRESH_INVALID', async () => {
    const res = await request(app).post('/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: ErrorCodes.AUTH_REFRESH_INVALID });
  });
});

describe('POST /auth/logout', () => {
  const app = buildApp();

  it('#11 logging out one device revokes only that device, leaving an independent session unaffected', async () => {
    const user = await seedUser('twodevices@example.com');

    const deviceX = await loginAndGetTokens(app, user.email);
    const deviceY = await loginAndGetTokens(app, user.email);

    const logoutRes = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${deviceX.accessToken}`)
      .set('Cookie', `refreshToken=${deviceX.refreshTokenRaw}`);
    expect(logoutRes.status).toBe(204);

    const refreshY = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${deviceY.refreshTokenRaw}`);
    expect(refreshY.status).toBe(200);

    const refreshX = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${deviceX.refreshTokenRaw}`);
    expect(refreshX.status).toBe(401);
    expect(refreshX.body).toMatchObject({ code: ErrorCodes.AUTH_REFRESH_INVALID });
  });

  it('#12 is idempotent -- calling logout twice in a row returns 204 both times', async () => {
    const user = await seedUser('idempotent@example.com');
    const { accessToken, refreshTokenRaw } = await loginAndGetTokens(app, user.email);

    const firstLogout = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', `refreshToken=${refreshTokenRaw}`);
    expect(firstLogout.status).toBe(204);

    const secondLogout = await request(app)
      .post('/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', `refreshToken=${refreshTokenRaw}`);
    expect(secondLogout.status).toBe(204);
  });
});
