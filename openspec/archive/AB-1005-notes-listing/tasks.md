---
ticket: AB-1005
status: APPROVED
---

# AB-1005: Notes List & Filtering — Task Breakdown

Ordered so each task is independently testable once its stated dependencies are done. `[PARALLEL]` = no dependency on any sibling task also tagged `[PARALLEL]` in the same phase. `[SUBAGENT]` = estimated >45 min, suitable for delegation.

## Phase 0 — Shared Contract (`packages/shared`)

- [x] **T1. Add `noteSortSchema` and `listNotesQuerySchema`** `[PARALLEL]` (15 min)
  Files: `packages/shared/src/schemas.ts`
  Add `noteSortSchema = z.enum(['createdAt:asc', 'createdAt:desc', 'updatedAt:asc', 'updatedAt:desc']).default('createdAt:desc')` and `listNotesQuerySchema = paginationQuerySchema.extend({ sort: noteSortSchema })`. Export inferred `NoteSort`/`ListNotesQuery` types. `paginationQuerySchema` itself stays unmodified.
  Scenarios: 1, 2, 3, 4, 5 (schema-level validation).

- [x] **T2. Unit-test the new schemas** (15 min) — depends on T1
  Files: `packages/shared/src/schemas.test.ts`
  Cover: each of the 4 valid `sort` values parses through unchanged; missing `sort` defaults to `createdAt:desc`; an out-of-enum value (e.g. `title:desc`) throws `ZodError`.
  Scenarios: 1, 5.

## Phase 1 — Prisma Schema & Migration

- [x] **T3. Add `@@index([userId, updatedAt])` to `Note`** `[PARALLEL]` (5 min)
  Files: `apps/api/prisma/schema.prisma`
  Add the index deliberately deferred by AB-1004. No other model changes.
  Scenarios: 9 (foundation for `updatedAt` sort correctness at scale).

- [x] **T4. Run and apply the migration (dual database)** — depends on T3. **Requires user `[y/n]` confirmation (CLAUDE.md: DB migrations always ask).** (15 min)
  Files: `apps/api/prisma/migrations/<timestamp>_note_updated_at_index/migration.sql` (generated)
  Run `pnpm --filter api run prisma:migrate` against `notes_dev`, then re-run with `DATABASE_URL` swapped to `TEST_DATABASE_URL` to apply the same migration to `notes_test` (SDS §2.2/§18 dual-apply convention).
  Scenarios: 9.

## Phase 2 — Service Layer

- [x] **T5. Extend `listNotes` with sort support** (25 min) — depends on T1
  Files: `apps/api/src/services/notes.service.ts`
  Change `listNotes`'s second parameter to `ListNotesQuery`. Add a module-level typed lookup `SORT_ORDER_BY: Record<NoteSort, Prisma.NoteOrderByWithRelationInput>` mapping each enum value to its `orderBy` object; replace the hardcoded `orderBy: { createdAt: 'desc' }` with `SORT_ORDER_BY[sort]`. `listTrash` untouched.
  Scenarios: 1, 2, 3, 4, 7.

- [x] **T6. Unit-test `listNotes` sort behavior** (25 min) — depends on T5
  Files: `apps/api/src/services/notes.service.test.ts`
  One case per sort value asserting the correct `orderBy` object reaches `prisma.note.findMany`; one case confirming the default (`createdAt:desc`) matches the existing assertion. `listTrash` tests unchanged.
  Scenarios: 1, 2, 3, 4.

## Phase 3 — Controller

- [x] **T7. Wire `listNotesQuerySchema` into the `list` handler** (15 min) — depends on T1, T5
  Files: `apps/api/src/controllers/notes.controller.ts`
  Replace `paginationQuerySchema.parse(req.query)` with `listNotesQuerySchema.parse(req.query)` in the `list` method only. `listTrash` handler untouched — keeps `paginationQuerySchema`.
  Scenarios: 1, 2, 3, 4, 5, 6.

- [x] **T8. Unit-test controller `list` sort passthrough** (20 min) — depends on T7
  Files: `apps/api/src/controllers/notes.controller.test.ts`
  `sort=updatedAt:asc` passes `{ page, pageSize, sort: 'updatedAt:asc' }` through to `mockService.listNotes`; an invalid `sort` value → `next(ZodError)`, no service call — mirrors the existing invalid-body pattern for `create`/`update`.
  Scenarios: 2, 5.

## Phase 4 — Integration Tests

- [x] **T9. Extend `GET /notes` and `GET /notes/trash` integration tests** `[SUBAGENT]` (50 min) — depends on T4, T7
  Files: `apps/api/src/routes/notes.integration.test.ts`
  Extend `describe('GET /notes')`: seed notes with distinct `createdAt`, then `PATCH` an older one to diverge its `updatedAt` before asserting `updatedAt:asc`/`updatedAt:desc` order (a same-timestamp seed would pass even with a broken `updatedAt` sort — plan.md Risk Area 5); assert `createdAt:asc`/`createdAt:desc`; invalid `sort` → `400 VALIDATION_FAILED`; `tagIds` present → `200`, ignored; `sort` + pagination composed across two pages. Extend `describe('GET /notes/trash')`: a stray `sort` query param has no effect, order stays `deletedAt desc`.
  Scenarios: 1, 2, 3, 4, 5, 6, 7, 8.

## Phase 5 — Quality Gates

- [x] **T10. Run full quality gate** (15 min) — depends on all prior tasks
  `pnpm build` (0 errors), `pnpm lint --max-warnings 0`, `pnpm test` (all green, ≥80% coverage on new/changed code per AGENTS.md §6/§10). Fix any failures before considering the ticket implementation-complete.
