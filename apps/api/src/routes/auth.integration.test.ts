import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import bcrypt from 'bcrypt';
import { ErrorCodes } from 'shared/errorCodes';
import type {
  RegisterResponse,
  LoginResponse,
  RefreshResponse,
  ForgotPasswordResponse,
} from 'shared/types';
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
  // PasswordResetOtp has an ON DELETE CASCADE FK to User at the DB level, so
  // this line is technically a no-op once user.deleteMany() runs -- kept
  // first anyway for explicitness/safety per AB-1003's own test-cleanup note.
  await prisma.passwordResetOtp.deleteMany();
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

// AB-1003: the raw 6-digit OTP is never returned in any API response (FR-AUTH-5
// anti-enumeration) -- it only ever appears in a `console.info` dev-delivery
// log (auth.service.ts's forgotPassword). Spying on console.info around the
// /auth/forgot-password call is the only black-box way to recover the
// plaintext code for a subsequent /auth/reset-password call in these tests.
const OTP_LOG_PATTERN = /\[OTP\] Password reset code for \S+: (\d{6})/;

async function requestOtp(app: Express, email: string): Promise<string> {
  const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  try {
    const res = await request(app).post('/auth/forgot-password').send({ email });
    expect(res.status).toBe(200);

    for (const call of infoSpy.mock.calls) {
      const match = OTP_LOG_PATTERN.exec(String(call[0]));
      if (match?.[1]) {
        return match[1];
      }
    }
    throw new Error(
      `Expected a "[OTP] Password reset code for ..." console.info log for ${email}, but none was captured`,
    );
  } finally {
    infoSpy.mockRestore();
  }
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

describe('POST /auth/forgot-password', () => {
  // AB-1003. Own describe block, but a shared app is safe here: the
  // forgot-password limiter is 3/hr *per email*, and every test below uses a
  // distinct email, so none of these calls compete for the same bucket.
  const app = buildApp();

  it('#1 forgot-password for a registered email -> 200 generic message; OTP row created with attemptsLeft: 5, invalidated: false, expiresAt ~15 min out', async () => {
    const user = await seedUser('forgot1@example.com');

    const directRes = await request(app)
      .post('/auth/forgot-password')
      .send({ email: user.email });
    expect(directRes.status).toBe(200);
    const directBody = directRes.body as ForgotPasswordResponse;
    expect(typeof directBody.message).toBe('string');
    expect(directBody.message.length).toBeGreaterThan(0);

    const before = Date.now();
    const otp = await requestOtp(app, user.email);
    expect(otp).toMatch(/^\d{6}$/);

    const row = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id, invalidated: false },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    expect(row?.attemptsLeft).toBe(5);
    expect(row?.invalidated).toBe(false);

    const expectedExpiry = before + 15 * 60 * 1000;
    const lowerBound = expectedExpiry - 60 * 1000; // now + 14min
    const upperBound = expectedExpiry + 60 * 1000; // now + 16min
    expect(row?.expiresAt.getTime()).toBeGreaterThan(lowerBound);
    expect(row?.expiresAt.getTime()).toBeLessThan(upperBound);
  });

  it('#2 forgot-password for an unregistered email -> identical 200 generic message; no OTP row created', async () => {
    const user = await seedUser('registered2@example.com');

    const registeredRes = await request(app)
      .post('/auth/forgot-password')
      .send({ email: user.email });
    const unregisteredRes = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'ghost2@example.com' });

    expect(registeredRes.status).toBe(200);
    expect(unregisteredRes.status).toBe(200);
    expect(unregisteredRes.body).toEqual(registeredRes.body);

    // Only the registered call above should have produced a row; if the
    // unregistered call had created one too this count would be 2.
    const totalOtpRows = await prisma.passwordResetOtp.count();
    expect(totalOtpRows).toBe(1);
  });

  it('#3 forgot-password requested twice for the same user -> only the newest OTP row is un-invalidated', async () => {
    const user = await seedUser('twice3@example.com');

    await requestOtp(app, user.email);
    await requestOtp(app, user.email);

    const rows = await prisma.passwordResetOtp.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]?.invalidated).toBe(true);
    expect(rows[1]?.invalidated).toBe(false);
  });
});

