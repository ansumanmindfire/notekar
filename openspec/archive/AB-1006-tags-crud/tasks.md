---
ticket: AB-1006
status: APPROVED
---

# AB-1006: Tags Architecture — Tasks

Ordered so each task leaves the repo in a typecheck/test-passing state before the next begins. Tasks within the same numbered group that are marked `[PARALLEL]` have no dependency on each other and may be done in either order (or concurrently) as long as their own prerequisites are already complete.

## Group 1 — Shared Contracts (`packages/shared`)

- [x] **1.1** Add `TAG_NOT_FOUND`, `TAG_NAME_DUPLICATE`, `INVALID_TAG` to `ErrorCodes`.
  Files: `packages/shared/src/errorCodes.ts`
  Est: 5 min · `[PARALLEL]`
  Satisfies: enables scenarios 2, 8, 9, 11, 13, 15 (error-code plumbing only; behavior verified downstream).

- [x] **1.2** Add `TAG_COLORS` tuple, `tagColorSchema`, `tagNameSchema`, `createTagSchema`, `updateTagSchema` (at-least-one-field `.refine`, mirrors `updateNoteSchema`). Extend `createNoteSchema`/`updateNoteSchema` with optional `tagIds: z.array(z.string()).optional()`. Add `tagIdsQuerySchema` (comma-separated string → `string[]` via `z.preprocess`) and extend `listNotesQuerySchema` with it. Export `TagColor`, `CreateTagInput`, `UpdateTagInput` inferred types.
  Files: `packages/shared/src/schemas.ts`
  Est: 25 min · `[PARALLEL]` (independent of 1.1)
  Satisfies: enables scenarios 3, 4, 12, 13, 14, 15, 17, 18 (validation rules only; behavior verified downstream).

- [x] **1.3** Add `Tag { id, name, color }` and `TagWithCount extends Tag { noteCount }` interfaces (import `TagColor` from `./schemas`). Extend the existing `Note` interface with `tagIds: string[]`.
  Files: `packages/shared/src/types.ts`
  Depends on: 1.2
  Est: 10 min
  Satisfies: enables scenarios 19, 20 (response-shape typing).

- [x] **1.4** Unit tests for every new/extended schema from 1.2: valid/invalid color, name length boundaries (0, 1, 50, 51 chars), `tagIds` array parsing, comma-split query preprocessing (empty string, trailing comma, single value, whitespace), and confirm duplicate IDs are *not* deduped at the schema layer (dedup is a service-layer concern).
  Files: `packages/shared/src/schemas.test.ts`
  Depends on: 1.2
  Est: 20 min · `[PARALLEL]` (independent of 1.3)

## Group 2 — Database Schema

- [x] **2.1** Add `Tag` and `NoteTag` Prisma models (per plan Data Model); add `tags Tag[]` relation field to `User`; add `tags NoteTag[]` relation field to `Note`.
  Files: `apps/api/prisma/schema.prisma`
  Est: 10 min · `[PARALLEL]` (independent of Group 1 — schema.prisma has no dependency on packages/shared)

- [x] **2.2** Generate the standard migration (`pnpm --filter api run prisma:migrate` with name `tags_core`) creating the `Tag`/`NoteTag` tables, FKs (`onDelete: Cascade` both sides), and `@@index([userId])`/`@@index([tagId])`. Apply to `notes_dev`; confirm it also applies cleanly to `notes_test`.
  Files: `apps/api/prisma/migrations/<ts>_tags_core/migration.sql`
  Depends on: 2.1
  Est: 10 min
  Satisfies: enables scenario 21 (tables exist).

- [x] **2.3** Hand-write the `--create-only` raw SQL migration for the case-insensitive per-user unique index: `CREATE UNIQUE INDEX tag_user_name_ci_idx ON "Tag" ("userId", lower(name));`. Apply to both `notes_dev` and `notes_test`.
  Files: `apps/api/prisma/migrations/<ts>_tag_name_ci_unique_index/migration.sql`
  Depends on: 2.2
  Est: 15 min
  Satisfies: enables scenario 21 (unique index exists and is enforced — proven in 3.6/5.3).

## Group 3 — Tags Vertical Slice (`/tags`)

- [x] **3.1** `tags.service.ts`: `createTag` (name/color validated by caller via Zod at controller layer; catch P2002 from the raw unique index → `409 TAG_NAME_DUPLICATE`), `updateTag` (owner-scoped `findFirst` or scoped `updateMany`; same P2002 handling; `404 TAG_NOT_FOUND` if missing/not owned), `deleteTag` (scoped `deleteMany`/`delete`; `404 TAG_NOT_FOUND` if missing/not owned), `listTags` (paginated, `noteCount` via a single aggregated query counting only active/non-deleted notes per tag — no N+1).
  Files: `apps/api/src/services/tags.service.ts`
  Depends on: 1.1, 1.2, 2.3
  Est: 35 min
  Satisfies: scenarios 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 (unit-level).

