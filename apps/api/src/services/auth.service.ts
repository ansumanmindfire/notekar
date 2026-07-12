import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import type { RegisterInput, LoginInput, ForgotPasswordInput, ResetPasswordInput } from 'shared/schemas';
import { AppError } from '../lib/AppError';
import { signAccessToken } from '../lib/jwt';
import { generateOpaqueToken, hashToken } from '../lib/refreshToken';
import { generateOtp } from '../lib/otp';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const OTP_TTL_MS = 15 * 60 * 1000;
const DUMMY_PASSWORD_FOR_TIMING = 'dummy-password-for-timing-safety';

// Cached per bcryptRounds value so the "user not found" path always costs the
// same as a real bcrypt.compare at the configured rounds, closing the timing
// side-channel that would otherwise reveal whether an email is registered.
const dummyHashCache = new Map<number, string>();

function getDummyHash(bcryptRounds: number): string {
  let hash = dummyHashCache.get(bcryptRounds);
  if (!hash) {
    hash = bcrypt.hashSync(DUMMY_PASSWORD_FOR_TIMING, bcryptRounds);
    dummyHashCache.set(bcryptRounds, hash);
  }
  return hash;
}

export interface RegisteredUser {
  id: string;
  email: string;
  createdAt: Date;
}

export async function registerUser(
  prisma: PrismaClient,
  input: RegisterInput,
  bcryptRounds: number,
): Promise<RegisteredUser> {
  const email = input.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    throw new AppError(409, ErrorCodes.USER_EXISTS, 'An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, bcryptRounds);

  try {
    const user = await prisma.user.create({ data: { email, passwordHash } });
    return { id: user.id, email: user.email, createdAt: user.createdAt };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, ErrorCodes.USER_EXISTS, 'An account with this email already exists');
    }
    throw err;
  }
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: { id: string; email: string };
}

export async function loginUser(
  prisma: PrismaClient,
  input: LoginInput,
  jwtSecret: string,
  bcryptRounds: number,
): Promise<LoginResult> {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  const passwordHash = user?.passwordHash ?? getDummyHash(bcryptRounds);
  const passwordMatches = await bcrypt.compare(input.password, passwordHash);

  if (!user || !passwordMatches) {
    throw new AppError(401, ErrorCodes.AUTH_INVALID_CREDENTIALS, 'Invalid email or password');
  }

  const accessToken = signAccessToken(user.id, jwtSecret);
  const { rawToken, refreshExpiresAt } = await issueRefreshToken(prisma, user.id, randomUUID());

  return {
    accessToken,
    refreshToken: rawToken,
    refreshExpiresAt,
    user: { id: user.id, email: user.email },
  };
}

async function issueRefreshToken(
  prisma: PrismaClient,
  userId: string,
  familyId: string,
): Promise<{ rawToken: string; refreshExpiresAt: Date }> {
  const rawToken = generateOpaqueToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.refreshToken.create({
    data: {
      userId,
      token: hashToken(rawToken),
      expiresAt: refreshExpiresAt,
      familyId,
    },
  });

  return { rawToken, refreshExpiresAt };
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export async function refreshSession(
  prisma: PrismaClient,
  rawToken: string,
  jwtSecret: string,
): Promise<RefreshResult> {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { token: tokenHash } });

  if (!existing) {
    throw new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Invalid refresh token');
  }

  if (existing.revokedAt) {
    // Reuse of an already-rotated token: treat the whole lineage as
    // compromised and revoke every token sharing this familyId atomically.
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Invalid refresh token');
  }

  if (existing.expiresAt < new Date()) {
    throw new AppError(401, ErrorCodes.AUTH_REFRESH_INVALID, 'Invalid refresh token');
  }

  const newRawToken = generateOpaqueToken();
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const now = new Date();

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: now },
    }),
    prisma.refreshToken.create({
      data: {
        userId: existing.userId,
        token: hashToken(newRawToken),
        expiresAt: refreshExpiresAt,
        familyId: existing.familyId,
      },
    }),
  ]);

  const accessToken = signAccessToken(existing.userId, jwtSecret);

  return { accessToken, refreshToken: newRawToken, refreshExpiresAt };
}

