---
ticket: AB-1008
status: APPROVED
---

# AB-1008: Sharing Architecture — Tasks

## `packages/shared` (do first — everything else imports from here)

- [x] **T1.** Add `SHARE_NOT_FOUND` and `GONE_LINK_INVALID` to `packages/shared/src/errorCodes.ts`. *(5 min)* [PARALLEL]
  Files: `packages/shared/src/errorCodes.ts`
  Scenarios: enables error responses for 3, 4, 5, 6, 9, 12, 13, 14, 18

- [x] **T2.** Add `createShareLinkSchema` (`expiresAt` optional ISO datetime, format-only) + `CreateShareLinkInput` type to `packages/shared/src/schemas.ts`. *(10 min)* [PARALLEL]
  Files: `packages/shared/src/schemas.ts`
  Scenarios: 3 (malformed-format branch), 4 (format branch)

- [x] **T3.** Unit tests for `createShareLinkSchema`: valid ISO datetime, omitted `expiresAt`, malformed string. *(15 min)*
  Files: `packages/shared/src/schemas.test.ts`
  Depends on: T2
  Scenarios: 3, 4

- [x] **T4.** Add `CreatedShareLink`, `ShareLink`, `PublicShareView` interfaces to `packages/shared/src/types.ts`. *(10 min)* [PARALLEL]
  Files: `packages/shared/src/types.ts`
  Scenarios: enables response shapes for 1, 2, 10, 16

## `apps/api/prisma` (do second — services need the generated client)

- [x] **T5.** Add `model ShareLink` + `Note.shares` back-relation to `apps/api/prisma/schema.prisma`. *(10 min)* [PARALLEL]
  Files: `apps/api/prisma/schema.prisma`
  Scenarios: enables all (new table)

- [x] **T6.** Generate and apply the migration (`prisma migrate dev --name share_links`) against both `notes_dev` (`DATABASE_URL`) and `notes_test` (`TEST_DATABASE_URL`); verify `prisma migrate status` reports no drift. *(15 min)*
  Files: `apps/api/prisma/migrations/20260712182721_share_links/migration.sql`
  Depends on: T5
  Scenarios: enables all

  **Incident + remediation:** the initial `prisma migrate dev` run auto-generated a destructive side effect — it proposed and applied `DROP INDEX "note_search_idx"` + `ALTER TABLE "Note" DROP COLUMN "searchVector"` alongside the intended `ShareLink` DDL, because AB-1007's raw-SQL `searchVector` tsvector column wasn't declared in `schema.prisma` and was misread as drift (a risk AB-1007's own plan.md had flagged but not yet guarded against). This was caught before moving on to T7: `searchVector`/`note_search_idx` were restored via raw SQL on both `notes_dev` and `notes_test`; `migration.sql` was edited to remove the erroneous drop statements (kept only the `ShareLink` table/index/FK creation); the corrected file's sha256 checksum was manually written into both databases' `_prisma_migrations` tables (a raw, out-of-band edit to Prisma's own ledger — reviewer-flagged as process-risky, accepted here since this branch is unpushed/solo/no-CI); `searchVector Unsupported("tsvector")?` was added to the `Note` model in `schema.prisma` so future migrations can no longer misdiagnose this column as drift. Verified: `prisma migrate status` reports no drift on both databases; full `pnpm test` (429/429, 26 files) passes, including all 15 `search.integration.test.ts` scenarios.

## `apps/api/src/lib`

- [x] **T7.** Add `generateShareToken()` (`randomBytes(24).base64url`) to `apps/api/src/lib/shareToken.ts`. *(10 min)* [PARALLEL]
  Files: `apps/api/src/lib/shareToken.ts`

- [x] **T8.** Unit tests: token length/charset, uniqueness across calls. *(10 min)*
  Files: `apps/api/src/lib/shareToken.test.ts`
  Depends on: T7

## `apps/api/src/services`

- [x] **T9.** Implement `shares.service.ts`: `createShareLink`, `revokeShareLink`, `listShareLinks`, `viewPublicShare` (atomic raw-SQL increment). *(40 min)*
  Files: `apps/api/src/services/shares.service.ts`
  Depends on: T1, T2, T4, T6, T7
  Scenarios: 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16, 17, 18

- [x] **T10.** Unit tests for `shares.service.ts`: `expiresAt` boundary cases (exactly now, exactly +30d, +30d+1ms), default-7-day computation, active-vs-any-state ownership branching (create vs. list/revoke), idempotent re-revoke, `Prisma.sql` usage guard on the raw view query, no-row → `410` branch. *(40 min)*
  Files: `apps/api/src/services/shares.service.test.ts`
  Depends on: T9
  Scenarios: 1, 2, 3, 4, 5, 6, 8, 9, 12, 13, 14, 16, 17, 18