- [x] **3.2** Unit tests for `tags.service.ts` (Prisma mocked): all branches from 3.1, including the P2002-catch → `TAG_NAME_DUPLICATE` path and the `noteCount` aggregation logic.
  Files: `apps/api/src/services/tags.service.test.ts`
  Depends on: 3.1
  Est: 30 min · `[PARALLEL]` (independent of 3.3/3.4)

- [x] **3.3** `tags.controller.ts`: Zod-parse request → call service → map to `Tag`/`Page<TagWithCount>` response shape → JSON, mirroring `notes.controller.ts`'s structure (`toTagResponse`, `toTagPageResponse`, `getIdParam` reuse pattern).
  Files: `apps/api/src/controllers/tags.controller.ts`
  Depends on: 3.1
  Est: 25 min

- [x] **3.4** Unit tests for `tags.controller.ts`: request validation, response shape mapping, error passthrough via `next(err)`.
  Files: `apps/api/src/controllers/tags.controller.test.ts`
  Depends on: 3.3
  Est: 25 min · `[PARALLEL]` (independent of 3.2)

- [x] **3.5** `tags.router.ts`: mount `requireAuth`, wire `POST /`, `GET /`, `PATCH /:id`, `DELETE /:id` to the controller. Mount the new router at `/tags` in the top-level router.
  Files: `apps/api/src/routes/tags.router.ts`, `apps/api/src/routes/index.ts`
  Depends on: 3.3
  Est: 10 min

- [x] **3.6** Integration tests against `notes_test` (Supertest): full CRUD lifecycle, case-insensitive duplicate rejection (proves the raw SQL index — scenario 2), per-user isolation (scenario 5), `noteCount` correctness against a mix of active/soft-deleted notes (scenario 6), ownership 404s (scenarios 9, 11), missing/invalid token 401 (scenario 22).
  Files: `apps/api/src/routes/tags.integration.test.ts`
  Depends on: 3.5, 2.3
  Est: 40 min

## Group 4 — Notes Slice Extension (tagIds on notes)

- [x] **4.1** `notes.service.ts`: extend `createNote` with optional `tagIds` (dedupe, validate ownership via `tag.count`, throw `422 INVALID_TAG` on mismatch, nested `tags: { create: [...] }` write). Extend `updateNote` with the same ownership validation plus `noteTag.deleteMany` + `noteTag.createMany` added to the existing `$transaction([...])` array only when `input.tagIds !== undefined`. Add `include: { tags: { select: { tagId: true } } }` to `getNote`, `listNotes`, `listTrash`, `restoreNote`. Extend `listNotes`'s `where` with `AND: tagIds.map(tagId => ({ tags: { some: { tagId } } }))` when `query.tagIds` is non-empty.
  Files: `apps/api/src/services/notes.service.ts`
  Depends on: 1.1, 1.2, 2.3
  Est: 45 min · `[SUBAGENT]` (five distinct functions touched; largest single-file change in the ticket)
  Satisfies: scenarios 12, 13, 14, 15, 16, 17, 18.

- [x] **4.2** Extend `notes.service.test.ts` with unit tests for every new branch in 4.1: tag-ownership success/failure on create and update, full-set replacement, omitted `tagIds` leaves tags untouched, AND-filter `where`-clause construction, duplicate query values behave identically to a single value.
  Files: `apps/api/src/services/notes.service.test.ts`
  Depends on: 4.1
  Est: 30 min

- [x] **4.3** `notes.controller.ts`: `toNoteResponse` maps `note.tags.map(t => t.tagId)` → `tagIds` on every response.
  Files: `apps/api/src/controllers/notes.controller.ts`
  Depends on: 4.1
  Est: 15 min

- [x] **4.4** Extend `notes.controller.test.ts` fixtures with a `tags` array; assert `tagIds` appears in every response shape (create/get/update/list/trash/restore).
  Files: `apps/api/src/controllers/notes.controller.test.ts`
  Depends on: 4.3
  Est: 20 min · `[PARALLEL]` (independent of 4.2)

- [x] **4.5** Extend `notes.integration.test.ts` against `notes_test`: create tags via `/tags`, attach via `POST`/`PATCH /notes` `tagIds`, assert `422 INVALID_TAG` for another user's tag or a nonexistent tag ID, assert `GET /notes?tagIds=t1,t2` AND-semantics against real Postgres (scenario 17), assert an unowned/nonexistent `tagIds` filter value yields zero matches without erroring (scenario 18), assert `tagIds` appears on `GET /notes/:id`, `GET /notes/trash`, and `POST /notes/:id/restore` responses (scenario 20).
  Files: `apps/api/src/routes/notes.integration.test.ts`
  Depends on: 4.3, 3.6
  Est: 40 min

## Group 5 — Final Quality Gate

- [x] **5.1** Run `pnpm build`, `pnpm lint --max-warnings 0`, `pnpm test` at the repo root; confirm ≥80% coverage on every new/modified file (AGENTS.md §10); fix any failures before requesting review.
  Files: none (verification only)
  Depends on: all of Group 1–4
  Est: 15 min
