---
ticket: AB-1009
type: BACKEND
status: APPROVED
---

# AB-1009: Version History Architecture

## Overview

Implements the read and restore surface for note version history: list a note's historical versions, preview one in full, and restore a note to a previous version (non-destructively — restoring itself creates a new version rather than overwriting the timeline). Also adds the `purgeVersions.ts` scheduled job that hard-deletes `NoteVersion` rows older than 90 days (FR-VER-3). The `NoteVersion` Prisma model, its relation to `Note`, and the snapshot-on-update transaction were already built in AB-1004 (`notes.service.ts:updateNote`) — this ticket only adds the read/restore/purge surface on top of that existing data.

## Goals

- `GET /notes/:id/versions` — owner lists version summaries (`id`, `version`, `savedAt`, `title` — no `body`) for a note, newest first. Works even if the note is currently soft-deleted (FR-VER-1).
- `GET /notes/:id/versions/:versionId` — owner previews one historical version's full content (`id`, `version`, `title`, `body`, `savedAt`). Also works on a soft-deleted note.
- `POST /notes/:id/versions/:versionId/restore` — owner restores a note's title/body to a historical version. Snapshots the note's *current* title/body as a new version first (never destructive), then applies the historical content, incrementing `Note.version`. Tag associations are never touched. Allowed even if the note is currently soft-deleted (resolved with user — see Ticket-Specific Decisions).
- New `purgeVersions.ts` job (mirrors `purgeNotes.ts`): hard-deletes `NoteVersion` rows where `savedAt` is more than 90 days in the past, scheduled on the same `PURGE_CRON_SCHEDULE` cron as `purgeNotes.ts`, registered in `server.ts` under the same `NODE_ENV !== 'test'` guard.
- New `VERSION_NOT_FOUND` (404) error code.

## Non-Goals

- No frontend (version drawer, split-view diff, restore confirmation modal) — that is AB-1015 (Version History Frontend).
- No Prisma schema changes — `NoteVersion`, its `@@index([noteId, version])`/`@@index([savedAt])`, and the `Note.versions` back-relation already exist (added in AB-1004). This ticket is pure service/route/job work on top of existing tables.
- No change to how versions are *created* — `updateNote`'s existing snapshot-before-update transaction (`notes.service.ts`) is unchanged and is not part of this ticket's scope.
- No new rate limiter — the FRS's consolidated rate-limit table (§11) does not list version endpoints, consistent with how tags/search endpoints have none beyond standard auth.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-VER-1 | View History — list + single-version preview, accessible even during the note's 30-day soft-delete window |
| FR-VER-2 | Restore Version — non-destructive (creates a new version rather than overwriting), tags untouched regardless of what tags existed when the version was saved |
| FR-VER-3 | Auto-Purge History — scheduled job hard-deletes `NoteVersion` rows older than 90 days |

Soft-delete rule (AGENTS.md §6, §11): this ticket introduces no new physical deletion of `Note` rows. `purgeVersions.ts` is the second of the two application-sanctioned physical-deletion jobs (SDS §18) and only ever deletes `NoteVersion` rows — never `Note` rows, which remain the sole responsibility of `purgeNotes.ts`.

## API Contract

- `GET /notes/:id/versions` (auth required, owner only)
  - `200 [{ id, version, title, savedAt }]` — newest first (by `savedAt` desc), no `body` field
  - `404 NOTE_NOT_FOUND` — note doesn't exist or isn't owned by the caller (trash state does not matter)
- `GET /notes/:id/versions/:versionId` (auth required, owner only)
  - `200 { id, version, title, body, savedAt }`
  - `404 NOTE_NOT_FOUND` — note doesn't exist or isn't owned by the caller
  - `404 VERSION_NOT_FOUND` — `versionId` doesn't exist or doesn't belong to that note
- `POST /notes/:id/versions/:versionId/restore` (auth required, owner only, no request body)
  - `200 Note` — full note (matching the shape returned by `PATCH /notes/:id`), title/body reverted to the historical version's content, `version` incremented, tags unchanged
  - `404 NOTE_NOT_FOUND` — note doesn't exist or isn't owned by the caller
  - `404 VERSION_NOT_FOUND` — `versionId` doesn't exist or doesn't belong to that note

## Data Model

No schema changes. For reference, the existing model (unchanged, from AB-1004):

