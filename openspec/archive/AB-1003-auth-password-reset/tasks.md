---
ticket: AB-1003
status: APPROVED
---

# AB-1003: Forgot Password Flow — Tasks

Each task is independently testable at the point it's checked off (build/typecheck at minimum; tests where noted). Ordering follows the dependency chain: shared contracts → Prisma → lib → service → controller → router → integration tests → gates.

## Shared Package (contract layer)

- [x] **1. `packages/shared/src/errorCodes.ts`** — add `AUTH_OTP_INVALID: 'AUTH_OTP_INVALID'` to the existing `ErrorCodes` const. *(5 min)* [PARALLEL]
  Files: `packages/shared/src/errorCodes.ts`

- [x] **2. `packages/shared/src/schemas.ts`** — export the existing `passwordSchema` constant (currently module-private); add `forgotPasswordSchema` (`{ email }`) and `resetPasswordSchema` (`{ email, otp: /^[0-9]{6}$/, newPassword: passwordSchema }`), plus `ForgotPasswordInput`/`ResetPasswordInput` inferred types. *(15 min)* [PARALLEL]
  Files: `packages/shared/src/schemas.ts`

- [x] **3. `packages/shared/src/types.ts`** — add `ForgotPasswordResponse = { message: string }`. *(5 min)* [PARALLEL]
  Files: `packages/shared/src/types.ts`

- [x] **4. `packages/shared/src/schemas.test.ts`** — unit tests for `forgotPasswordSchema`/`resetPasswordSchema`: valid shapes pass; malformed email, non-6-digit OTP, and weak `newPassword` all rejected. *(20 min)*
  Depends on: 2. Files: `packages/shared/src/schemas.test.ts`

## Prisma / Database

- [x] **5. Add `PasswordResetOtp` model + `User.otps` relation to `apps/api/prisma/schema.prisma`** per plan.md §Prisma Schema Changes. *(15 min)*
  Files: `apps/api/prisma/schema.prisma`

- [x] **6. Generate + apply migration `password_reset_otp`** — `pnpm --filter api run prisma:migrate --name password_reset_otp` against `notes_dev`; re-apply the same migration against `notes_test` (`TEST_DATABASE_URL`) per SDS §2.2. Verify both databases have matching schema. *(20 min)*
  Depends on: 5. Files: `apps/api/prisma/migrations/<ts>_password_reset_otp/migration.sql`

## Backend Lib (pure, unit-testable, no Express/Prisma coupling)

- [x] **7. `apps/api/src/lib/otp.ts`** — `generateOtp(): string` (6-digit numeric, `crypto.randomInt`, zero-padded). *(15 min)* [PARALLEL]
  Files: `apps/api/src/lib/otp.ts`

- [x] **8. `apps/api/src/lib/otp.test.ts`** — output always exactly 6 digits (including leading-zero cases), numeric-only charset, repeated calls vary. *(15 min)*
  Depends on: 7. Files: `apps/api/src/lib/otp.test.ts`

## Service Layer

- [x] **9. `apps/api/src/services/auth.service.ts`** — add `forgotPassword(prisma, input, bcryptRounds)`: lowercases email, looks up user; if found, invalidates prior un-invalidated `PasswordResetOtp` rows and creates a new one inside a single `prisma.$transaction`, logs the raw OTP via `console.info` with `[OTP]` prefix; always resolves the same generic result regardless of whether the user was found. *(30 min)*
  Depends on: 1, 2, 5, 6, 7. Satisfies scenarios: #1, #2, #3. Files: `apps/api/src/services/auth.service.ts`

