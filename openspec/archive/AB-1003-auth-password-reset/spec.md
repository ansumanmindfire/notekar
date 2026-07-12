---
ticket: AB-1003
type: BACKEND
status: APPROVED
---

# AB-1003: Forgot Password Flow

## Overview

Implements the OTP-based forgot-password / reset-password flow for the Note Taking Application: `POST /auth/forgot-password` generates a 6-digit, bcrypt-hashed, 15-minute OTP for a user (logged to console since no real email is sent) and always returns an identical generic response regardless of whether the email is registered; `POST /auth/reset-password` verifies the OTP (max 5 attempts) and, on success, updates the password and revokes **every** active refresh token for that user across all devices. This ticket builds directly on AB-1002's `User` model, bcrypt/JWT conventions, and rate-limiter factory.

## Goals

- `PasswordResetOtp` Prisma model added via a real migration, applied to both `notes_dev` and `notes_test` (SDS §2.2, §18).
- `POST /auth/forgot-password`: `{ email }` → `200 { message }`, always the same generic message whether or not the email is registered (FR-AUTH-5 anti-enumeration). Rate-limited **3/hour, keyed by normalized email** (not IP) per SDS §17 — requires a custom `keyGenerator` on the rate limiter, unlike every other auth route which is IP-keyed.
- On a valid (registered) email: generate a 6-digit numeric OTP, bcrypt-hash it (`BCRYPT_ROUNDS`), persist with `expiresAt = now + 15min` and `attemptsLeft = 5`, and log the raw OTP via `console.info` with an `[OTP]` prefix (SDS §16 — dev-only substitute for real email delivery).
- **Reissue invalidates prior OTPs**: before creating the new OTP row, mark every existing un-invalidated `PasswordResetOtp` row for that user as `invalidated = true`, so only the most recently issued OTP is ever valid.
- `POST /auth/reset-password`: `{ email, otp, newPassword }` → `204` on success. Validates `newPassword` with the same shared `passwordSchema` (8–72 chars, upper+lower+number) used at registration.
- OTP verification is attempt-limited: each wrong guess decrements `attemptsLeft`; reaching 0 marks the row `invalidated = true`. All 5 wrong attempts, an expired OTP, an already-invalidated OTP, or an unknown email all return the identical `401 AUTH_OTP_INVALID` — no distinct code or message leaks *why* it failed (FR-AUTH-6 + anti-enumeration).
- **Timing-safety on unknown email**: mirrors `loginUser`'s dummy-bcrypt-compare pattern — when the email doesn't match any user, `reset-password` still performs a bcrypt compare against a cached dummy hash before returning `401 AUTH_OTP_INVALID`, so response timing doesn't reveal account existence.
- On successful reset: password is rehashed and updated, the matched OTP row is invalidated (single-use), and **all** `RefreshToken` rows for the user (every `familyId`, every device) are revoked — not just the current session's — per FR-AUTH-6 and SDS §8.
- Error code `AUTH_OTP_INVALID` (401) added to `packages/shared/src/errorCodes.ts`.
- New Zod schemas `forgotPasswordSchema` (`{ email }`) and `resetPasswordSchema` (`{ email, otp, newPassword }`) added to `packages/shared/src/schemas.ts`, reusing the existing `passwordSchema` for `newPassword`.

## Non-Goals

- No frontend work (forgot-password / reset-password pages, forms) — that is AB-1010.
- No actual email sending — console log only, per FRS §1.2 (out of scope project-wide).
- No change to `/auth/login`, `/auth/register`, `/auth/refresh`, or `/auth/logout` behavior — this ticket is purely additive.
- No scheduled purge job for expired/invalidated `PasswordResetOtp` rows — FRS/SDS define auto-purge only for `NoteVersion` (FR-VER-3) and soft-deleted `Note` rows (FR-NOTE-8); stale OTP rows are simply left in place (small, bounded table; no purge requirement specified for this model).
- No IP-based rate limiter on `/auth/reset-password` — the 5-attempt cap baked into the OTP model is the only guard, consistent with SDS §17's consolidated rate-limit table listing only "Forgot Password Requests" (per-email) for this flow.