```prisma
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

`onDelete: Cascade` on `NoteVersion.note` already only fires as a side effect of `purgeNotes.ts` hard-deleting a `Note` row (SDS §18) — unchanged by this ticket, and never bypasses the soft-delete rule.

## Ticket-Specific Decisions

- **Owner lookups ignore trash state (list/preview/restore) (resolved with user, extends the FR-VER-1/shares.service.ts precedent):** all three endpoints look up the note via `{ id, userId }` only — no `deletedAt` filter. This means restore is permitted even while the note sits in its 30-day Trash window, consistent with the codebase's existing "owner-scoped metadata operations ignore trash state" pattern (`shares.service.ts:listShareLinks`/`revokeShareLink`). Restoring a version only ever touches `title`/`body`/`version`, never `deletedAt`, so it composes cleanly with a later `POST /notes/:id/restore`.
- **Restore transaction (mirrors `updateNote`'s existing pattern exactly):** in a single `prisma.$transaction`, (1) snapshot the note's *current* `title`/`body` as a new `NoteVersion` row tagged with the note's current `version` number, then (2) update the `Note` row's `title`/`body`/`bodyText` (re-derived via `extractPlainText`) to the target historical version's content and increment `Note.version` by 1. This is the same two-step shape `updateNote` already uses before an edit — restore is simply "update to historical content" instead of "update to request-body content."
- **Tags never touched:** the restore transaction contains no `NoteTag` operations at all — tags are current-state metadata per FR-VER-2/SDS §10, regardless of what was attached at save time.
- **Version list ordering:** `orderBy: { savedAt: 'desc' }` (newest first), matching the Trash-list and share-link-list ordering conventions already established.
- **No `noteId` in response bodies:** version summaries/details omit `noteId` (implied by the URL path), matching how `Note` responses already omit `userId`.
- **Purge job:** `purgeVersions.ts` computes `cutoff = now - 90 days` and runs `prisma.noteVersion.deleteMany({ where: { savedAt: { lt: cutoff } } })`, logging the purged count exactly like `purgeNotes.ts` does. `schedulePurgeVersionsJob(env)` schedules it on the same `env.PURGE_CRON_SCHEDULE` cron string (SDS §18: "Both jobs run on the same daily schedule") as an independent `schedule(...)` call — not merged into `purgeNotes`'s callback, so either job's cron history/error handling stays isolated per SDS's job-per-file convention (`lib/jobs/`).

## Scenarios

1. Owner requests version list for a note with 3 historical versions → `200`, 3 items, newest `savedAt` first, no `body` field present.
2. Owner requests version list for a note with zero historical versions (never updated since creation) → `200 []`.
3. Owner requests version list for a note currently in Trash → `200` (trash state ignored for read).
4. Owner requests version list for a note they don't own → `404 NOTE_NOT_FOUND`.
5. Owner previews a specific historical version → `200` with full `title`/`body`/`version`/`savedAt`.
6. Owner previews a version ID that doesn't belong to the given note → `404 VERSION_NOT_FOUND`.
7. Owner previews a version of a note they don't own → `404 NOTE_NOT_FOUND`.
8. Owner restores a historical version → `200 Note` with title/body reverted; a new `NoteVersion` row now exists snapshotting what was current immediately before the restore; `Note.version` is one higher than before.
9. Owner restores a version on a note whose tags have changed since that version was saved → note's title/body revert; the note's *current* tags are unaffected (no `NoteTag` rows touched).
10. Owner restores a version while the note is currently in Trash (soft-deleted) → `200 Note`, restore succeeds; `deletedAt` remains unchanged (still trashed).
11. Owner attempts to restore a `versionId` that doesn't belong to the note → `404 VERSION_NOT_FOUND`, no mutation occurs.
12. Owner attempts to restore a version on a note they don't own → `404 NOTE_NOT_FOUND`.
13. Two concurrent restores targeting different historical versions of the same note both complete; final `Note.version` reflects two increments, and both intermediate snapshots exist in history (verified via integration test against real Postgres, per SDS §14's precedent for transactional restore).
14. Request to any endpoint under `/notes/:id/versions` with no/invalid access token → `401 AUTH_TOKEN_INVALID`.
15. `NoteVersion` rows older than 90 days are removed by `purgeVersions.ts`; rows exactly at or under 90 days old are left untouched (boundary test, mirroring `purgeNotes.test.ts`'s existing boundary-test style).
16. `purgeVersions.ts` never deletes a `Note` row, even when all of that note's `NoteVersion` rows are purged.

## Dependencies

- AB-1004 (Core Note Models) — merged; this ticket builds entirely on the `NoteVersion` model, its `Note` relation, and the snapshot-on-update transaction already shipped there.
- No dependency on AB-1006 (Tags), AB-1007 (Search), or AB-1008 (Sharing) — unrelated domains, though AB-1008's `shares.service.ts` establishes the "ignore trash state for owner-scoped metadata lookups" precedent this ticket extends.
- AB-1015 (Version History Frontend) depends on this ticket for the API contract.

## Open Questions

None — restore-during-trash behavior was resolved with the user before drafting (see Ticket-Specific Decisions: "Owner lookups ignore trash state").