## `apps/api/src/controllers`

- [x] **T11.** Implement `shares.controller.ts` (`createSharesController(env)`: `create`, `list`, `revoke`), building `shareUrl` from `env.WEB_ORIGIN`. *(25 min)*
  Files: `apps/api/src/controllers/shares.controller.ts`
  Depends on: T9, T2, T4
  Scenarios: 1, 2, 3, 4, 5, 6, 8, 9, 16, 17, 18

- [x] **T12.** Unit tests for `shares.controller.ts`: validation passthrough, `shareUrl` construction from injected `WEB_ORIGIN`, status codes per action. *(25 min)*
  Files: `apps/api/src/controllers/shares.controller.test.ts`
  Depends on: T11

- [x] **T13.** Implement `public.controller.ts` (`createPublicController()`: `view`), mapping to `PublicShareView`. *(15 min)* [PARALLEL]
  Files: `apps/api/src/controllers/public.controller.ts`
  Depends on: T9, T4
  Scenarios: 10, 12, 13, 14, 15

- [x] **T14.** Unit tests for `public.controller.ts`: `410` passthrough, success-path response mapping. *(15 min)*
  Files: `apps/api/src/controllers/public.controller.test.ts`
  Depends on: T13

## `apps/api/src/routes`

- [x] **T15.** Implement `shares.router.ts` (`Router({ mergeParams: true })`, `POST /`, `GET /`, `DELETE /:token` — no `requireAuth` call, inherited from parent). *(15 min)*
  Files: `apps/api/src/routes/shares.router.ts`
  Depends on: T11

- [x] **T16.** Modify `notes.router.ts`: widen `NotesRouterEnv` to include `WEB_ORIGIN`, mount `router.use('/:id/shares', createSharesRouter(env))`. *(10 min)*
  Files: `apps/api/src/routes/notes.router.ts`, `apps/api/src/routes/index.ts` (widened `RouterEnv` type as a compile-only prerequisite for T18)
  Depends on: T15

  Verified manually (throwaway test, not committed): auth inheritance from the parent mount works correctly — missing/garbage token → 401, valid auth + nonexistent note → 404 (not a 500 from undefined `req.userId`). Permanent auth-guard coverage for `/notes/:id/shares` is deferred to T19's `shares.integration.test.ts`, per this codebase's one-comprehensive-integration-file-per-router convention (no standalone smoke-test files elsewhere in the repo).

- [x] **T17.** Implement `public.router.ts` (no auth; `createRateLimiter` with `ipKeyGenerator`+token `keyGenerator`, 60/min; `GET /:token`). *(20 min)* [PARALLEL]
  Files: `apps/api/src/routes/public.router.ts`
  Depends on: T13
  Scenarios: 19

- [x] **T18.** Modify `routes/index.ts`: widen `createRouter`'s env param type to include `WEB_ORIGIN`, mount `router.use('/public/shares', createPublicRouter())`. *(10 min)*
  Files: `apps/api/src/routes/index.ts`
  Depends on: T16, T17

- [x] **T19.** Integration tests for owner-facing endpoints against real `notes_test` Postgres: create (incl. expiresAt validation, ownership, soft-delete), list (incl. trash-state, revoked links included), revoke (incl. idempotency, wrong-token 404), auth-required. *(40 min)*
  Files: `apps/api/src/routes/shares.integration.test.ts`
  Depends on: T18
  Scenarios: 1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 20

- [x] **T20.** Integration tests for the public endpoint against real `notes_test` Postgres: valid view + increment, concurrent-views atomicity, expired/revoked/soft-deleted-note `410`, restore-then-view, rate limit. *(40 min)*
  Files: `apps/api/src/routes/public.integration.test.ts`
  Depends on: T18, T19 (reuses share links created via the owner-facing routes exercised in T19)
  Scenarios: 7, 10, 11, 12, 13, 14, 15, 19

## Final Gate

- [x] **T21.** Run `pnpm build`, `pnpm lint --max-warnings 0`, `pnpm test` at the repo root; confirm ≥80% coverage on all new files and zero warnings before marking the ticket ready for `/review`. *(15 min)*
  Depends on: T1–T20

  Verified: `pnpm build` — 0 errors (both apps/api and apps/web). `pnpm lint --max-warnings 0` — clean. `pnpm test` — 484/484 passed across 32 files (packages/shared, apps/api, apps/web). Coverage (`vitest run --coverage` in apps/api): every new AB-1008 file at 100% statements/branches/functions (`shares.service.ts`, `shares.controller.ts`, `public.controller.ts`, `shareToken.ts`, `shares.router.ts`, `public.router.ts`); modified files `notes.router.ts` 100%, `routes/index.ts` 80% (gap is in the pre-existing 404 catch-all handler, not new code).