## FRs Covered

| FR | Coverage |
|---|---|
| FR-AUTH-5 | Forgot Password (OTP Generation) — 6-digit code, 15-min TTL, identical generic response for known/unknown email, per-email rate limiting |
| FR-AUTH-6 | Password Reset (OTP Verification) — max 5 attempts, all-device session revocation on success, expired-OTP rejection |

Soft-delete rule (AGENTS.md §6, §11): not applicable — `PasswordResetOtp` is not a `Note`/`NoteVersion`, and no cascade in this ticket touches those tables. `PasswordResetOtp.user` uses `onDelete: Cascade`, matching the existing `RefreshToken.user` precedent (AB-1002 spec §"Data Model") — it cascades an auth-adjacent record on user deletion, not a `Note` row.

## API Contract

Both endpoints are unauthenticated.

- `POST /auth/forgot-password`
  - Body: `{ email: string }`
  - `200 { message: string }` — **always** this response, whether or not the email is registered (no `201`/`404` branching)
  - `400 VALIDATION_FAILED` (malformed email)
  - `429 RATE_LIMITED` (>3/hour, keyed by normalized email)
- `POST /auth/reset-password`
  - Body: `{ email: string, otp: string, newPassword: string }`
  - `204` on success — password updated, all refresh tokens for the user revoked
  - `400 VALIDATION_FAILED` (malformed email/OTP shape, or `newPassword` outside 8–72 chars / missing complexity)
  - `401 AUTH_OTP_INVALID` (unknown email, wrong OTP, expired OTP, already-invalidated/exhausted OTP — all identical)

## Data Model

```prisma
model PasswordResetOtp {
  id           String    @id @default(cuid())
  userId       String
  otpHash      String              // bcrypt hash of the 6-digit code, never plaintext
  expiresAt    DateTime
  attemptsLeft Int       @default(5)
  invalidated  Boolean   @default(false)
  createdAt    DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}
```

- `User` gains an `otps PasswordResetOtp[]` relation field (mirrors the existing `refreshTokens RefreshToken[]` pattern from AB-1002).
- Migration applied to both `DATABASE_URL` (`notes_dev`) and `TEST_DATABASE_URL` (`notes_test`) per SDS §2.2/§18 — standard Prisma migration, no raw SQL needed.
- No index on `expiresAt` is added — unlike `NoteVersion.savedAt` (which supports the FR-VER-3 purge job), there is no purge job here to support (see Non-Goals).

## Ticket-Specific Decisions

