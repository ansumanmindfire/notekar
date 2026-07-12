---
ticket: AB-1003
status: APPROVED
---

# AB-1003: Forgot Password Flow — Plan

## Files to Create

**`apps/api/src/lib/`**
- `otp.ts` — `generateOtp(): string`, a pure function producing a 6-digit numeric string (`crypto.randomInt(0, 1_000_000)`, zero-padded to 6 digits). No Prisma/bcrypt coupling, mirrors the existing `refreshToken.ts` pattern (pure, trivially unit-testable). Hashing reuses `bcrypt` directly in the service, same as password hashing already does — no separate hash wrapper needed.
- `otp.test.ts` — unit tests: output is always exactly 6 digits (including leading-zero cases), charset is `0-9` only, repeated calls produce varying values.

## Files to Modify

**`packages/shared/src/`** (contract layer)
- `errorCodes.ts` — add `AUTH_OTP_INVALID: 'AUTH_OTP_INVALID'` to the existing `ErrorCodes` const.
- `schemas.ts` — add `forgotPasswordSchema` (`{ email: z.email() }`) and `resetPasswordSchema` (`{ email: z.email(), otp: z.string().regex(/^[0-9]{6}$/, 'OTP must be a 6-digit code'), newPassword: passwordSchema }`), reusing the existing (already-defined, not exported previously — will export) `passwordSchema` constant. Export `ForgotPasswordInput`/`ResetPasswordInput` types via `z.infer`, matching the existing `RegisterInput`/`LoginInput` pattern.
- `schemas.test.ts` — add unit tests for both new schemas (valid shapes pass; malformed email, non-6-digit OTP, and weak `newPassword` all rejected).
- `types.ts` — add `ForgotPasswordResponse = { message: string }`.

**`apps/api/prisma/`**
- `schema.prisma` — add `PasswordResetOtp` model exactly as specified in spec.md §Data Model; add `otps PasswordResetOtp[]` to the existing `User` model's relation list.
- `migrations/<timestamp>_password_reset_otp/migration.sql` — generated via `prisma migrate dev --name password_reset_otp`, applied to both `notes_dev` and `notes_test` per SDS §2.2/§18.

**`apps/api/src/services/`**
- `auth.service.ts` — add `forgotPassword(prisma, input, bcryptRounds)` and `resetPassword(prisma, input, bcryptRounds)`. Reuses the existing `getDummyHash`/`DUMMY_PASSWORD_FOR_TIMING` helpers already defined in this file for the unknown-email timing-safety path in `resetPassword`. No changes to `registerUser`/`loginUser`/`refreshSession`/`logoutUser`.
- `auth.service.test.ts` — add unit tests (Prisma mocked): `forgotPassword` invalidates prior OTPs before creating a new one for a known user / no-op DB write for unknown user but same generic return; `resetPassword` branches — correct OTP updates password + revokes all refresh tokens, wrong OTP decrements `attemptsLeft`, 5th wrong attempt sets `invalidated: true`, expired/invalidated OTP rejected, unknown email hits the dummy-compare path.

**`apps/api/src/controllers/`**
- `auth.controller.ts` — add `forgotPassword` and `resetPassword` handlers: parse body with the new shared schemas, call the matching service function, shape the response (`200 { message }` / `204`).
- `auth.controller.test.ts` — add tests for request parsing/response shaping (service mocked), consistent with existing controller test style.

**`apps/api/src/routes/`**
- `auth.router.ts` — add `POST /forgot-password` (behind a new **email-keyed** rate limiter: `createRateLimiter({ windowMs: 60*60*1000, max: 3, keyGenerator: (req) => (req.body as { email?: string } | undefined)?.email?.toLowerCase() ?? req.ip })`) and `POST /reset-password` (no rate limiter, per spec.md's Non-Goals — relies solely on the OTP's 5-attempt cap).
- `auth.integration.test.ts` — add Supertest scenarios against the real `notes_test` DB, per Test Strategy below.

## Prisma Schema Changes