- [x] **10. `apps/api/src/services/auth.service.ts`** — add `resetPassword(prisma, input, bcryptRounds)`: on unknown email, runs the dummy `bcrypt.compare` (reusing `getDummyHash`/`DUMMY_PASSWORD_FOR_TIMING`) before throwing `AUTH_OTP_INVALID`; on known email, loads the latest non-invalidated OTP row, checks expiry, `bcrypt.compare`s the submitted code, and inside a single `prisma.$transaction` either (a) on match: validates `newPassword` was already Zod-checked by the controller, rehashes and updates `passwordHash`, marks the OTP row `invalidated: true`, and `updateMany`s **all** `RefreshToken` rows for the `userId` (not scoped by `familyId`) to `revokedAt: now`, or (b) on mismatch: decrements `attemptsLeft`, marking `invalidated: true` if it reaches 0 — all cases (unknown email, no active OTP, expired, exhausted, wrong code) throw the identical `401 AUTH_OTP_INVALID`. *(45 min)* [SUBAGENT]
  Depends on: 1, 2, 5, 6, 9. Satisfies scenarios: #5, #6, #7, #8, #9, #10, #11. Files: `apps/api/src/services/auth.service.ts`

- [x] **11. `apps/api/src/services/auth.service.test.ts`** — mocked-Prisma unit tests: `forgotPassword` invalidate-then-create call shape for known user, no-op DB write + same generic return for unknown user; `resetPassword` branches — correct OTP updates password + revokes all tokens (call shape: `updateMany` keyed by `userId` only), wrong `newPassword` shape doesn't touch the OTP row, wrong OTP decrements `attemptsLeft`, 5th wrong attempt sets `invalidated: true`, expired/invalidated OTP rejected, unknown email hits dummy-compare path. *(30 min)*
  Depends on: 9, 10. Satisfies scenarios: #1, #2, #3, #5, #6, #7, #8, #9, #10, #11 (service-level coverage). Files: `apps/api/src/services/auth.service.test.ts`

## Controller / Route Wiring

- [x] **12. `apps/api/src/controllers/auth.controller.ts`** — add `forgotPassword` (parses `forgotPasswordSchema`, calls service, responds `200 { message }`) and `resetPassword` (parses `resetPasswordSchema`, calls service, responds `204`) handlers. *(25 min)*
  Depends on: 2, 3, 9, 10. Files: `apps/api/src/controllers/auth.controller.ts`

- [x] **13. `apps/api/src/controllers/auth.controller.test.ts`** — request/response shaping tests for both new handlers (service mocked): correct status codes, generic message body, error passthrough via `next()`. *(20 min)*
  Depends on: 12. Files: `apps/api/src/controllers/auth.controller.test.ts`

- [x] **14. `apps/api/src/routes/auth.router.ts`** — mount `POST /forgot-password` behind a new email-keyed `createRateLimiter({ windowMs: 60*60*1000, max: 3, keyGenerator })` (fallback to `req.ip` when `email` is missing/malformed) and `POST /reset-password` with no rate limiter. *(20 min)*
  Depends on: 12. Files: `apps/api/src/routes/auth.router.ts`

## Integration Tests (real `notes_test` DB)

- [x] **15. `apps/api/src/routes/auth.integration.test.ts`** — Supertest against the real test DB, truncated between files. Covers scenarios #1–#11 per plan.md §Test Strategy: forgot-password known/unknown email, double-request invalidation, email-keyed rate limit; reset-password success/weak-password/wrong-OTP-decrement/5th-attempt-invalidation/expiry/unknown-email/two-device revocation. *(60 min)* [SUBAGENT]
  Depends on: 6, 14. Satisfies scenarios: #1, #2, #3, #4, #5, #6, #7, #8, #9, #10, #11. Files: `apps/api/src/routes/auth.integration.test.ts`

## Quality Gates

- [x] **16. Run `pnpm build && pnpm lint --max-warnings 0 && pnpm test`** across the workspace; fix any typecheck/lint/coverage gaps until all green (≥80% coverage on new code). *(15 min)*
  Depends on: all above. Files: none (verification only)

- [x] **17. Confirm Husky pre-commit passes silently and `npx commitlint --from HEAD~1` dry-run is compatible** with the intended commit message (`feat(api): ... AB#1003`). *(10 min)*
  Depends on: 16. Files: none (verification only)
