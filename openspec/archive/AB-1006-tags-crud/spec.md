---
ticket: AB-1006
type: BACKEND
status: APPROVED
---

# AB-1006: Tags Architecture

## Overview

Implements the Tag domain for the Note Taking Application: full Tag CRUD scoped to the authenticated owner, paginated tag listing with active-note counts, and the note-tag association surface that AB-1004 and AB-1005 both explicitly deferred to this ticket. Per user decision, this ticket closes out both deferrals rather than staying narrowly scoped to `/tags` CRUD alone:

- AB-1004 deferred `tagIds` on `POST`/`PATCH /notes` and the `tagIds` field on the `Note` response shape ("AB-1006 extends `createNoteSchema`/`updateNoteSchema` and the note response shape when it lands").
- AB-1005 deferred the `tagIds` AND-filter on `GET /notes` (FR-NOTE-6), traced in the FRS traceability matrix to AB-1004/1005 but never built there ("AB-1006 extends this same `GET /notes` endpoint with `tagIds` (AND semantics) without breaking this ticket's contract").

## Goals

- `Tag` and `NoteTag` Prisma models added via migration, applied to both `notes_dev` and `notes_test` (SDS §2.2, §18).
- Case-insensitive per-user tag name uniqueness enforced via a raw SQL functional unique index (`CREATE UNIQUE INDEX ... ON "Tag" (userId, lower(name))`) — this is one of the two documented raw-SQL exceptions in AGENTS.md §9/§11 and AB-1006's Do-Not-Do carve-out, applied consistently even though `User.email` (AB-1002) used a stored-lowercase column instead of a raw index for its own case-insensitive uniqueness.
- `POST /tags`: `{ name, color }` → `201 Tag`.
- `PATCH /tags/:id`: `{ name?, color? }` (at least one) → `200 Tag`. Owner-only.
- `DELETE /tags/:id`: → `204`. Cascades to `NoteTag` (removes the association only; notes themselves are untouched).
- `GET /tags`: `?page&pageSize` → `200 Page<{ id, name, color, noteCount }>`, `noteCount` = count of the tag's currently-active (non-deleted) notes, computed via a single aggregated query (no N+1).
- Fixed tag color palette defined once in `packages/shared` as the single source of truth for both backend validation and the (future) frontend color picker: `red | orange | yellow | green | blue | purple | pink | gray`.
- `createNoteSchema` and `updateNoteSchema` extended with optional `tagIds: string[]`. Every listed tag ID must belong to the requesting user or the request is rejected (`422 INVALID_TAG`).
- `Note` response shape (shared `Note` type, and every endpoint that returns it: create/read/update/list/trash/restore) gains `tagIds: string[]`.
- `PATCH /notes/:id` accepts `tagIds` as a full-replacement set — when provided, it replaces the note's entire current tag association, it does not merge/patch incrementally.
- `listNotesQuerySchema` (`GET /notes`) gains an optional `tagIds` filter (comma-separated tag IDs in the query string, e.g. `?tagIds=t1,t2`), matched with **AND semantics** — a note must carry every listed tag ID to be included (FR-NOTE-6).
- New error codes in `packages/shared/src/errorCodes.ts`: `TAG_NOT_FOUND` (404), `TAG_NAME_DUPLICATE` (409), `INVALID_TAG` (422).

## Non-Goals

