---
ticket: AB-1004
status: APPROVED
---

# AB-1004: Core Note Models — Task Breakdown

Ordered so each task is independently testable once its stated dependencies are done. `[PARALLEL]` = no dependency on any sibling task also tagged `[PARALLEL]` in the same phase. `[SUBAGENT]` = estimated >45 min, suitable for delegation.

## Phase 0 — Shared Contract (`packages/shared`)

- [x] **T1. Add `NOTE_NOT_FOUND` error code** `[PARALLEL]` (5 min)
  Files: `packages/shared/src/errorCodes.ts`
  Add `NOTE_NOT_FOUND: 'NOTE_NOT_FOUND'` to `ErrorCodes`.
  Scenarios: 4, 5, 7, 9, 13 (all 404 paths).

- [x] **T2. Add `Note` type** `[PARALLEL]` (10 min)
  Files: `packages/shared/src/types.ts`
  Add `Note` interface (`id, title, body, version, createdAt, updatedAt, deletedAt`). Reuse existing generic `Page<T>` for list responses (no new `NotePage` alias — plan.md Risk Area 6).
  Scenarios: 1, 3, 6, 10, 11, 12.

- [x] **T3. Add note Zod schemas** `[PARALLEL]` (20 min)
  Files: `packages/shared/src/schemas.ts`
  Add `createNoteSchema` (title 1–200 chars, body as object), `updateNoteSchema` (both optional + `.refine` requiring ≥1 field), `paginationQuerySchema` (`page`/`pageSize` coerced, defaults 1/10, `pageSize` capped at 50). Export inferred `CreateNoteInput`/`UpdateNoteInput`/`PaginationQuery` types.
  Scenarios: 2 (validation).

- [x] **T4. Unit-test the new schemas** (20 min) — depends on T3
  Files: `packages/shared/src/schemas.test.ts`
  Cover: title length bounds (0, 1, 200, 201 chars), missing/malformed body, `updateNoteSchema` with zero fields (rejected), pagination default/coercion/`pageSize` cap.
  Scenarios: 2.

## Phase 1 — Prisma Schema & Migration

- [x] **T5. Add `Note`/`NoteVersion` models to Prisma schema** `[PARALLEL]` (15 min)
  Files: `apps/api/prisma/schema.prisma`
  Add both models exactly per `spec.md` §Data Model; add `notes Note[]` to `User`.
  Scenarios: (foundation for all).

- [x] **T6. Run and apply the migration (dual database)** — depends on T5. **Requires user `[y/n]` confirmation (CLAUDE.md: DB migrations always ask).** (15 min)
  Files: `apps/api/prisma/migrations/<timestamp>_notes_core/migration.sql` (generated)
  Run `pnpm --filter api run prisma:migrate` against `notes_dev`, then re-run with `DATABASE_URL` swapped to `TEST_DATABASE_URL` to apply the same migration to `notes_test` (SDS §2.2/§18 dual-apply convention).
  Scenarios: (foundation for all DB-touching tests).

## Phase 2 — TipTap Plain-Text Helper

- [x] **T7. Add `node-cron` dependency** `[PARALLEL]` (5 min)
  Files: `apps/api/package.json`
  Add `"node-cron": "4.6.0"` (exact-pinned per AGENTS.md §3).

- [x] **T8. Create `extractPlainText` helper** `[PARALLEL]` (20 min)
  Files: `apps/api/src/lib/tiptap.ts`
  Walk TipTap JSON `content` tree, concatenate `text` nodes; return `''` on any non-conforming input rather than throwing.

- [x] **T9. Unit-test `extractPlainText`** (15 min) — depends on T8
  Files: `apps/api/src/lib/tiptap.test.ts`
  Cover: empty doc, nested paragraphs/marks, `null`/`[]`/missing-`content`/non-object input.

## Phase 3 — Note Purge Job

- [x] **T10. Create `purgeNotes` + `schedulePurgeNotesJob`** (30 min) — depends on T5, T6, T7
  Files: `apps/api/src/lib/jobs/purgeNotes.ts`
  `purgeNotes(prisma)`: deletes `Note` rows with `deletedAt` >30 days old (cascades to `NoteVersion` via `onDelete: Cascade`), logs count via `logger`. `schedulePurgeNotesJob(env)`: wraps `node-cron` using `env.PURGE_CRON_SCHEDULE`. Not called from `app.ts`.
  Scenarios: 14.