export async function logoutUser(prisma: PrismaClient, rawToken: string | undefined): Promise<void> {
  if (!rawToken) {
    return;
  }

  await prisma.refreshToken.updateMany({
    where: { token: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function forgotPassword(
  prisma: PrismaClient,
  input: ForgotPasswordInput,
  bcryptRounds: number,
): Promise<void> {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Timing-safety mirror of loginUser/resetPassword: run a real bcrypt.hash
    // of comparable cost even though there's no OTP to create, so response
    // time doesn't reveal whether the email is registered. Identical generic
    // outcome either way (FR-AUTH-5 anti-enumeration): no OTP row is
    // created, no email is "sent".
    await bcrypt.hash(DUMMY_PASSWORD_FOR_TIMING, bcryptRounds);
    return;
  }

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, bcryptRounds);
  const expiresAt = new Date(Date.now() + OTP_TTL_MS);

  await prisma.$transaction([
    // Reissuing invalidates any prior outstanding OTP so only the newest is ever valid.
    prisma.passwordResetOtp.updateMany({
      where: { userId: user.id, invalidated: false },
      data: { invalidated: true },
    }),
    prisma.passwordResetOtp.create({
      data: { userId: user.id, otpHash, expiresAt },
    }),
  ]);

  // No real email service in this project (FRS §1.2) - the OTP is logged
  // server-side instead. `otp`/`token` keys are already redacted by the pino
  // logger config (SDS §16), so this uses console.info directly, matching
  // the documented [OTP] dev-delivery convention.
  console.info(`[OTP] Password reset code for ${email}: ${otp}`);
}

export async function resetPassword(
  prisma: PrismaClient,
  input: ResetPasswordInput,
  bcryptRounds: number,
): Promise<void> {
  const email = input.email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    // Timing-safety mirror of loginUser: run a real bcrypt.compare even
    // though there's nothing to actually check, so response time doesn't
    // reveal whether the email is registered.
    await bcrypt.compare(input.otp, getDummyHash(bcryptRounds));
    throw new AppError(401, ErrorCodes.AUTH_OTP_INVALID, 'Invalid or expired reset code');
  }

  const otpRow = await prisma.passwordResetOtp.findFirst({
    where: { userId: user.id, invalidated: false, attemptsLeft: { gt: 0 } },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRow) {
    await bcrypt.compare(input.otp, getDummyHash(bcryptRounds));
    throw new AppError(401, ErrorCodes.AUTH_OTP_INVALID, 'Invalid or expired reset code');
  }

  if (otpRow.expiresAt < new Date()) {
    // Timing-safety: still run the real compare so an expired-but-otherwise-
    // valid OTP row doesn't respond measurably faster than the wrong-OTP,
    // no-active-OTP, or unknown-email branches above.
    await bcrypt.compare(input.otp, otpRow.otpHash);
    throw new AppError(401, ErrorCodes.AUTH_OTP_INVALID, 'Invalid or expired reset code');
  }

  const otpMatches = await bcrypt.compare(input.otp, otpRow.otpHash);

  if (!otpMatches) {
    // Atomic DB-level decrement (Prisma's `decrement` compiles to a single
    // `SET "attemptsLeft" = "attemptsLeft" - 1` statement) so concurrent
    // wrong guesses can't race past the 5-attempt cap via a read-then-write
    // gap.
    const updated = await prisma.passwordResetOtp.update({
      where: { id: otpRow.id },
      data: { attemptsLeft: { decrement: 1 } },
    });

    if (updated.attemptsLeft <= 0) {
      await prisma.passwordResetOtp.update({
        where: { id: otpRow.id },
        data: { invalidated: true },
      });
    }

    throw new AppError(401, ErrorCodes.AUTH_OTP_INVALID, 'Invalid or expired reset code');
  }

  const newPasswordHash = await bcrypt.hash(input.newPassword, bcryptRounds);
  const now = new Date();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: newPasswordHash },
    }),
    prisma.passwordResetOtp.update({
      where: { id: otpRow.id },
      data: { invalidated: true },
    }),
    // All devices, every familyId - not scoped to any single session, since
    // this request carries no refresh cookie of its own (FR-AUTH-6).
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: now },
    }),
  ]);
}