- No frontend tagging UI, color picker, or on-the-fly tag creation from the editor — all AB-1012 (Note Editor Frontend).
- No backend "assign a random color automatically" logic (FR-UI-3) — that behavior is the frontend's responsibility (AB-1012 picks a random value from this ticket's fixed palette and calls `POST /tags` with it); this ticket's `POST /tags` always requires an explicit, valid `color` value and never generates one itself.
- No changes to `GET /notes/trash` — it gains neither a `tagIds` filter nor `sort`; Trash's contract stays exactly as AB-1004 left it. Trashed notes still carry `tagIds` in their response shape (inherited from the shared `Note` type) but cannot be filtered by tag.
- No validation that a `tagIds` filter value on `GET /notes` belongs to the caller — an unowned or nonexistent tag ID in the filter simply matches zero notes (no error), since filtering is a read-only query shape, not a mutation; this differs deliberately from the `422 INVALID_TAG` mutation-time check on note create/update (see Ticket-Specific Decisions).
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-TAG-1 | Tag Creation & Constraints — name 1–50 chars, color from fixed preset enum, case-insensitive per-user uniqueness |
| FR-TAG-2 | Tag Deletion — deleting a tag cascades only to `NoteTag`; notes remain intact |
| FR-TAG-3 | Tag List & Note Counts — paginated list, each tag shows its count of active (non-deleted) notes |
| FR-TAG-4 | Tag Update — name and/or color editable, same uniqueness/length rules as creation, owner-only |
| FR-NOTE-1 | Create Note (tag association half) — `tagIds` accepted on `POST /notes`; using another user's tag is rejected (closes the AB-1004 deferral) |
| FR-NOTE-6 | Filter Notes by Tags — `GET /notes?tagIds=...` with AND semantics (closes the AB-1005 deferral) |

Soft-delete rule (AGENTS.md §6, §11): `DELETE /tags/:id` performs a **physical** delete of the `Tag` row and cascading `NoteTag` rows — this does not violate the Note soft-delete rule, because `Tag`/`NoteTag` are metadata/join tables, not `Note` rows; no `Note` is ever deleted or has its `deletedAt` touched by this ticket. The `noteCount` aggregation and the `tagIds` note filter both correctly exclude soft-deleted notes (`deletedAt: null`).

## API Contract

All endpoints require `Authorization: Bearer <accessToken>` (`middleware/auth.ts`).

- `POST /tags`
  - Body: `{ name: string, color: TagColor }`
  - `201 Tag` — `{ id, name, color }`
  - `400 VALIDATION_FAILED` (name empty/>50 chars, color not in the fixed enum)
  - `409 TAG_NAME_DUPLICATE` (case-insensitive collision with an existing tag of the same user)