describe('POST /auth/forgot-password — rate limit', () => {
  // Fresh app for isolated rate-limiter state, matching the register/login
  // rate-limit test pattern above.
  it('#4 blocks the 4th forgot-password request within an hour for the same email; a different email is unaffected', async () => {
    const app = buildApp();
    const user = await seedUser('ratelimited4@example.com');

    const first = await request(app)
      .post('/auth/forgot-password')
      .send({ email: user.email });
    const second = await request(app)
      .post('/auth/forgot-password')
      .send({ email: user.email });
    const third = await request(app)
      .post('/auth/forgot-password')
      .send({ email: user.email });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);

    const fourth = await request(app)
      .post('/auth/forgot-password')
      .send({ email: user.email });
    expect(fourth.status).toBe(429);
    expect(fourth.body).toMatchObject({ code: ErrorCodes.RATE_LIMITED });

    // Proves the limiter is keyed by normalized email, not IP: a different
    // email from the very same (supertest, same-process) "IP" is unaffected.
    const otherEmail = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'unrelated4@example.com' });
    expect(otherEmail.status).toBe(200);
  });

  // AB-1003 plan.md risk #5: forgotPasswordRateLimitKey's IP fallback (the
  // ipKeyGenerator branch in auth.router.ts) only fires when req.body has no
  // usable string email. Since the rate limiter is mounted *before* the
  // controller's Zod validation, a malformed body still gets counted against
  // an IP-keyed bucket even though the controller itself later rejects it
  // with 400 -- proving a client can't dodge the limiter by simply omitting
  // (or mistyping) the email field. Note this IP-fallback bucket is separate
  // from any given email's bucket (the keyGenerator prefers the email when
  // present), so the 4th call that finally trips 429 must itself be another
  // malformed (IP-keyed) request, not a valid-email one -- a valid, distinct
  // email always starts its own fresh per-email bucket regardless of how
  // many malformed requests preceded it from the same IP.
  it('#5 falls back to IP-keying malformed-body requests, so 3 malformed calls exhaust that bucket and a 4th malformed call from the same IP is rate limited, not merely re-validated', async () => {
    const app = buildApp();

    const first = await request(app).post('/auth/forgot-password').send({});
    const second = await request(app).post('/auth/forgot-password').send({ email: 123 });
    const third = await request(app).post('/auth/forgot-password').send({});

    expect(first.status).toBe(400);
    expect(first.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
    expect(second.status).toBe(400);
    expect(second.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
    expect(third.status).toBe(400);
    expect(third.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });

    // Same IP-fallback bucket as the three calls above (still no usable
    // email) -- if the limiter hadn't counted those malformed calls, this
    // would come back another 400 instead of 429.
    const fourth = await request(app).post('/auth/forgot-password').send({});
    expect(fourth.status).toBe(429);
    expect(fourth.body).toMatchObject({ code: ErrorCodes.RATE_LIMITED });

    // A valid, distinct email starts its own separate per-email bucket, so
    // it is unaffected by the exhausted IP-fallback bucket above.
    const fifth = await request(app)
      .post('/auth/forgot-password')
      .send({ email: 'stillbucketed5@example.com' });
    expect(fifth.status).toBe(200);
  });
});

