---
ticket: AB-1002
type: BACKEND
status: APPROVED
---

# AB-1002: Core User & Auth Models

## Overview

Implements the backend authentication core for the Note Taking Application: user registration, login, session management via short-lived JWT access tokens paired with rotating opaque refresh tokens (with reuse/hijack detection), and logout. This is the foundation every other backend ticket builds on — `middleware/auth.ts` (bearer-token verification) is delivered here so later tickets (Notes, Tags, Search, Sharing, Versions) can mount protected routes without re-deriving session handling.

Forgot-password/OTP (FR-AUTH-5, FR-AUTH-6) is explicitly out of scope — that is AB-1003, which depends on this ticket's `User` model and password-hashing conventions but is not implemented here.

## Goals

- `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout` implemented per SDS §4, layered strictly `routes/` → `controllers/` → `services/` → Prisma.
- `User` and `RefreshToken` Prisma models added via a real migration, applied to both `notes_dev` and `notes_test` (SDS §2.2, §18).
- Passwords hashed with `bcrypt` (12 rounds via `BCRYPT_ROUNDS` env, already validated in `env.ts`); 8–72 char complexity validation (upper+lower+number) via a shared Zod schema in `packages/shared`.
- Case-insensitive, per-user-unique email enforced by normalizing (lowercasing) email at the application layer before every write/lookup — not a raw-SQL functional index, since `User.email` is not one of the two documented raw-SQL exceptions (AGENTS.md §11, SDS §18).
- Access token: HS256 JWT, payload `{ sub: userId, iat, exp }` only, 15-minute TTL, signed with `JWT_SECRET`.
- Refresh token: opaque 64-char string, SHA-256 hashed at rest, 7-day TTL, delivered via `httpOnly`, `SameSite=Strict`, `Secure` (non-dev) cookie scoped to `Path: /auth`.
- Rotation on every refresh within a `familyId`; reuse of an already-rotated (revoked) token instantly revokes the entire family.
- Logout idempotently revokes only the current device's refresh token; other devices/sessions unaffected.
- Login and registration failure messages are generic/identical to prevent account enumeration (FR-AUTH-1, FR-AUTH-2).
- Reusable `middleware/auth.ts`: verifies `Authorization: Bearer <token>`, attaches `req.userId`, responds `401 AUTH_TOKEN_INVALID` otherwise. No route mounts it yet (no protected resource exists before AB-1004), but it is unit-tested standalone.
- Registration, login, refresh, logout all rate-limited per SDS §17 (3/hr/IP, 5/min/IP, 20/min/IP, 20/min/IP respectively).
- Error codes used: `VALIDATION_FAILED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_INVALID`, `AUTH_REFRESH_INVALID`, `USER_EXISTS`, `RATE_LIMITED` — added to `packages/shared/src/errorCodes.ts`.

## Non-Goals

- No `PasswordResetOtp` model, OTP generation/verification, or `/auth/forgot-password` / `/auth/reset-password` endpoints — deferred entirely to AB-1003.
- No `Note`, `Tag`, or any other domain model — `User` in this ticket has no `notes`/`tags` relations yet; those fields are added by the Prisma migrations that introduce those models (AB-1004, AB-1006).
- No frontend work (Zustand `authStore`, login/register pages, `apiClient.ts` 401-refresh interceptor) — that is AB-1010.
- No protected business routes mounted behind `middleware/auth.ts` — first consumer is AB-1004.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-AUTH-1 | User Registration — email/password validation, case-insensitive duplicate rejection, rate limiting, secure hashing |
| FR-AUTH-2 | User Login — generic error on bad credentials/unknown email, rate limiting |
| FR-AUTH-3 | Session Management — continuous validity via refresh, stolen-token/family revocation, rate limiting on refresh |
| FR-AUTH-4 | Logout — revokes only current device, other devices unaffected |

Soft-delete rule (AGENTS.md §6, §11): not applicable in this ticket — no `Note` rows are touched. `User` and `RefreshToken` rows are real deletes only via `onDelete: Cascade` from a (future, out-of-scope) user-deletion path, which does not exist yet; no cascade in this ticket bypasses the `Note` soft-delete rule since `Note` doesn't exist yet.

## API Contract

All four endpoints are unauthenticated except `/auth/logout`, which requires a valid access token.

- `POST /auth/register`
  - Body: `{ email: string, password: string }`
  - `201 { id, email, createdAt }`
  - `400 VALIDATION_FAILED` (bad email/password shape, password outside 8–72 chars or missing complexity)
  - `409 USER_EXISTS` (case-insensitive duplicate email)
  - `429 RATE_LIMITED` (>3/hour/IP)
- `POST /auth/login`
  - Body: `{ email: string, password: string }`
  - `200 { accessToken, user: { id, email } }` + sets `refreshToken` httpOnly cookie (`Path: /auth`, 7-day TTL)
  - `401 AUTH_INVALID_CREDENTIALS` (wrong password OR unknown email — identical message/code)
  - `429 RATE_LIMITED` (>5/min/IP)