- **OTP reissue invalidates prior OTPs**: `forgotPassword` first runs `updateMany({ where: { userId, invalidated: false }, data: { invalidated: true } })` before creating the new row, inside the same transaction as the create. This guarantees at most one valid OTP per user at any time, eliminating ambiguity about which of several outstanding codes is "the" active one.
- **Unknown email at reset-password → identical `401 AUTH_OTP_INVALID`**: to avoid leaking account existence through this endpoint (consistent with the anti-enumeration intent already applied to `/auth/login` and `/auth/forgot-password`). A dummy `bcrypt.compare` against a cached dummy hash runs on the not-found path, reusing the same timing-safety pattern `auth.service.ts`'s `loginUser` already established (`getDummyHash`/`DUMMY_PASSWORD_FOR_TIMING`).
- **Attempt decrement is atomic**: the wrong-OTP branch decrements `attemptsLeft` via Prisma's atomic field-update operator (`{ attemptsLeft: { decrement: 1 } }`), which compiles to a single `UPDATE ... SET "attemptsLeft" = "attemptsLeft" - 1` SQL statement — atomic at the Postgres row level with no read-then-write gap, so concurrent wrong guesses can't race past the 5-attempt cap. (Revised from an earlier draft that described this as wrapped in an interactive `prisma.$transaction`; the atomic-operator form achieves the same race-safety guarantee more directly, without needing a multi-statement transaction.) A follow-up `update` sets `invalidated = true` only once the decremented value reaches 0.
- **Timing-safety is applied uniformly across every `resetPassword` failure branch**, not just the unknown-email path: unknown email, no active OTP row, an expired-but-otherwise-valid OTP row, and a wrong OTP all run a real `bcrypt.compare` (against the shared dummy hash for the first two, against the row's real `otpHash` for the latter two) before throwing, so no branch responds measurably faster than another. `forgotPassword`'s unknown-email path likewise runs a dummy `bcrypt.hash` of equivalent cost to the known-email path's real OTP hash, closing the same class of timing gap on that endpoint.
- **No per-attempt detail leaked**: the response body never includes remaining-attempts count or which specific check failed (wrong code vs. expired vs. exhausted) — only the generic `AUTH_OTP_INVALID` code/message, matching the FRS's "identical generic" philosophy used elsewhere in auth.
- **All-device revocation on success**: `resetPassword` runs `refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })` — every family, every device, not just the family tied to the current request (there isn't one, since this endpoint carries no refresh cookie).
- **Rate limiter keyed by email, not IP**: `createRateLimiter` (from AB-1002) defaults to IP-based keying via `express-rate-limit`'s standard key generator. This ticket adds a `keyGenerator: (req) => req.body?.email?.toLowerCase() ?? req.ip` override specifically for the forgot-password route, since SDS §17 scopes this one limit "per Email Address" rather than per IP.

## Scenarios

1. **Forgot-password for a registered email** → `200` generic message; OTP row created with `attemptsLeft: 5`, `invalidated: false`, `expiresAt` 15 minutes out; raw OTP logged via `console.info` with `[OTP]` prefix.
2. **Forgot-password for an unregistered email** → identical `200` generic message; no OTP row created, no error.
3. **Forgot-password requested twice in a row for the same user** → first OTP row is marked `invalidated: true`; only the second (newest) OTP row is usable at `/auth/reset-password`.
4. **Forgot-password beyond rate limit (>3/hr for the same email)** → `429 RATE_LIMITED`; a different email from the same IP is unaffected.
5. **Reset-password with correct OTP and valid new password (within 15 min, within 5 attempts)** → `204`; `passwordHash` updated; the OTP row is invalidated; every `RefreshToken` row for the user (across all `familyId`s) is revoked.
6. **Reset-password with correct OTP but weak/invalid new password** → `400 VALIDATION_FAILED`; OTP is **not** consumed (attempt not decremented, since the failure is on `newPassword`, not the OTP itself) — user can retry with a valid password using the same OTP.
7. **Reset-password with wrong OTP (1st–4th attempt)** → `401 AUTH_OTP_INVALID`; `attemptsLeft` decremented; OTP still usable for remaining attempts.
8. **Reset-password with wrong OTP on the 5th attempt** → `401 AUTH_OTP_INVALID`; OTP row marked `invalidated: true`; a subsequent attempt with the *correct* code against that same row also fails with `401 AUTH_OTP_INVALID`.
9. **Reset-password after the 15-minute expiry window** → `401 AUTH_OTP_INVALID`, even with the correct code.
10. **Reset-password for an unregistered email** → `401 AUTH_OTP_INVALID`, indistinguishable from a wrong-OTP response (timing included, via dummy bcrypt compare).
11. **Reset-password succeeds while the user has active sessions on two devices** → both devices' refresh tokens are revoked; subsequent `/auth/refresh` from either device returns `401 AUTH_REFRESH_INVALID`, forcing re-login with the new password.

## Dependencies

- AB-1002 (Core User & Auth Models) — merged; provides `User` model, `bcrypt`/`BCRYPT_ROUNDS` hashing conventions, `RefreshToken` model + revocation pattern, `createRateLimiter` factory, `AppError`/error-handler plumbing, and the dummy-hash timing-safety pattern this ticket reuses.
- No dependency on any note/tag/search/share/version ticket (AB-1004+).

## Open Questions

None — the three ambiguous design points (OTP-reissue behavior, unknown-email response code, and whether reset-password needs its own IP rate limiter) were resolved with the user before drafting; see Ticket-Specific Decisions and Non-Goals.
