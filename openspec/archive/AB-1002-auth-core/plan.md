---
ticket: AB-1002
status: APPROVED
---

# AB-1002: Core User & Auth Models — Plan

## Files to Create

**`packages/shared/src/`** (contract layer — imported by `apps/api`, never duplicated)
- `errorCodes.ts` — replace the `export {}` stub with: `VALIDATION_FAILED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_INVALID`, `AUTH_REFRESH_INVALID`, `USER_EXISTS`, `RATE_LIMITED` (as a `const` object + derived union type, matching SDS §6 registry style).
- `schemas.ts` — replace the `export {}` stub with `registerSchema` and `loginSchema` (Zod): email (`z.string().email()`, will be `.toLowerCase()`'d at the point of use in the service, not baked into the schema itself so the schema stays a pure shape/format validator), password `z.string().min(8).max(72).regex(...)` enforcing upper+lower+number.
- `types.ts` — add `AuthUser = { id: string; email: string }`, `RegisterResponse = { id: string; email: string; createdAt: string }`, `LoginResponse = { accessToken: string; user: AuthUser }`, `RefreshResponse = { accessToken: string }`.

**`apps/api/prisma/`**
- `schema.prisma` — add `User` and `RefreshToken` models exactly as specified in spec.md §Data Model.
- `migrations/<timestamp>_auth_core/migration.sql` — generated via `prisma migrate dev --name auth_core`, run once against `DATABASE_URL` (dev). Same migration file is then applied to `TEST_DATABASE_URL` per SDS §2.2/§18 (see Test Strategy).

**`apps/api/src/lib/`**
- `jwt.ts` — `signAccessToken(userId: string): string` (HS256, `{ sub, iat, exp }`, 15 min TTL, uses `JWT_SECRET` from `Env`), `verifyAccessToken(token: string): { sub: string }` (throws on invalid/expired).
- `refreshToken.ts` — `generateOpaqueToken(): string` (64-char, `crypto.randomBytes`), `hashToken(raw: string): string` (SHA-256 hex digest). Pure functions, no Prisma import, so they're trivially unit-testable.
- `cookie.ts` — `setRefreshCookie(res, rawToken, expiresAt)` / `clearRefreshCookie(res)`, centralizing the `httpOnly`/`SameSite=Strict`/`Secure`(non-dev)/`Path=/auth` options so they're defined once, not per-controller.

**`apps/api/src/middleware/`**
- `auth.ts` — `requireAuth(req, res, next)`: reads `Authorization: Bearer <token>`, calls `verifyAccessToken`, sets `req.userId = payload.sub`; on any failure calls `next(new AppError(401, 'AUTH_TOKEN_INVALID', 'Invalid or missing access token'))`. Also extend the Express `Request` type (`src/types/express.d.ts`) with `userId?: string`.

**`apps/api/src/services/`**
- `auth.service.ts` — `registerUser`, `loginUser`, `refreshSession`, `logoutUser`. Owns all Prisma calls and business rules (email lowercasing, bcrypt hash/compare, refresh rotation, family revocation on reuse). No Express types imported here — pure service functions taking/returning plain data, per layering rule (services never see `req`/`res`).

**`apps/api/src/controllers/`**
- `auth.controller.ts` — `register`, `login`, `refresh`, `logout` Express handlers. Parses/validates request bodies with the shared Zod schemas, calls the matching service function, shapes the HTTP response (status code, cookie set/clear), delegates errors to `next()`.

**`apps/api/src/routes/`**
- `auth.router.ts` — `POST /register`, `POST /login`, `POST /refresh`, `POST /logout`, each wrapped with its own rate limiter (via existing `createRateLimiter` factory) before the controller. Wiring only — no logic.
- `index.ts` — modify: mount `authRouter` at `/auth` **before** the existing catch-all 404 handler.

## Files to Modify

- `apps/api/prisma/schema.prisma` (add models, see above)
- `packages/shared/src/errorCodes.ts`, `schemas.ts`, `types.ts` (fill in stubs, see above)
- `apps/api/src/routes/index.ts` (mount `/auth`)
- `apps/api/package.json` (new deps, see below)
- `.env.example` / `docs` — no new env vars needed; `JWT_SECRET`, `BCRYPT_ROUNDS` already exist in `env.ts`.

## Prisma Schema Changes

- Additive only: two new models (`User`, `RefreshToken`), zero changes to existing models (none exist yet besides these).
- No physical deletes introduced. `RefreshToken` rows are never deleted by application code — reuse detection and logout both set `revokedAt`, they never call `prisma.refreshToken.delete`. (Physical deletion remains reserved for the two scheduled purge jobs, which don't touch these tables at all.)
- `onDelete: Cascade` is only on `RefreshToken.user → User`, not on any `Note`-adjacent relation (none exists yet) — consistent with AGENTS.md §9's cascade restriction, which specifically targets bypassing `Note` soft-delete.
- Migration is standard Prisma DSL — no raw SQL needed (unlike the two documented exceptions for Tag/search in later tickets).
- Must be applied identically to both `notes_dev` (`DATABASE_URL`) and `notes_test` (`TEST_DATABASE_URL`): run `pnpm --filter api run prisma:migrate` once against dev, then `dotenv -e ../../.env -- prisma migrate deploy` (or a second `migrate dev` invocation) with `DATABASE_URL` temporarily pointed at `TEST_DATABASE_URL` for the test database — per SDS §2.2.

## New Packages (exact pinned versions)

Added to `apps/api/package.json`:
| Package | Version | Why |
|---|---|---|
| `jsonwebtoken` | `9.0.3` | HS256 access token signing/verification (AGENTS.md §7) |
| `bcrypt` | `6.0.0` | Password hashing, 12 rounds (AGENTS.md §7) |
| `@types/jsonwebtoken` (dev) | `9.0.10` | Type defs, strict TS compliance |
| `@types/bcrypt` (dev) | `6.0.0` | Type defs, strict TS compliance |

No new packages needed in `packages/shared` or `apps/web` for this ticket. All versions above are exact (no `^`/`~`), per AGENTS.md §3/§11.

## Dependencies on Prior Tickets

- **AB-1001** (merged): supplies `env.ts` (already validates `JWT_SECRET`, `BCRYPT_ROUNDS`), `AppError`, `errorHandler` (already maps `ZodError`→`VALIDATION_FAILED`, generic `P2002`→`CONFLICT`/`P2025`→`NOT_FOUND` — this ticket's service layer throws specific `AppError`s for `USER_EXISTS`/`AUTH_*` rather than relying on those generic Prisma-error mappings, since the error-code registry requires the specific codes), Prisma singleton, `createRateLimiter` factory, `packages/shared` skeleton, dual-DB test setup.
- No dependency on AB-1003 (forgot-password/OTP is additive later and doesn't touch this ticket's tables or code paths).

## Risk Areas

1. **Refresh-token reuse detection correctness** — the core security property of the whole session model. Must revoke the *entire family* atomically (single `updateMany({ where: { familyId }, data: { revokedAt: now } })` inside the same request as the reuse check) so a race between two reuse attempts can't leave a live token in the family. Covered by a dedicated integration test with real Postgres (unit/mocked Prisma can't prove atomicity).
2. **Email case-insensitivity relies on the app layer, not a DB constraint** — if any future code path writes a `User.email` without lowercasing first (e.g., a bulk import script added later), the uniqueness guarantee silently breaks since Postgres's plain `@unique` is case-sensitive. Mitigate by lowercasing exactly once, centrally, inside `auth.service.ts` (never in the controller or a route), so it's the single choke point.
3. **Timing side-channel on login** — comparing a nonexistent-user path (skip bcrypt) vs. existing-user-wrong-password path (run bcrypt.compare) could leak account existence via response-time differences, undermining the anti-enumeration requirement (FR-AUTH-2). Mitigate by always running `bcrypt.compare` against a precomputed dummy hash when the email isn't found, keeping response time consistent.
4. **Cookie flags in dev vs. prod** — `Secure` must be conditional on `NODE_ENV !== 'development'` (per SDS §5) or local HTTP dev logins will silently fail to persist the cookie. Centralized in `lib/cookie.ts` to avoid drift between login/refresh.
5. **bcrypt rounds performance in tests** — 12 rounds is slow under repeated integration-test runs. SDS/env already exposes `BCRYPT_ROUNDS` as configurable; test env can lower it via `.env` for `TEST_DATABASE_URL`-backed runs without touching production defaults (no spec/behavior change, just faster CI-equivalent local runs).

## Test Strategy

Unit tests (Vitest, Prisma mocked or no DB dependency) — colocated with source per existing convention (`AppError.test.ts` style):

| Scenario (spec.md) | Test file |
|---|---|
| Auth middleware: valid/missing/malformed/expired token (#13) | `apps/api/src/middleware/auth.test.ts` |
| JWT sign/verify round-trip, expiry | `apps/api/src/lib/jwt.test.ts` |
| Opaque token generation (64-char) + SHA-256 hashing | `apps/api/src/lib/refreshToken.test.ts` |
| Password complexity / email format validation (#3) | `packages/shared/src/schemas.test.ts` |
| Service-level logic: hashing called, generic-error branching, family-revocation call shape (Prisma mocked) | `apps/api/src/services/auth.service.test.ts` |

Integration tests (Vitest + Supertest, real `notes_test` via `TEST_DATABASE_URL`, truncated between files):

| Scenario (spec.md) | Test file |
|---|---|
| #1 Register valid → 201, lowercased email, bcrypt hash persisted | `apps/api/src/routes/auth.integration.test.ts` |
| #2 Duplicate email differing only in case → 409 USER_EXISTS | same file |
| #4 Register rate limit → 429 | same file |
| #5 Login valid → 200, cookie flags correct | same file |
| #6 Login wrong password / unknown email → identical 401 | same file |
| #7 Login rate limit → 429 | same file |
| #8 Refresh valid → 200, rotated cookie, same familyId | same file |
| #9 Refresh reuse → family revoked, subsequent refresh fails (proves atomic family revocation — risk #1) | same file |
| #10 Refresh expired/missing cookie → 401 | same file |
| #11 Logout Device A doesn't affect Device B | same file |
| #12 Logout idempotency (called twice) | same file |

No frontend or E2E test files touched in this ticket (AB-1010/AB-1016 own those).

## Open Questions

None.