- Additive only: one new model (`PasswordResetOtp`), one new relation field on the existing `User` model (`otps`). Zero changes to `RefreshToken` or any other existing model/field.
- No physical deletes introduced anywhere in this ticket — `PasswordResetOtp` rows are only ever created or updated (`invalidated`, `attemptsLeft`), never `.delete()`d by application code. (Physical deletion remains reserved for the two scheduled purge jobs, neither of which touches this table.)
- `onDelete: Cascade` is only on `PasswordResetOtp.user → User`, matching the existing `RefreshToken.user` precedent — not on any `Note`-adjacent relation, so it does not bypass the `Note` soft-delete rule (AGENTS.md §9).
- Standard Prisma DSL — no raw SQL needed (this ticket isn't one of the two documented raw-SQL exceptions).
- Must be applied identically to both `notes_dev` (`DATABASE_URL`) and `notes_test` (`TEST_DATABASE_URL`) per SDS §2.2 — same migration file run against both connection strings.

## New Packages

None. `bcrypt` (already a pinned `apps/api` dependency since AB-1002) covers OTP hashing; `node:crypto`'s `randomInt` is a Node built-in, no new package required.

## Dependencies on Prior Tickets

- **AB-1002** (merged): supplies the `User` model, `bcrypt`/`BCRYPT_ROUNDS` hashing conventions, the `RefreshToken` model + revocation pattern (`updateMany({ revokedAt: null }, { revokedAt: now })`) this ticket extends to an all-device revocation, the `createRateLimiter` factory (already accepts a `keyGenerator` override via `Partial<Options>` — no modification to `rateLimit.ts` itself needed), `AppError`/error-handler plumbing, and the dummy-hash timing-safety pattern (`getDummyHash`, `DUMMY_PASSWORD_FOR_TIMING`) this ticket reuses verbatim in `resetPassword`.
- No dependency on any note/tag/search/share/version ticket (AB-1004+).

## Risk Areas

1. **Atomicity of "invalidate prior OTPs then create new one"** — must run as a single `prisma.$transaction([updateMany(...), create(...)])` so a concurrent forgot-password request (e.g., a double-submit) can't race and leave two valid OTPs. Covered by a real-Postgres integration test (mocked Prisma can assert call shape but not true atomicity).
2. **Atomicity of attempt-decrement under concurrent guesses** — verifying the OTP and decrementing `attemptsLeft`/setting `invalidated` must happen inside a single `prisma.$transaction`, mirroring `refreshSession`'s reuse-detection pattern, so two parallel wrong guesses can't each read `attemptsLeft: 1` and both "successfully" decrement past 0. Covered by an integration test issuing concurrent wrong-OTP requests.
3. **All-device revocation correctness** — `resetPassword` must revoke every `RefreshToken` row for the `userId` (all `familyId`s), not just one family. A regression here (e.g., accidentally scoping by `familyId`) would silently leave other devices logged in after a password reset, undermining FR-AUTH-6. Covered by an integration test with two independent login sessions (two families) for the same user.
4. **Timing side-channel on `resetPassword`'s unknown-email path** — same class of risk as AB-1002's login timing issue; must call `bcrypt.compare` against the cached dummy hash even when no user is found, or response time will leak account existence. Reuses the already-established mitigation from `auth.service.ts` — low incremental risk since the helper already exists, but easy to accidentally skip if the unknown-email branch is written as an early return.
5. **Rate-limiter key collision on `keyGenerator`** — `express-rate-limit` calls `keyGenerator` before body validation in some middleware orderings; if `req.body.email` is missing/malformed, the fallback (`?? req.ip`) must not throw and must not silently bucket all malformed requests together in a way that lets an attacker bypass the per-email limit by omitting the email field. Mitigate by placing the rate limiter *after* Express's JSON body-parser (already true — body parsing is global middleware ahead of routes per `app.ts`) but *before* Zod validation in the controller, and verifying the fallback path with a dedicated test (malformed-body request still gets IP-bucketed, not unlimited).
6. **`BCRYPT_ROUNDS` cost applied to OTP hashing too** — hashing a 6-digit OTP with the same 12-round cost as a password is intentional (spec.md explicitly reuses `BCRYPT_ROUNDS`) but doubles bcrypt calls per reset-password request (compare newPassword's future hash is separate from OTP compare). Acceptable per spec; flagged here only so the integration test suite's timing/perf expectations account for two bcrypt operations per request, not one.

## Test Strategy

Unit tests (Vitest, Prisma mocked or no DB dependency) — colocated with source per existing convention:

| Scenario (spec.md) | Test file |
|---|---|
| OTP generation: always 6 digits, numeric charset, leading zeros preserved | `apps/api/src/lib/otp.test.ts` |
| `forgotPasswordSchema`/`resetPasswordSchema` shape validation | `packages/shared/src/schemas.test.ts` |
| #1/#2 `forgotPassword` service branch (known vs. unknown email, same generic return; dummy path for unknown) | `apps/api/src/services/auth.service.test.ts` |
| #3 `forgotPassword` invalidates prior OTPs (call-shape assertion on mocked Prisma) | same file |
| #5–#9 `resetPassword` service branches (correct OTP, wrong newPassword, wrong OTP decrements, 5th attempt invalidates, expired OTP) | same file |
| #10 `resetPassword` unknown email hits dummy-compare path | same file |
| #11 `resetPassword` revokes all `RefreshToken` rows for `userId` (call-shape: `updateMany` keyed by `userId` only, not `familyId`) | same file |
| Controller request/response shaping for both new handlers | `apps/api/src/controllers/auth.controller.test.ts` |

Integration tests (Vitest + Supertest, real `notes_test` via `TEST_DATABASE_URL`, truncated between files):

| Scenario (spec.md) | Test file |
|---|---|
| #1 Forgot-password for registered email → 200 generic message, OTP row persisted (`attemptsLeft: 5`, `invalidated: false`, `expiresAt` ~15 min out) | `apps/api/src/routes/auth.integration.test.ts` |
| #2 Forgot-password for unregistered email → identical 200, no OTP row created | same file |
| #3 Forgot-password requested twice → first OTP row `invalidated: true`, only newest usable (proves real-DB atomicity — risk #1) | same file |
| #4 Forgot-password rate limit (>3/hr same email) → 429; different email from same IP unaffected (proves email-keyed limiter, not IP-keyed) | same file |
| #5 Reset-password correct OTP + valid password → 204, password updated, OTP invalidated, all refresh tokens revoked | same file |
| #6 Reset-password correct OTP + weak password → 400, OTP not consumed (retry with valid password succeeds) | same file |
| #7 Reset-password wrong OTP (1st–4th attempt) → 401, `attemptsLeft` decremented, still usable | same file |
| #8 Reset-password wrong OTP on 5th attempt → 401, OTP invalidated; subsequent correct-code attempt against same row also 401 (proves atomic attempt-cap — risk #2) | same file |
| #9 Reset-password after 15-min expiry → 401 even with correct code | same file |
| #10 Reset-password unknown email → 401, indistinguishable from wrong-OTP response | same file |
| #11 Reset-password with two active device sessions (two families) → both revoked, both subsequent `/auth/refresh` calls return 401 (proves all-device revocation — risk #3) | same file |

No frontend or E2E test files touched in this ticket (AB-1010/AB-1016 own those).

## Open Questions

None.