- `POST /auth/refresh`
  - No body; reads `refreshToken` cookie
  - `200 { accessToken }` + rotates `refreshToken` cookie (new opaque token, same `familyId`)
  - `401 AUTH_REFRESH_INVALID` (missing, expired, revoked, or reused token — family revoked as a side effect on reuse)
  - `429 RATE_LIMITED` (>20/min/IP)
- `POST /auth/logout`
  - Requires `Authorization: Bearer <accessToken>`; reads `refreshToken` cookie
  - `204` (idempotent — revokes only this device's current refresh token, clears the cookie)
  - `429 RATE_LIMITED` (>20/min/IP)

## Data Model

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique   // stored lowercased; enforces case-insensitive uniqueness without raw SQL
  passwordHash  String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  refreshTokens RefreshToken[]
}

model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  token      String    @unique   // sha256 hash of the opaque 64-char token, never the raw value
  expiresAt  DateTime
  revokedAt  DateTime?
  familyId   String
  createdAt  DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([familyId])
}
```

- `onDelete: Cascade` on `RefreshToken.user` is acceptable here — it cascades auth session records when a `User` row is deleted, not `Note` rows, so it does not violate the Note soft-delete rule (AGENTS.md §9, §11).
- Migration applied to both `DATABASE_URL` (`notes_dev`) and `TEST_DATABASE_URL` (`notes_test`) per SDS §2.2/§18 — standard Prisma migration, no raw SQL needed for this ticket.
- `otps`, `notes`, `tags` relation fields are intentionally omitted from `User` until the tickets that introduce `PasswordResetOtp`/`Note`/`Tag` add them (Prisma requires both sides of a relation to exist in the same schema).

## Ticket-Specific Decisions

- **Email case-insensitivity via normalization, not raw SQL**: since `User.email` isn't one of the two documented raw-SQL exceptions (`tsvector`, Tag case-insensitive index), registration/login lowercase the email before every DB write/lookup. A plain `@unique` then transparently enforces per-user case-insensitive uniqueness.
- **Refresh token storage**: only the SHA-256 hash is ever persisted; the raw 64-char opaque value exists only in the httpOnly cookie and is never logged (pino redaction already covers `cookie`/`token` keys per SDS §16).
- **Reuse detection**: on `/auth/refresh`, if the presented token's hash matches a `RefreshToken` row with `revokedAt IS NOT NULL`, treat as compromised — revoke every row sharing that `familyId` and return `401 AUTH_REFRESH_INVALID`.
- **Auth middleware built now, unused until AB-1004**: `middleware/auth.ts` is unit-tested in isolation (valid token → `req.userId` set; missing/expired/malformed → `401 AUTH_TOKEN_INVALID`) since no protected route exists yet to exercise it end-to-end.
- **PasswordResetOtp fully deferred**: no model, migration, or route stub added in this ticket; AB-1003 owns its own migration.

## Scenarios

1. **Register with valid email/password** → `201`, user persisted with lowercased email and bcrypt hash, no plaintext password stored.
2. **Register with duplicate email differing only in case** (`Work@x.com` vs `work@x.com`) → `409 USER_EXISTS`.
3. **Register with password missing complexity or outside 8–72 chars** → `400 VALIDATION_FAILED`.
4. **Register beyond rate limit (>3/hr/IP)** → `429 RATE_LIMITED`.
5. **Login with correct credentials** → `200`, `accessToken` returned, `refreshToken` cookie set (httpOnly, SameSite=Strict, Secure in non-dev, Path=/auth).
6. **Login with wrong password** and **login with unknown email** → both return the identical `401 AUTH_INVALID_CREDENTIALS` body.
7. **Login beyond rate limit (>5/min/IP)** → `429 RATE_LIMITED`.
8. **Refresh with valid, unrotated cookie** → `200` new `accessToken`, cookie rotated to a new token in the same `familyId`.
9. **Refresh with an already-rotated (revoked) token** → entire `familyId` revoked, `401 AUTH_REFRESH_INVALID`; a subsequent refresh attempt with any token from that family also fails.
10. **Refresh with expired or missing cookie** → `401 AUTH_REFRESH_INVALID`.
11. **Logout on Device A** → Device A's refresh token revoked and cookie cleared; Device B's independent session/refresh token remains valid.
12. **Logout called twice in a row (idempotency)** → second call still returns `204`, no error.
13. **`middleware/auth.ts` unit tests**: valid bearer token attaches `req.userId`; missing header, malformed header, expired token, and garbage token all yield `401 AUTH_TOKEN_INVALID`.

## Dependencies

- AB-1001 (Technical Foundation & Tooling Setup) — merged; provides `env.ts`, `AppError`, `errorHandler`, Prisma singleton, rate-limit factory, `packages/shared` skeleton.
- No dependency on AB-1003 — this ticket does not read or write any OTP-related state.

## Open Questions

None — all scope ambiguities (OTP model timing, auth middleware timing, rate-limit values) were resolved with the user before drafting.