- `PATCH /tags/:id`
  - Body: `{ name?: string, color?: TagColor }` (at least one field required)
  - `200 Tag`
  - `400 VALIDATION_FAILED`
  - `404 TAG_NOT_FOUND` (missing or not owned)
  - `409 TAG_NAME_DUPLICATE` (renaming into collision with another of the caller's own tags)
- `DELETE /tags/:id`
  - `204` (cascades to `NoteTag`; notes unaffected)
  - `404 TAG_NOT_FOUND` (missing or not owned)
- `GET /tags`
  - Query: `?page=1&pageSize=10` (reuses the existing shared `paginationQuerySchema` — see Ticket-Specific Decisions)
  - `200 Page<{ id, name, color, noteCount }>`
- `POST /notes` (extends AB-1004 contract)
  - Body: `{ title, body, tagIds?: string[] }`
  - `201 Note` — now includes `tagIds`
  - `400 VALIDATION_FAILED` (unchanged rules, plus malformed `tagIds`)
  - `422 INVALID_TAG` (a listed tag ID doesn't belong to the caller or doesn't exist)
- `PATCH /notes/:id` (extends AB-1004 contract)
  - Body: `{ title?, body?, tagIds?: string[] }` (at least one of the three required)
  - `200 Note` — `tagIds`, if provided, fully replaces the note's current tag set
  - `400 VALIDATION_FAILED`
  - `404 NOTE_NOT_FOUND` (unchanged)
  - `422 INVALID_TAG` (unowned/nonexistent tag ID in the provided set)
- `GET /notes` (extends AB-1005 contract)
  - Query: `?page&pageSize&sort&tagIds=t1,t2` — `tagIds` optional, comma-separated, AND semantics
  - `200 Page<Note>` — unchanged envelope, now tag-filterable; each `Note` includes `tagIds`
- `GET /notes/:id`, `GET /notes/trash`, `POST /notes/:id/restore` — response shape only change: each now includes `tagIds` (no other contract change).

## Data Model

```prisma
model Tag {
  id     String @id @default(cuid())
  userId String
  name   String
  color  String // validated at the app layer against the fixed TagColor enum in packages/shared

  user  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  notes NoteTag[]

  @@index([userId])
}
// Raw SQL migration (--create-only), applied to both notes_dev and notes_test:
//   CREATE UNIQUE INDEX tag_user_name_ci_idx ON "Tag" (userId, lower(name));

model NoteTag {
  noteId String
  tagId  String

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([noteId, tagId])
  @@index([tagId])
}
```

- `User` gains a `tags Tag[]` relation field.
- `Note` gains a `tags NoteTag[]` relation field.
- `NoteTag.note`'s `onDelete: Cascade` only ever fires from `purgeNotes.ts` (the documented physical-delete exception) — never from a user-facing note delete, since notes are soft-deleted. `NoteTag.tag`'s `onDelete: Cascade` fires from `DELETE /tags/:id`, which is this ticket's one legitimate physical-delete path (FR-TAG-2) and does not touch any `Note` row.
- Standard Prisma migration for the two models/relation fields, plus one `--create-only` raw SQL migration for the case-insensitive unique index (SDS §18, AGENTS.md §9). Both applied to `DATABASE_URL` (`notes_dev`) and `TEST_DATABASE_URL` (`notes_test`).

## Ticket-Specific Decisions

- **Deferred surface included** (resolved with user): this ticket closes both the AB-1004 (`tagIds` on note create/update + response shape) and AB-1005 (`tagIds` AND-filter on `GET /notes`, FR-NOTE-6) deferrals, rather than shipping `/tags` CRUD only and leaving a third ticket to bridge notes and tags together.
- **Color palette resolved with user**: fixed 8-value enum taken verbatim from the SDS §3 example — `red | orange | yellow | green | blue | purple | pink | gray` — defined once in `packages/shared` (e.g. a `tagColorSchema`/`TagColor` export) so both the backend validator and any future frontend color picker read from the same source.
- **Note-tag response shape resolved with user**: `tagIds: string[]` only (matches the literal SDS §4 `POST /notes` example), not embedded `{id, name, color}` tag objects. The frontend is expected to resolve names/colors against its own `GET /tags` cache (TanStack Query) rather than the API denormalizing tag data into every note payload.
- **Tag list pagination resolved with user**: reuses the existing shared `paginationQuerySchema` (default `pageSize=10`, max 50) rather than introducing a tag-specific schema with a different default — consistent with every other paginated list in the app (notes, trash). The SDS §4 `pageSize=20` was an illustrative example value, not a stated default.
- **Raw SQL for tag uniqueness, despite `User.email`'s different approach**: `User.email` (AB-1002) achieved case-insensitive uniqueness by storing the value lowercased, avoiding raw SQL. Tags cannot use the same trick without lossy-lowercasing the display name (`"Work"` needs to render as typed, not forced to `"work"`), so this ticket follows the raw SQL functional-index approach AGENTS.md §9 explicitly documents as one of only two sanctioned raw-SQL exceptions system-wide.
- **`tagIds` filter tolerates unowned/nonexistent IDs silently**: a filter value that matches no owned tag simply yields zero matching notes — no `422`. Only the *mutation* paths (`POST`/`PATCH /notes`, attaching a tag) enforce ownership with `422 INVALID_TAG`, because attaching an unowned tag is a meaningful integrity violation while filtering by one just isn't a security-relevant action.
- **`PATCH /notes/:id` tag replacement is full-set, not incremental**: when `tagIds` is present in the request body, the service replaces the note's entire `NoteTag` association set to exactly the provided list (delete-all-then-recreate, or a diffed upsert — implementation detail for `/plan`) rather than adding to or removing from the existing set. Omitting `tagIds` entirely leaves the note's current tags untouched.
- **Tag deletion is a real physical delete**: unlike every other deletion in this codebase, `DELETE /tags/:id` performs `prisma.tag.delete()` directly (cascading to `NoteTag`). This does not conflict with the Note soft-delete rule (AGENTS.md §6) because `Tag` is not `Note` — no soft-delete requirement was ever stated for tags in the FRS (FR-TAG-2 says "Tag is deleted"), and the notes it was attached to are explicitly required to remain intact.

## Scenarios

1. Create tag with valid name/color → `201`, tag scoped to the caller only.
2. Create tag with a name that collides case-insensitively with an existing tag of the same user (e.g. `"Work"` vs `"work"`) → `409 TAG_NAME_DUPLICATE`.
3. Create tag with a color outside the fixed enum → `400 VALIDATION_FAILED`.
4. Create tag with name >50 chars or empty → `400 VALIDATION_FAILED`.
5. Two different users each create a tag named `"Work"` → both succeed (uniqueness is per-user, not global).
6. `GET /tags` → `200`, paginated, each entry's `noteCount` reflects only that tag's currently-active (non-deleted) notes.
7. Update own tag's name and/or color → `200`, change visible immediately on every note that uses it (no denormalized copy to invalidate, since notes only store `tagIds`).
8. Rename own tag to collide (case-insensitively) with another of the caller's own tags → `409 TAG_NAME_DUPLICATE`.
9. Attempt to update a tag belonging to another user → `404 TAG_NOT_FOUND`.
10. Delete a tag attached to several notes → `204`; the notes remain fully intact (title/body/other tags unaffected), just missing this tag's association.
11. Attempt to delete a tag belonging to another user, or a nonexistent tag ID → `404 TAG_NOT_FOUND`.
12. Create a note with `tagIds` referencing only tags the caller owns → `201`, response `tagIds` matches what was sent.
13. Create a note with a `tagIds` entry belonging to another user (or a nonexistent tag ID) → `422 INVALID_TAG`, note is not created.
14. Update a note's `tagIds` to a new valid set → `200`, note's tag association fully replaced (old tags not in the new set are detached, new ones attached).
15. Update a note's `tagIds` including one unowned/nonexistent tag ID → `422 INVALID_TAG`, no partial update applied (title/body/tags all left unchanged).
16. `PATCH /notes/:id` with only `{ title }` (no `tagIds` key at all) → `200`, existing tag associations untouched.
17. `GET /notes?tagIds=A,B` where both A and B are attached to note N1, only A is attached to N2 → only N1 is returned (AND semantics).
18. `GET /notes?tagIds=<unowned-or-nonexistent-id>` → `200` with zero matching notes, not an error.
19. `GET /notes` (no `tagIds`) → unchanged from AB-1005, all active notes returned, each now carrying its `tagIds` array (possibly empty).
20. `GET /notes/:id`, `GET /notes/trash`, and `POST /notes/:id/restore` responses each include `tagIds` — verifies the shared `Note` type change propagated everywhere it's returned.
21. Migration run → `Tag`, `NoteTag` tables exist, `tag_user_name_ci_idx` unique index enforces case-insensitive per-user uniqueness at the database level (verified in integration tests per SDS §14, since this is a Postgres-only guarantee no mock can prove), in both `notes_dev` and `notes_test`.
22. All `/tags` routes reject requests with no/invalid access token → `401 AUTH_TOKEN_INVALID`.

## Dependencies

- AB-1004 (Core Note Models) — merged; this ticket extends its `Note` model, `createNoteSchema`/`updateNoteSchema`, and the `POST`/`PATCH`/`GET /notes` handlers without breaking existing callers who omit `tagIds`.
- AB-1005 (Notes List & Filtering) — merged; this ticket extends `listNotesQuerySchema` and `GET /notes` with the `tagIds` filter, composing with the existing `sort` parameter.
- No dependency on AB-1007 (Search), AB-1008 (Sharing), or AB-1009 (Version History) — unrelated domains; `NoteVersion` intentionally never stores `tagIds` (SDS §10), so this ticket does not touch version history at all.

## Open Questions

None — all scope-boundary and design ambiguities (deferred-surface inclusion, color palette, note-tag response shape, tag pagination default) were resolved with the user before drafting; see Ticket-Specific Decisions.
