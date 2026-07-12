---
ticket: AB-1006
status: APPROVED
---

# AB-1006: Tags Architecture — Technical Plan

## Files to Create/Modify

### `packages/shared` (single source of truth — edit first, everything else imports from here)

| File | Change |
|---|---|
| `packages/shared/src/schemas.ts` | Add `TAG_COLORS` const tuple + `tagColorSchema` (`z.enum`), `tagNameSchema` (1–50 chars), `createTagSchema`, `updateTagSchema` (mirrors `updateNoteSchema`'s "at least one field" `.refine`). Add reusable `tagIdsBodySchema = z.array(z.string()).optional()` and extend `createNoteSchema`/`updateNoteSchema` with `tagIds: tagIdsBodySchema`. Add `tagIdsQuerySchema` (comma-separated string → `string[]`, via `z.preprocess`) and extend `listNotesQuerySchema` with `tagIds: tagIdsQuerySchema`. Export inferred types: `TagColor`, `CreateTagInput`, `UpdateTagInput`. |
| `packages/shared/src/types.ts` | Add `import type { TagColor } from './schemas'`. Add `Tag { id, name, color }` and `TagWithCount extends Tag { noteCount }` interfaces. Extend existing `Note` interface with `tagIds: string[]`. |
| `packages/shared/src/errorCodes.ts` | Add `TAG_NOT_FOUND`, `TAG_NAME_DUPLICATE`, `INVALID_TAG` to `ErrorCodes`. |
| `packages/shared/src/schemas.test.ts` | Add unit tests for the new/extended schemas (valid/invalid color, name length, tagIds parsing, comma-split query preprocessing, edge cases: empty string, trailing comma, duplicate IDs not deduped at schema layer — dedup happens in the service). |

### `apps/api/prisma`

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | Add `Tag` and `NoteTag` models (per spec Data Model). Add `tags Tag[]` relation field to `User`. Add `tags NoteTag[]` relation field to `Note`. |
| `apps/api/prisma/migrations/<ts>_tags_core/migration.sql` | Generated via `prisma migrate dev --name tags_core` — creates `Tag`, `NoteTag` tables, FKs (`onDelete: Cascade` on both `NoteTag.note` and `NoteTag.tag`), and the `@@index([userId])` / `@@index([tagId])` indexes. |
| `apps/api/prisma/migrations/<ts>_tag_name_ci_unique_index/migration.sql` | Hand-written `--create-only` migration: `CREATE UNIQUE INDEX tag_user_name_ci_idx ON "Tag" ("userId", lower(name));`. Applied to both `notes_dev` and `notes_test` via `prisma migrate dev` (dev) and the test suite's migration-apply step (test) — same dual-database flow as every prior ticket (SDS §2.2/§18). |

### `apps/api/src` — Tags (new vertical slice, routes → controllers → services)

| File | Change |
|---|---|
| `apps/api/src/services/tags.service.ts` | New. `createTag`, `updateTag`, `deleteTag`, `listTags` (with active-note count aggregation). |
| `apps/api/src/services/tags.service.test.ts` | New. Unit tests, Prisma mocked. |
| `apps/api/src/controllers/tags.controller.ts` | New. Zod-parse → service call → `toTagResponse`/`toTagWithCountPageResponse` → JSON, mirroring `notes.controller.ts`'s shape exactly. |
| `apps/api/src/controllers/tags.controller.test.ts` | New. |
| `apps/api/src/routes/tags.router.ts` | New. `requireAuth` mounted, routes: `POST /`, `GET /`, `PATCH /:id`, `DELETE /:id`. |
| `apps/api/src/routes/tags.integration.test.ts` | New. Supertest against `notes_test` — the tier that proves the raw-SQL case-insensitive unique index actually works (SDS §14). |
| `apps/api/src/routes/index.ts` | Modify. Mount `router.use('/tags', createTagsRouter(env))`. |

### `apps/api/src` — Notes (extend existing slice with tagIds)

| File | Change |
|---|---|
| `apps/api/src/services/notes.service.ts` | `createNote`: accept optional `tagIds`, dedupe (`[...new Set(...)]`), validate ownership via `prisma.tag.count({ where: { id: { in }, userId } })` against the deduped length (throw `422 INVALID_TAG` on mismatch), then create the note with a nested `tags: { create: uniqueTagIds.map(tagId => ({ tagId })) }` write (single atomic Prisma call — no manual `$transaction` needed for create). `updateNote`: same ownership validation when `tagIds` is present; add `prisma.noteTag.deleteMany({ where: { noteId } })` + `prisma.noteTag.createMany({ data: ... })` to the existing `$transaction([...])` array, conditionally, only when `input.tagIds !== undefined` (omitted key ⇒ tags untouched, matching spec). `getNote`, `listNotes`, `listTrash`, `restoreNote`: add `include: { tags: { select: { tagId: true } } }` to every note read so the controller can map `tagIds`. `listNotes`: extend `where` with `AND: tagIds.map(tagId => ({ tags: { some: { tagId } } }))` when `query.tagIds` is non-empty (AND semantics per FR-NOTE-6). |
| `apps/api/src/services/notes.service.test.ts` | Extend with unit tests for the new tagIds branches (mocked Prisma). |
| `apps/api/src/controllers/notes.controller.ts` | `toNoteResponse`: map `note.tags.map(t => t.tagId)` → `tagIds`. Update the internal `PrismaNote` type alias's inferred shape (comes from the service's new `include`, no explicit change needed beyond what the service returns). |
| `apps/api/src/controllers/notes.controller.test.ts` | Extend fixtures with a `tags` array; assert `tagIds` appears in every response shape. |
| `apps/api/src/routes/notes.integration.test.ts` | Extend: create tags via `/tags`, attach via `/notes` `tagIds`, assert `422 INVALID_TAG` for another user's tag, assert `GET /notes?tagIds=...` AND-filtering against real Postgres. |

