---
ticket: AB-1007
status: APPROVED
---

# AB-1007: Search Architecture — Tasks

Ordered so each task leaves the repo in a typecheck/test-passing state before the next begins. Tasks within the same numbered group that are marked `[PARALLEL]` have no dependency on each other and may be done in either order (or concurrently) as long as their own prerequisites are already complete.

## Group 1 — Shared Contracts (`packages/shared`)

- [x] **1.1** Add `searchQuerySchema = paginationQuerySchema.extend({ q: z.string().trim().min(1, 'Search query is required') })`. Export inferred type `SearchQuery`.
  Files: `packages/shared/src/schemas.ts`
  Est: 10 min · `[PARALLEL]`
  Satisfies: enables scenarios 8, 9, 10, 11 (validation rules only; behavior verified downstream).

- [x] **1.2** Add `SearchResultItem { note: Note; headline: string }` interface, reusing the existing `Note` and `Page<T>` types.
  Files: `packages/shared/src/types.ts`
  Est: 5 min · `[PARALLEL]` (independent of 1.1)
  Satisfies: enables scenarios 1, 2, 12 (response-shape typing).

- [x] **1.3** Unit tests for `searchQuerySchema`: valid `q`, missing `q`, empty string, whitespace-only string, `q` combined with `page`/`pageSize` overrides, default `page`/`pageSize` when omitted.
  Files: `packages/shared/src/schemas.test.ts`
  Depends on: 1.1
  Est: 20 min
  Satisfies: scenarios 8, 9, 10, 11 (schema-level).

## Group 2 — Database Schema

- [x] **2.1** Add a comment on the `Note` model in `schema.prisma` documenting that `searchVector` exists at the database level only (mirrors the existing `Tag` case-insensitive-index comment) — no field/model change.
  Files: `apps/api/prisma/schema.prisma`
  Est: 5 min · `[PARALLEL]` (independent of Group 1)

- [x] **2.2** Hand-write the `--create-only` raw SQL migration: `ALTER TABLE "Note" ADD COLUMN "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce("bodyText",''))) STORED;` plus `CREATE INDEX "note_search_idx" ON "Note" USING GIN ("searchVector");`. Apply to both `notes_dev` and `notes_test`.
  Files: `apps/api/prisma/migrations/<ts>_note_search_vector/migration.sql`
  Depends on: 2.1
  Est: 15 min
  Satisfies: enables scenario 14 (column/index exist); underlies every other scenario.

## Group 3 — Search Vertical Slice (`/search`)

- [x] **3.1** Export `toNoteResponse` (currently private) and its `PrismaNote` type alias from `notes.controller.ts`, for reuse by `search.controller.ts`. No behavior change to any existing route handler.
  Files: `apps/api/src/controllers/notes.controller.ts`
  Est: 5 min · `[PARALLEL]` (independent of 3.2)

- [x] **3.2** `search.service.ts`: `searchNotes(prisma, userId, query)` — parameterized raw query (`Prisma.sql`/`$queryRaw`, never string concatenation) for matching IDs + `ts_headline` + `ts_rank`, a second raw `count(*)` query for `totalItems`, then `prisma.note.findMany({ where: { id: { in } }, include: TAGS_INCLUDE })` re-fetch, re-sorted in application code to match the rank order (since `findMany` does not preserve `id: { in }` order).
  Files: `apps/api/src/services/search.service.ts`
  Depends on: 1.1, 1.2, 2.2
  Est: 45 min · `[SUBAGENT]` (two raw queries + re-fetch + rank-order reassembly — most complex file in the ticket)
  Satisfies: scenarios 1, 2, 3, 4, 5, 6, 7, 12, 15.

- [x] **3.3** Unit tests for `search.service.ts` (Prisma mocked: `$queryRaw`, `note.findMany`): pagination math, rank-order reassembly against out-of-order mock results, empty-result handling, and a regression check that the raw query is invoked with a `Prisma.sql` tagged-template value (not a plain string).
  Files: `apps/api/src/services/search.service.test.ts`
  Depends on: 3.2
  Est: 30 min · `[PARALLEL]` (independent of 3.4/3.5)

- [x] **3.4** `search.controller.ts`: `searchQuerySchema.parse(req.query)` → `searchNotes(...)` → map each item to `{ note: toNoteResponse(item.note), headline: item.headline }` → `200` JSON.
  Files: `apps/api/src/controllers/search.controller.ts`
  Depends on: 3.1, 3.2
  Est: 20 min

- [x] **3.5** Unit tests for `search.controller.ts`: validation-error passthrough (missing/empty `q` → `next(ZodError)`), successful mapping of a service result to the response shape.
  Files: `apps/api/src/controllers/search.controller.test.ts`
  Depends on: 3.4
  Est: 25 min · `[PARALLEL]` (independent of 3.3)

- [x] **3.6** `search.router.ts`: mount `requireAuth`, wire `GET /` to the controller. Mount the new router at `/search` in the top-level router.
  Files: `apps/api/src/routes/search.router.ts`, `apps/api/src/routes/index.ts`
  Depends on: 3.4
  Est: 10 min

- [x] **3.7** Integration tests against `notes_test` (Supertest) — the only tier that proves real Postgres `tsvector`/GIN/`plainto_tsquery`/`ts_rank`/`ts_headline` behavior: title-only and body-only matches with `<mark>`-wrapped headline (1, 2), multi-word phrase (3), scoping excludes another user's note and the caller's own trashed note (4, 5), no-match empty page (6), relevance ordering between a strong and weak match (7), tag association on results (12), missing/invalid token → `401` (13), migration artifacts implicitly proven by every query succeeding (14), `searchVector` auto-recompute after a real `/notes` update (15).
  Files: `apps/api/src/routes/search.integration.test.ts`
  Depends on: 3.6, 2.2
  Est: 50 min · `[SUBAGENT]` (covers 11 distinct scenarios against a real database)

## Group 4 — Final Quality Gate

- [x] **4.1** Run `pnpm build`, `pnpm lint --max-warnings 0`, `pnpm test` at the repo root; confirm ≥80% coverage on every new/modified file (AGENTS.md §10); fix any failures before requesting review.
  Files: none (verification only)
  Depends on: all of Group 1–3
  Est: 15 min
