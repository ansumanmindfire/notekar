---
ticket: AB-1002
status: APPROVED
---

# AB-1002: Core User & Auth Models — Tasks

Each task is independently testable at the point it's checked off (build/typecheck at minimum; tests where noted). Ordering follows the dependency chain: shared contracts → Prisma → low-level lib → middleware → service → controller → router → integration tests → gates.

## Shared Package (contract layer)

- [x] **1. Add pinned auth deps to `apps/api/package.json`** — `jsonwebtoken@9.0.3`, `bcrypt@6.0.0`, `@types/jsonwebtoken@9.0.10` (dev), `@types/bcrypt@6.0.0` (dev); run `pnpm install`. *(5 min)* [PARALLEL]
  Files: `apps/api/package.json`, `pnpm-lock.yaml`

- [x] **2. `packages/shared/src/errorCodes.ts`** — replace stub with `VALIDATION_FAILED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_INVALID`, `AUTH_REFRESH_INVALID`, `USER_EXISTS`, `RATE_LIMITED`. *(10 min)* [PARALLEL]
  Files: `packages/shared/src/errorCodes.ts`

- [x] **3. `packages/shared/src/schemas.ts`** — add `registerSchema`, `loginSchema` (email format, password 8–72 chars + upper/lower/number regex). *(15 min)* [PARALLEL]
  Files: `packages/shared/src/schemas.ts`

- [x] **4. `packages/shared/src/types.ts`** — add `AuthUser`, `RegisterResponse`, `LoginResponse`, `RefreshResponse`. *(10 min)* [PARALLEL]
  Files: `packages/shared/src/types.ts`

- [x] **5. `packages/shared/src/schemas.test.ts`** — unit tests: password complexity/length, email format rejection. Satisfies scenario #3. *(15 min)*
  Depends on: 3. Files: `packages/shared/src/schemas.test.ts`

## Prisma / Database

- [x] **6. Add `User` + `RefreshToken` models to `apps/api/prisma/schema.prisma`** per plan.md §Data Model. *(15 min)*
  Files: `apps/api/prisma/schema.prisma`

- [x] **7. Generate + apply migration `auth_core`** — `pnpm --filter api run prisma:migrate --name auth_core` against `notes_dev`; re-apply the same migration against `notes_test` (`TEST_DATABASE_URL`) per SDS §2.2. Verify both databases have matching schema. *(20 min)*
  Depends on: 6. Files: `apps/api/prisma/migrations/<ts>_auth_core/migration.sql`

## Backend Lib (pure, unit-testable, no Express/Prisma coupling)

- [x] **8. `apps/api/src/lib/jwt.ts`** — `signAccessToken`, `verifyAccessToken` (HS256, `{sub,iat,exp}`, 15 min TTL). *(20 min)* [PARALLEL]
  Files: `apps/api/src/lib/jwt.ts`

- [x] **9. `apps/api/src/lib/jwt.test.ts`** — sign/verify round-trip, expired-token rejection, tampered-signature rejection. Contributes to scenario #13. *(15 min)*
  Depends on: 8. Files: `apps/api/src/lib/jwt.test.ts`

- [x] **10. `apps/api/src/lib/refreshToken.ts`** — `generateOpaqueToken` (64-char), `hashToken` (SHA-256 hex). *(15 min)* [PARALLEL]
  Files: `apps/api/src/lib/refreshToken.ts`

- [x] **11. `apps/api/src/lib/refreshToken.test.ts`** — token length/charset, hash determinism, distinct tokens don't collide. *(15 min)*
  Depends on: 10. Files: `apps/api/src/lib/refreshToken.test.ts`

- [x] **12. `apps/api/src/lib/cookie.ts`** — `setRefreshCookie`/`clearRefreshCookie` (httpOnly, SameSite=Strict, Secure non-dev, Path=/auth). *(15 min)* [PARALLEL]
  Files: `apps/api/src/lib/cookie.ts`

- [x] **13. `apps/api/src/types/express.d.ts`** — extend `Request` with `userId?: string`. *(5 min)* [PARALLEL]
  Files: `apps/api/src/types/express.d.ts`

## Middleware

- [x] **14. `apps/api/src/middleware/auth.ts`** — `requireAuth`: verifies Bearer token via `jwt.ts`, sets `req.userId`, else `next(AppError(401, AUTH_TOKEN_INVALID))`. *(20 min)*
  Depends on: 8, 13. Files: `apps/api/src/middleware/auth.ts`

- [x] **15. `apps/api/src/middleware/auth.test.ts`** — valid token, missing header, malformed header, expired token all covered. Satisfies scenario #13. *(20 min)*
  Depends on: 14. Files: `apps/api/src/middleware/auth.test.ts`

## Service Layer

- [x] **16. `apps/api/src/services/auth.service.ts`** — `registerUser`, `loginUser`, `refreshSession`, `logoutUser`. Email lowercasing (single choke point), bcrypt hash/compare (dummy-hash timing mitigation on unknown email), refresh rotation + atomic family revocation on reuse, idempotent logout. *(45 min)* [SUBAGENT]
  Depends on: 2, 6, 7, 8, 10. Files: `apps/api/src/services/auth.service.ts`

- [x] **17. `apps/api/src/services/auth.service.test.ts`** — unit tests with mocked Prisma: registration hashing call shape, duplicate-email branch throws `USER_EXISTS`, login wrong-password/unknown-email both throw identical `AUTH_INVALID_CREDENTIALS`, refresh-reuse triggers family-wide `updateMany`, logout revokes only the target token. *(30 min)*
  Depends on: 16. Files: `apps/api/src/services/auth.service.test.ts`

## Controller / Route Wiring

- [x] **18. `apps/api/src/controllers/auth.controller.ts`** — `register`, `login`, `refresh`, `logout` handlers: parse body with shared schemas, call service, set/clear cookie, shape response. *(30 min)*
  Depends on: 3, 12, 16. Files: `apps/api/src/controllers/auth.controller.ts`

- [x] **19. `apps/api/src/routes/auth.router.ts`** — mount 4 routes, each behind its own `createRateLimiter` config (3/hr, 5/min, 20/min, 20/min per SDS §17). *(15 min)*
  Depends on: 18. Files: `apps/api/src/routes/auth.router.ts`

- [x] **20. Modify `apps/api/src/routes/index.ts`** — mount `authRouter` at `/auth` before the catch-all 404. *(10 min)*
  Depends on: 19. Files: `apps/api/src/routes/index.ts`

## Integration Tests (real `notes_test` DB)

- [x] **21. `apps/api/src/routes/auth.integration.test.ts`** — Supertest against the real test DB, truncated between files. Covers scenarios #1–#12: register success/duplicate-case/rate-limit, login success/generic-failure/rate-limit, refresh success/reuse-revokes-family/expired-missing, logout per-device/idempotent. *(60 min)* [SUBAGENT]
  Depends on: 7, 20. Files: `apps/api/src/routes/auth.integration.test.ts`

## Quality Gates

- [x] **22. Run `pnpm build && pnpm lint --max-warnings 0 && pnpm test`** across the workspace; fix any typecheck/lint/coverage gaps until all green (≥80% coverage on new code). *(15 min)*
  Depends on: all above. Files: none (verification only)

- [x] **23. Update `.env.example` comments if needed and confirm Husky pre-commit passes silently** (`npx commitlint --from HEAD~1` dry-run acceptable before actual commit). *(10 min)*
  Depends on: 22. Files: `.env.example` (only if a comment/clarity fix is needed — no new variables required)