## Prisma Schema Changes

```prisma
model Tag {
  id     String @id @default(cuid())
  userId String
  name   String
  color  String // validated against TagColor enum at the app layer (packages/shared)

  user  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  notes NoteTag[]

  @@index([userId])
}

model NoteTag {
  noteId String
  tagId  String

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([noteId, tagId])
  @@index([tagId])
}
```

- `User.tags Tag[]` and `Note.tags NoteTag[]` relation fields added to the existing models.
- **No physical deletes of `Note` rows anywhere in this ticket.** The only physical delete this ticket introduces is `prisma.tag.delete()` in `deleteTag` — this is deleting a `Tag`, not a `Note`, so it does not touch the soft-delete rule (AGENTS.md §6/§11 govern `Note`/`NoteVersion` only). `NoteTag` rows are removed only as FK cascades (from `deleteTag`, or from `purgeNotes.ts`'s existing physical note-purge — unchanged by this ticket) or as an explicit `deleteMany` inside `updateNote`'s tag-replacement step, never as a side effect of any note soft-delete/restore path.
- Two migrations, both applied to `DATABASE_URL` (`notes_dev`) and `TEST_DATABASE_URL` (`notes_test`): one standard Prisma migration for the two new tables/relations, one `--create-only` raw SQL migration for the case-insensitive unique index (the second of the two documented raw-SQL exceptions in this codebase, alongside AB-1007's future `tsvector` column).

## New Packages

None. Every dependency needed (Prisma, Zod, Express) is already installed at the versions pinned in `apps/api/package.json` (`@prisma/client 6.19.3`, `prisma 6.19.3`, `zod 4.4.3`). No `package.json` changes in this ticket.

## Dependencies on Prior Tickets

- **AB-1004 (Core Note Models)** — merged. This ticket adds a relation field to the existing `Note` model and extends `createNoteSchema`/`updateNoteSchema`/`notes.service.ts`/`notes.controller.ts` without changing behavior for callers that omit `tagIds`.
- **AB-1005 (Notes List & Filtering)** — merged. This ticket extends `listNotesQuerySchema` and `listNotes` with the `tagIds` filter, composing with the existing `sort` parameter untouched.
- **AB-1002 (Core User & Auth Models)** — merged. `middleware/auth.ts` (`requireAuth`) is reused unmodified on the new `/tags` router, same as `/notes`.
- No dependency on AB-1007/1008/1009 (Search/Sharing/Version History) — unrelated domains, confirmed in spec.

## Risk Areas

1. **Case-insensitive unique index is Postgres-only behavior.** Unlike `User.email` (which sidesteps this by storing the value lowercased), the raw functional index on `Tag` can only be proven correct against real Postgres — a mocked-Prisma unit test would give false confidence. Mitigated by `tags.integration.test.ts` running against `notes_test` (SDS §14 tier), asserting an actual `23505`/`P2002` on a case-variant duplicate.
2. **TOCTOU gap between tag-ownership check and write.** `createNote`/`updateNote` validate `tagIds` ownership via a `count()` query, then perform the write in a separate step. If a tag is deleted concurrently between the two (a narrow window), the subsequent `noteTag` insert will fail on the FK constraint (Postgres `23503`) rather than cleanly reporting `422 INVALID_TAG`. This mirrors the project's existing risk tolerance (e.g. `registerUser`'s existence-check-then-create has the same class of gap, closed only by the P2002 catch-and-rethrow as a backstop) — plan is to add the same catch-and-rethrow-as-`INVALID_TAG` backstop around the note write for defense in depth, not a fully race-proof design.
3. **`updateNote`'s tag-replacement step changes an existing `$transaction([...])` array.** The array form runs all operations sequentially in one transaction but each operation's inputs must be computable up front (no interactive `async (tx) => ...` needed here since tag ownership is validated before the transaction starts, and the delete+recreate of `NoteTag` rows doesn't depend on any other operation's result). Care needed to keep the version-snapshot ordering (snapshot pre-update state → update note → delete old tags → create new tags) so a crash mid-transaction can't leave a mismatched version count, matching the atomicity guarantee SDS §10 already requires for this endpoint.
4. **`listNotes`'s AND-semantics filter must not double-count or drop notes with duplicate `tagIds` query values.** `?tagIds=t1,t1` should behave identically to `?tagIds=t1` — the `AND: tagIds.map(...)` construction naturally handles this (repeated identical `some` clauses are redundant but harmless), so no explicit dedup is required in `listNotes`, only in the mutation paths where duplicate entries would otherwise attempt duplicate `NoteTag` inserts (`P2002` on the composite PK).
5. **Frontend contract change is additive but not backward-compatible for anyone hand-rolling requests** — `Note` gaining a required `tagIds` field is a breaking shape change for any caller not going through `packages/shared`'s types. No such caller exists yet (AB-1011/1012 haven't shipped), so this is a non-issue in practice, noted only for completeness.