- [x] **T11. Integration-test `purgeNotes`** (30 min) — depends on T10, T6 (test DB migrated)
  Files: `apps/api/src/lib/jobs/purgeNotes.test.ts`
  Seed notes with `deletedAt` at 31 and 29 days ago; assert only the 31-day note (and its `NoteVersion` rows) are purged.
  Scenarios: 13, 14.

## Phase 4 — Service Layer

- [x] **T12. Create `notes.service.ts`** `[SUBAGENT]` (60 min) — depends on T2, T3, T5, T6, T8
  Files: `apps/api/src/services/notes.service.ts`
  Implement `createNote`, `getNote`, `updateNote`, `softDeleteNote`, `listNotes`, `listTrash`, `restoreNote` + a local `paginate()` helper, per plan.md §Data Flow. All ownership-scoped queries; `updateNote` wraps snapshot+update in one `prisma.$transaction`; `softDeleteNote`/`restoreNote` use scoped `updateMany` (race-safe, no TOCTOU gap).
  Scenarios: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13.

- [x] **T13. Unit-test `notes.service.ts`** (40 min) — depends on T12
  Files: `apps/api/src/services/notes.service.test.ts`
  Mocked Prisma client: ownership scoping on every call, version-increment arithmetic, `bodyText` computed pre-Prisma-call, `updateNote`'s transaction shape, `updateMany`-count-based 404 branches.
  Scenarios: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13.

## Phase 5 — Controller & Router

- [x] **T14. Create `notes.controller.ts`** (30 min) — depends on T12, T3
  Files: `apps/api/src/controllers/notes.controller.ts`
  `createNotesController(env)` → `{ create, get, update, remove, list, listTrash, restore }`, mirroring `auth.controller.ts`'s try/catch + `next(err)` structure.

- [x] **T15. Unit-test `notes.controller.ts`** (25 min) — depends on T14
  Files: `apps/api/src/controllers/notes.controller.test.ts`
  Correct status codes and response shaping per method; validation errors thrown as `ZodError` and passed to `next`.

- [x] **T16. Create `notes.router.ts`** (20 min) — depends on T14
  Files: `apps/api/src/routes/notes.router.ts`
  Mount `requireAuth(env.JWT_SECRET)` on all routes; wire `GET /`, `POST /`, `GET /trash`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, `POST /:id/restore`. **`/trash` registered before `/:id`.**
  Scenarios: 15.

- [x] **T17. Mount notes router in `routes/index.ts`** (10 min) — depends on T16
  Files: `apps/api/src/routes/index.ts`
  Add `router.use('/notes', createNotesRouter(env))`; extend the shared router-env type to include `JWT_SECRET` for both auth and notes sub-routers.

## Phase 6 — Integration Tests & Server Wiring

- [x] **T18. Full `/notes` integration test suite** `[SUBAGENT]` (60 min) — depends on T17, T6
  Files: `apps/api/src/routes/notes.integration.test.ts`
  Supertest + real `notes_test` DB. Covers create/read/update/delete, version-snapshot assertion after update, list + trash pagination, restore within window, restore-after-purge (via directly seeding/deleting rows or invoking `purgeNotes`), and 401-without-token on every route. Maps to spec.md Scenarios 1–13, 15.

- [x] **T19. Wire `schedulePurgeNotesJob` into `server.ts`** (10 min) — depends on T10
  Files: `apps/api/src/server.ts`
  Call `schedulePurgeNotesJob(env)` after `app.listen(...)`. Not invoked by `createApp()`, so no test suite triggers a background timer.

## Phase 7 — Quality Gates

- [x] **T20. Run full quality gate** (15 min) — depends on all prior tasks
  `pnpm build` (0 errors), `pnpm lint --max-warnings 0`, `pnpm test` (all green, ≥80% coverage on new files per AGENTS.md §6/§10). Fix any failures before considering the ticket implementation-complete.
