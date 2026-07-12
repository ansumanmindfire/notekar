---
ticket: AB-1004
type: BACKEND
status: APPROVED
---

# AB-1004: Core Note Models (incl. Trash & Restore)

## Overview

Implements the core Note domain for the Note Taking Application: full CRUD on notes scoped to the authenticated owner, a basic paginated list endpoint, soft-delete-based Trash with restore, and version-snapshot-on-update (write path only). This ticket is a foundation several later tickets depend on (AB-1005 List & Filtering, AB-1006 Tags, AB-1009 Version History) — it deliberately does not pre-build any of their surface area, to avoid contract drift or duplicated work when those tickets land.

## Goals

- `Note` Prisma model added via migration (`title`, `body` as TipTap JSON, `bodyText` plain-text extraction, `version` counter, `deletedAt` for soft delete), applied to both `notes_dev` and `notes_test` (SDS §2.2, §18).
- `NoteVersion` Prisma model added in the same migration — **write-only** in this ticket: every successful `PATCH` snapshots the pre-update `{title, body}` into `NoteVersion` inside a single `prisma.$transaction` alongside the update itself, and increments `Note.version`. No `GET /notes/:id/versions`, no restore endpoint — those are AB-1009.
- `bodyText` kept in sync with `body` via a Prisma middleware (`$use`) on every create/update, feeding the future FR-SEARCH `tsvector` column (not created in this ticket — that's AB-1007's raw-SQL migration).
- `POST /notes`: `{ title, body }` → `201`. No `tagIds` parameter in this ticket (see Non-Goals).
- `GET /notes/:id`: single note, `404` if not found, not owned, or soft-deleted.
- `PATCH /notes/:id`: `{ title?, body? }` → `200`, snapshots + increments version.
- `DELETE /notes/:id`: soft delete (sets `deletedAt`), `204`.
- `GET /notes`: basic pagination only — `?page&pageSize`, fixed default sort newest-first (`createdAt desc`). No `sort` or `tagIds` query params yet (AB-1005 extends this same endpoint).
- `GET /notes/trash`: same `Page<Note>` envelope and pagination mechanism as `GET /notes`, filtered to `deletedAt IS NOT NULL`, ordered by `deletedAt desc` (newest-deleted first).
- `POST /notes/:id/restore`: clears `deletedAt`, `200 Note`; `404` if not found, not owned, or already purged.
- `lib/jobs/purgeNotes.ts`: scheduled cron (`PURGE_CRON_SCHEDULE`) that permanently deletes `Note` rows where `deletedAt` is more than 30 days in the past, cascading to `NoteVersion` via Prisma's `onDelete: Cascade` (FR-NOTE-8). Logs the count purged.
- `middleware/auth.ts` (built in AB-1002, unused until now) mounted on all `/notes` routes for the first time.
- Error code `NOTE_NOT_FOUND` added to `packages/shared/src/errorCodes.ts`.
- New Zod schemas in `packages/shared`: `createNoteSchema`, `updateNoteSchema`, `paginationQuerySchema` (page/pageSize only — reused as-is by AB-1005 when it adds `sort`/`tagIds`), plus a `Note`/`NoteResponse` shared type.

## Non-Goals

- No `Tag` or `NoteTag` model, no `tagIds` param on create/update, no tag validation — entirely deferred to AB-1006. (Resolved with user: defer entirely rather than pre-scaffold empty Tag models, matching the AB-1002 precedent of adding relation fields only when the owning ticket lands.)
- No `sort` query param (`createdAt`/`updatedAt` asc/desc) or `tagIds` filter param on `GET /notes` — AB-1005 adds these to the same endpoint this ticket ships, without changing its contract for existing callers.
- No `GET /notes/:id/versions`, no `GET /notes/:id/versions/:versionId`, no version-restore endpoint, no versions purge job (`purgeVersions.ts`) — all AB-1009. This ticket only writes `NoteVersion` rows as a side effect of update.
- No `ShareLink` model or endpoints — AB-1008.
- No search / `tsvector` column or GIN index — AB-1007.
- No frontend work — AB-1011 (list/Trash UI), AB-1012 (editor UI).
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-NOTE-1 | Create Note — title 1–200 chars, TipTap JSON body; tag association explicitly deferred to AB-1006 |
| FR-NOTE-2 | Read Notes — single-note read scoped to owner, 404 on unowned/soft-deleted |
| FR-NOTE-3 | Update Note — title/body update; version snapshot captured transactionally on every update |
| FR-NOTE-4 | Soft Delete Note — `deletedAt` set, 30-day recovery window, no physical deletion in the request path |
| FR-NOTE-7 | View Trash — paginated list of the user's soft-deleted notes, newest-deleted first, read-only (Trash items cannot be updated — `PATCH` 404s while `deletedAt` is set) |
| FR-NOTE-8 | Restore Soft-Deleted Note — clears `deletedAt` within the 30-day window; `purgeNotes.ts` cron permanently deletes notes >30 days past `deletedAt`, after which restore 404s |