## Test Strategy

| Spec Scenario # | Behavior | Test File | Tier |
|---|---|---|---|
| 1–4 | Tag create: valid, case-insensitive duplicate, invalid color, name length | `tags.service.test.ts` (validation branches), `tags.integration.test.ts` (real duplicate-detection scenario 2) | Unit + Integration |
| 5 | Per-user uniqueness (two users, same name) | `tags.integration.test.ts` | Integration |
| 6 | `GET /tags` note counts (active-only) | `tags.service.test.ts` (mocked aggregation), `tags.integration.test.ts` (real count against mixed active/soft-deleted notes) | Unit + Integration |
| 7–9 | Tag update: success, duplicate collision, not-owned | `tags.service.test.ts`, `tags.integration.test.ts` | Unit + Integration |
| 10–11 | Tag delete: cascades, not-owned/missing | `tags.service.test.ts`, `tags.integration.test.ts` | Unit + Integration |
| 12–13 | Note create with valid/invalid `tagIds` | `notes.service.test.ts`, `notes.integration.test.ts` | Unit + Integration |
| 14–16 | Note update: full-set tag replacement, invalid tagId rejects whole update, omitted `tagIds` leaves tags untouched | `notes.service.test.ts`, `notes.integration.test.ts` | Unit + Integration |
| 17–18 | `GET /notes?tagIds=...` AND-semantics, unowned/nonexistent tagId yields empty (not an error) | `notes.service.test.ts` (mocked `where` construction), `notes.integration.test.ts` (real join query) | Unit + Integration |
| 19–20 | `tagIds` present on every note response shape (list/get/trash/restore) | `notes.controller.test.ts` | Unit |
| 21 | Migration creates tables + case-insensitive unique index in both databases | `tags.integration.test.ts` (asserts the constraint fires against `notes_test`) | Integration |
| 22 | All `/tags` routes reject missing/invalid token | `tags.integration.test.ts` (reuses the existing `requireAuth` behavior already covered by `notes.integration.test.ts`'s equivalent case) | Integration |

Coverage gate (≥80% on new code, AGENTS.md §10) applies to every new/modified file above, enforced locally via the Husky pre-commit hook — no CI in this project (FRS §11).