describe('POST /auth/reset-password', () => {
  const app = buildApp();

  it('#5 resets the password with a correct OTP and valid new password -> 204; passwordHash changes; OTP row invalidated', async () => {
    const user = await seedUser('reset5@example.com');
    const otp = await requestOtp(app, user.email);
    const newPassword = 'NewPassword123';

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: user.email, otp, newPassword });

    expect(res.status).toBe(204);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    expect(updated).not.toBeNull();
    expect(await bcrypt.compare(user.rawPassword, updated?.passwordHash ?? '')).toBe(false);
    expect(await bcrypt.compare(newPassword, updated?.passwordHash ?? '')).toBe(true);

    const otpRow = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(otpRow?.invalidated).toBe(true);
  });

  it('#6 rejects a weak new password even with a correct OTP -> 400 VALIDATION_FAILED; attemptsLeft unchanged', async () => {
    const user = await seedUser('reset6@example.com');
    const otp = await requestOtp(app, user.email);

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: user.email, otp, newPassword: 'weak' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });

    const otpRow = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(otpRow?.attemptsLeft).toBe(5);
    expect(otpRow?.invalidated).toBe(false);
  });

  it('#7 rejects a wrong OTP (1st attempt) -> 401 AUTH_OTP_INVALID; attemptsLeft decremented to 4', async () => {
    const user = await seedUser('reset7@example.com');
    const otp = await requestOtp(app, user.email);
    const wrongOtp = otp === '000000' ? '111111' : '000000';

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: user.email, otp: wrongOtp, newPassword: VALID_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: ErrorCodes.AUTH_OTP_INVALID });

    const otpRow = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(otpRow?.attemptsLeft).toBe(4);
  });

  it('#8 invalidates the OTP row on the 5th wrong attempt; the correct code afterward still fails', async () => {
    const user = await seedUser('reset8@example.com');
    const otp = await requestOtp(app, user.email);
    const wrongOtp = otp === '000000' ? '111111' : '000000';

    for (let i = 0; i < 5; i += 1) {
      const res = await request(app)
        .post('/auth/reset-password')
        .send({ email: user.email, otp: wrongOtp, newPassword: VALID_PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({ code: ErrorCodes.AUTH_OTP_INVALID });
    }

    const otpRow = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(otpRow?.invalidated).toBe(true);

    const correctAttempt = await request(app)
      .post('/auth/reset-password')
      .send({ email: user.email, otp, newPassword: VALID_PASSWORD });
    expect(correctAttempt.status).toBe(401);
    expect(correctAttempt.body).toMatchObject({ code: ErrorCodes.AUTH_OTP_INVALID });
  });

  it('#9 rejects reset-password after the OTPs 15-minute expiry, even with the correct code', async () => {
    const user = await seedUser('reset9@example.com');
    const otp = await requestOtp(app, user.email);

    const otpRow = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(otpRow).not.toBeNull();
    const otpId = otpRow?.id;
    if (!otpId) {
      throw new Error('Expected an OTP row id');
    }
    await prisma.passwordResetOtp.update({
      where: { id: otpId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: user.email, otp, newPassword: VALID_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: ErrorCodes.AUTH_OTP_INVALID });
  });

  it('#10 rejects reset-password for an unregistered email -> 401 AUTH_OTP_INVALID, indistinguishable from a wrong-OTP response', async () => {
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: 'ghost10@example.com', otp: '123456', newPassword: VALID_PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      code: ErrorCodes.AUTH_OTP_INVALID,
      message: expect.any(String),
    });
  });

  it('#11 revokes both devices refresh tokens on a successful reset, so /auth/refresh from either device fails afterward', async () => {
    const user = await seedUser('reset11@example.com');
    const deviceX = await loginAndGetTokens(app, user.email);
    const deviceY = await loginAndGetTokens(app, user.email);

    const otp = await requestOtp(app, user.email);
    const res = await request(app)
      .post('/auth/reset-password')
      .send({ email: user.email, otp, newPassword: 'BrandNewPassword1' });
    expect(res.status).toBe(204);

    const refreshX = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${deviceX.refreshTokenRaw}`);
    const refreshY = await request(app)
      .post('/auth/refresh')
      .set('Cookie', `refreshToken=${deviceY.refreshTokenRaw}`);

    expect(refreshX.status).toBe(401);
    expect(refreshX.body).toMatchObject({ code: ErrorCodes.AUTH_REFRESH_INVALID });
    expect(refreshY.status).toBe(401);
    expect(refreshY.body).toMatchObject({ code: ErrorCodes.AUTH_REFRESH_INVALID });
  });
});