Soft-delete rule (AGENTS.md §6, §11): all deletion in the request path is `deletedAt` assignment only — no `prisma.note.delete()` call exists anywhere except `lib/jobs/purgeNotes.ts`, the one documented exception. `NoteVersion.note` uses `onDelete: Cascade`, but this only ever fires from that scheduled purge job, never from a user-facing delete — so it does not bypass the Note soft-delete rule (it *is* the designated physical-delete point, same reasoning as AB-1002's `RefreshToken` cascade precedent).

## API Contract

All endpoints require `Authorization: Bearer <accessToken>` (`middleware/auth.ts`, mounted here for the first time).

- `POST /notes`
  - Body: `{ title: string, body: TipTapJSON }`
  - `201 { id, title, body, createdAt, updatedAt, version: 1 }` (no `tagIds` in the response — see Non-Goals)
  - `400 VALIDATION_FAILED` (title empty or >200 chars, malformed body)
- `GET /notes/:id`
  - `200 Note`
  - `404 NOTE_NOT_FOUND` (missing, not owned, or soft-deleted)
- `PATCH /notes/:id`
  - Body: `{ title?: string, body?: TipTapJSON }` (at least one field required)
  - `200 Note` (version incremented)
  - `400 VALIDATION_FAILED`
  - `404 NOTE_NOT_FOUND` (missing, not owned, or soft-deleted — cannot update a trashed note)
- `DELETE /notes/:id`
  - `204` (sets `deletedAt`)
  - `404 NOTE_NOT_FOUND` (missing, not owned, or already soft-deleted)
- `GET /notes`
  - Query: `?page=1&pageSize=10` (both optional; default `page=1`, `pageSize=10`; fixed sort `createdAt desc`)
  - `200 Page<Note>` — only non-deleted notes
- `GET /notes/trash`
  - Query: `?page=1&pageSize=10`
  - `200 Page<Note>` — only the user's soft-deleted notes, ordered `deletedAt desc`
- `POST /notes/:id/restore`
  - `200 Note` (`deletedAt` cleared)
  - `404 NOTE_NOT_FOUND` (missing, not owned, not soft-deleted, or already purged)

## Data Model

```prisma
model Note {
  id        String    @id @default(cuid())
  userId    String
  title     String
  body      Json
  bodyText  String    @default("")
  version   Int       @default(1)
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt
  deletedAt DateTime?

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  versions NoteVersion[]

  @@index([userId, deletedAt])
  @@index([userId, createdAt])
}

model NoteVersion {
  id      String   @id @default(cuid())
  noteId  String
  version Int
  title   String
  body    Json
  savedAt DateTime @default(now())

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId, version])
  @@index([savedAt])
}
```

- `User` gains a `notes Note[]` relation field.
- `tags NoteTag[]` and `shares ShareLink[]` relation fields on `Note` are intentionally omitted until AB-1006/AB-1008 add those models — Prisma requires both sides of a relation to exist in the same schema (same phased-relation pattern as AB-1002/1003).
- `@@index([userId, updatedAt])` from the master SDS schema is **not** added yet — no query in this ticket sorts by `updatedAt`; AB-1005 adds it alongside the sort feature that needs it.
- `@@index([savedAt])` on `NoteVersion` **is** added now even though the purge job that uses it (AB-1009) isn't built yet — the column exists as of this migration, and adding the index later would require a second migration touching the same table for no benefit.
- Migration applied to both `DATABASE_URL` (`notes_dev`) and `TEST_DATABASE_URL` (`notes_test`) per SDS §2.2/§18 — standard Prisma migration, no raw SQL needed in this ticket.

## Ticket-Specific Decisions

- **Tags deferred entirely**: resolved with user — no `Tag`/`NoteTag` scaffolding, no `tagIds` param anywhere in this ticket's contract. AB-1006 extends `createNoteSchema`/`updateNoteSchema` and the note response shape when it lands.
- **`GET /notes` ships now, minimally**: resolved with user — basic `page`/`pageSize` pagination with a fixed default sort (`createdAt desc`, matching the FRS-stated default), so FR-NOTE-7's Trash requirement ("same mechanism as the active notes list") has a real mechanism to reuse. AB-1005 adds `sort` and `tagIds` query params to this same handler/service function without breaking existing callers.
- **`NoteVersion` is write-only here**: resolved with user — the model and snapshot-on-update logic are built now (satisfies FR-NOTE-3 literally), but no route reads or restores a version; AB-1009 owns 100% of the read/restore surface and the 90-day purge cron.
- **Version snapshot transaction**: `PATCH` wraps reading the current state, inserting the `NoteVersion` row, and updating `Note` (title/body/version increment/`updatedAt`) in a single `prisma.$transaction` (per SDS §10), so a crash mid-update can never leave a stale version count or a missing snapshot.
- **`bodyText` extraction now, `tsvector` later**: the Prisma middleware that flattens TipTap JSON to plain text ships in this ticket (needed to keep the column populated), but the `searchVector` generated column + GIN index (AB-1007's raw-SQL migration) is not added — `bodyText` sits unused by search until then.
- **`purgeNotes.ts` ships in this ticket, not AB-1009**: FR-NOTE-8's traceability entry is AB-1004, and the 30-day note-purge job is a distinct concern from the 90-day version-purge job (FR-VER-3, AB-1009) despite both being described together in SDS §18. Only the Note-purge half is built here; `purgeVersions.ts` is not created.
- **Restore vs. already-purged**: since `purgeNotes.ts` physically removes the row, a restore attempt after purge naturally 404s with no special-case code needed — same `NOTE_NOT_FOUND` as any other missing-note case.

## Scenarios

1. Create note with valid title/body → `201`, `version: 1`; no `NoteVersion` row exists yet (the first snapshot is only created once an update happens).
2. Create note with title >200 chars or empty title → `400 VALIDATION_FAILED`.
3. Read own active note → `200` full content.
4. Read another user's note → `404 NOTE_NOT_FOUND`.
5. Read own soft-deleted note via `GET /notes/:id` → `404 NOTE_NOT_FOUND` (per FR-NOTE-2; a Trash item's content is still viewable via `GET /notes/trash`'s list, just not via the single-note read route while deleted).
6. Update note title/body → `200`, version incremented from N to N+1, exactly one new `NoteVersion` row inserted with the pre-update title/body.
7. Update a soft-deleted note → `404 NOTE_NOT_FOUND` (Trash is read-only per FR-NOTE-7).
8. Delete an active note → `204`, `deletedAt` set, row still present in the DB; immediately disappears from `GET /notes` and appears in `GET /notes/trash`.
9. Delete an already-deleted note → `404 NOTE_NOT_FOUND` (not idempotent — "missing", "not owned", and "already deleted" all map to the same 404).
10. `GET /notes` paginates correctly across pages, default newest-first, excludes soft-deleted notes.
11. `GET /notes/trash` paginates using the identical `Page<Note>` envelope, ordered newest-deleted first, includes only soft-deleted notes.
12. Restore a note within the 30-day window → `200`, `deletedAt` cleared, reappears in `GET /notes`, disappears from `GET /notes/trash`.
13. Restore a note whose 30 days have elapsed and been purged by `purgeNotes.ts` → `404 NOTE_NOT_FOUND`.
14. `purgeNotes.ts` cron run → permanently deletes only notes with `deletedAt` older than 30 days; leaves more-recently-deleted notes untouched; cascades and removes their `NoteVersion` rows; logs the purged count.
15. All `/notes` routes reject requests with no/invalid access token → `401 AUTH_TOKEN_INVALID` (via `middleware/auth.ts`).

## Dependencies

- AB-1001 (Technical Foundation & Tooling Setup) — merged; provides `env.ts`, `AppError`, `errorHandler`, Prisma singleton, rate-limit factory, `packages/shared` skeleton.
- AB-1002 (Core User & Auth Models) — merged; provides the `User` model and `middleware/auth.ts`, mounted on `/notes` routes for the first time in this ticket.
- No dependency on AB-1003 (forgot-password) — unrelated domain.

## Open Questions

None — all three scope-boundary ambiguities (tag association, `GET /notes` scope, `NoteVersion` read/write split) were resolved with the user before drafting; see Ticket-Specific Decisions and Non-Goals.
