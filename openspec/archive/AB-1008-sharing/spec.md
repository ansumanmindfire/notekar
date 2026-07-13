---
ticket: AB-1008
type: BACKEND
status: APPROVED
---

# AB-1008: Sharing Architecture

## Overview

Implements public, read-only share links for notes: generate a link with an expiry (1–30 days, default 7), revoke it, view it unauthenticated with an atomically-incremented view count, and list a note's full share history (active + revoked) as the owner. Builds the `ShareLink` model the SDS already reserves for this ticket (SDS §3) and the atomic view-count raw-SQL statement it specifies (SDS §11).

## Goals

- New `ShareLink` Prisma model (SDS §3) plus a `shares ShareLink[]` back-relation added to `Note`.
- `POST /notes/:id/shares` — owner creates a share link for one of their own **active** notes. Optional `expiresAt` (ISO datetime, 1–30 days from now); defaults to now + 7 days if omitted.
- `DELETE /notes/:id/shares/:token` — owner revokes a share link (idempotent).
- `GET /notes/:id/shares` — owner lists all share links ever created for a note, newest first, including revoked ones.
- `GET /public/shares/:token` — unauthenticated. Returns note title/body/viewCount/sharedAt if the link is valid (not revoked, not expired, parent note not soft-deleted), atomically incrementing `viewCount` in the same query. Rate-limited 60 req/min per IP+token pair.
- Two new error codes: `SHARE_NOT_FOUND` (404) and `GONE_LINK_INVALID` (410).

## Non-Goals

- No frontend share modal/UI — that is AB-1014 (Sharing Frontend). This ticket only needs `shareUrl` to be a well-formed link a future frontend page can render; the `/shares/:token` frontend route itself does not need to exist yet.
- No email delivery of share links — out of scope project-wide (FRS §1.2, "actual email sending").
- No per-link view-count reset, analytics, or geographic tracking — only a running total (FR-SHARE-3).
- No change to how Trash/restore or version history behave — a restored note's still-valid share links become viewable again automatically as a side effect of the existing `deletedAt IS NULL` check, with no new code required for that.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-SHARE-1 | Generate Share Link — optional 1–30 day expiry, defaults to 7 days; >30 days rejected |
| FR-SHARE-2 | Revoke Share Link — immediate, idempotent |
| FR-SHARE-3 | Public Link Access & View Counts — unauthenticated read, atomic view-count increment, link dies with its note's soft-delete |
| FR-SHARE-4 | List Share Links for a Note — owner-only, includes revoked links, newest first |

Soft-delete rule (AGENTS.md §6, §11): `ShareLink` rows are never physically deleted by application code — revoke only sets `revokedAt`. The only physical deletion of a `ShareLink` row happens as a `CASCADE` side effect of the `purgeNotes.ts` job hard-deleting its parent `Note` (SDS §18), which is the same purge job that already hard-deletes `NoteTag`/`NoteVersion` rows — no new physical-deletion path is introduced by this ticket.

## API Contract

- `POST /notes/:id/shares` (auth required)
  - Body: `{ expiresAt?: string }` (ISO 8601 datetime)
  - `201 { token, shareUrl, expiresAt, viewCount }`
  - `400 VALIDATION_FAILED` — `expiresAt` present but not 1–30 days from now, or malformed
  - `404 NOTE_NOT_FOUND` — note doesn't exist, isn't owned by the caller, or is soft-deleted
- `DELETE /notes/:id/shares/:token` (auth required, owner only)
  - `204` — revoked (or already revoked — idempotent)
  - `404 SHARE_NOT_FOUND` — no share link with that token exists for that note/owner
- `GET /notes/:id/shares` (auth required, owner only)
  - `200 [{ id, token, shareUrl, expiresAt, revokedAt, viewCount, createdAt }]` — newest first, includes revoked links
  - `404 NOTE_NOT_FOUND` — note doesn't exist or isn't owned by the caller (trash state does not matter here)
- `GET /public/shares/:token` (no auth)
  - `200 { title, body, viewCount, sharedAt }` — `viewCount` reflects the increment from *this* request
  - `410 GONE_LINK_INVALID` — token doesn't exist, is revoked, is expired, or its parent note is soft-deleted
  - `429 RATE_LIMITED` — more than 60 requests/min for the same IP+token pair

## Data Model

```prisma
model ShareLink {
  id        String    @id @default(cuid())
  noteId    String
  token     String    @unique // 32-char URL-safe, generated via crypto.randomBytes
  expiresAt DateTime
  revokedAt DateTime?
  viewCount Int       @default(0)
  createdAt DateTime  @default(now())

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId])
}
```

- `Note` gains a `shares ShareLink[]` back-relation (additive; no change to existing `Note` columns or indexes).
- `onDelete: Cascade` on `ShareLink.note` mirrors the existing `NoteTag`/`NoteVersion` cascade pattern: it only ever fires when `purgeNotes.ts` physically deletes a `Note` row (SDS §18) — it never bypasses the application-layer soft-delete rule, since nothing in this ticket issues a hard delete on `Note` itself.
- View-count increment uses the exact atomic raw-SQL statement from SDS §11 (`Prisma.sql`/`$queryRaw`, parameterized) — never a read-then-write `findFirst` + `update`, to avoid a race under concurrent public views:

```sql
UPDATE "ShareLink" sl
SET "viewCount" = sl."viewCount" + 1
FROM "Note" n
WHERE sl.token = $1
  AND sl."revokedAt" IS NULL
  AND sl."expiresAt" > now()
  AND sl."noteId" = n.id
  AND n."deletedAt" IS NULL
RETURNING sl.*;
```

If this statement returns no row, the service throws `410 GONE_LINK_INVALID`.

## Ticket-Specific Decisions

- **`shareUrl` target (resolved with user):** `${WEB_ORIGIN}/shares/:token` — a frontend route, not the backend's own `/public/shares/:token` path. `WEB_ORIGIN` is already a validated required env var (`apps/api/src/lib/env.ts`); no new env var is introduced.
- **Rate limiting (resolved with user):** included in this ticket, not deferred. `GET /public/shares/:token` gets its own `createRateLimiter` instance with a custom `keyGenerator` combining `req.ip` and `req.params.token` (default express-rate-limit keys by IP alone, which would under-limit a single popular link and over-limit unrelated links from a shared/NAT'd IP).
- **Router structure (resolved with user):** new `shares.router.ts` (`Router({ mergeParams: true })`) mounted inside `notes.router.ts` at `/:id/shares`, inheriting the parent's `router.use(requireAuth(...))` — no duplicate auth wiring. A new, separate `public.router.ts` (no `requireAuth`) is mounted at `/public/shares` in `routes/index.ts`, alongside `/auth`, `/notes`, `/tags`, `/search`.
- **Create requires an active note (owner default):** `POST /notes/:id/shares` looks up the note the same way `getNote`/`updateNote` do (`{ id, userId, deletedAt: null }`) — a caller cannot generate a *new* share link for a note currently in Trash. `404 NOTE_NOT_FOUND` if it's missing, unowned, or soft-deleted.
- **List/revoke ignore trash state (owner default):** `GET /notes/:id/shares` and `DELETE /notes/:id/shares/:token` look up the note by `{ id, userId }` only (no `deletedAt` filter), so an owner can still review or revoke a note's share history during its 30-day Trash recovery window — mirroring FR-VER-1's "version history must remain accessible even if the note is currently in the 30-day soft-delete window."
- **Revoke idempotency (owner default):** re-revoking an already-revoked link returns `204` rather than an error (setting `revokedAt` again is a no-op), consistent with the existing idempotent-logout precedent (AGENTS.md §7). `404 SHARE_NOT_FOUND` is reserved for a token that doesn't exist or doesn't belong to that note/owner.
- **`expiresAt` request field (resolved with user, per SDS §4 literal contract):** the client sends an absolute ISO 8601 datetime, not a day count. The service validates it falls between `now()` and `now() + 30 days` inclusive (a value at or before `now()`, or beyond 30 days out, is `400 VALIDATION_FAILED`); the FRS's "1 to 30 days" business rule is expressed as this range check rather than a separate `expiresInDays` field. Omitted → server computes `now() + 7 days`.
- **Token generation:** `crypto.randomBytes(24).toString('base64url')` (32 URL-safe characters, matching SDS §3's "32-char URL-safe" comment). No collision-retry loop is added — the collision probability is astronomically small and the `@unique` constraint would surface a `P2002` if it ever happened, which is an acceptable `500 INTERNAL_ERROR` for a case that cannot realistically occur (AGENTS.md's guidance against handling scenarios that can't happen).

## Scenarios

1. Owner creates a share link for their own active note with no `expiresAt` → `201`, `expiresAt` is ~7 days from now, `viewCount: 0`.
2. Owner creates a share link with `expiresAt` 14 days out → `201`, link valid for 14 days.
3. Owner attempts `expiresAt` more than 30 days out → `400 VALIDATION_FAILED`.
4. Owner attempts `expiresAt` in the past or equal to now → `400 VALIDATION_FAILED`.
5. Owner attempts to create a share link for a note they don't own → `404 NOTE_NOT_FOUND`.
6. Owner attempts to create a share link for their own soft-deleted (trashed) note → `404 NOTE_NOT_FOUND`.
7. Owner revokes an active share link → `204`; subsequent public view of that token → `410 GONE_LINK_INVALID`.
8. Owner revokes an already-revoked link → `204` (idempotent), not an error.
9. Owner attempts to revoke a token that doesn't belong to their note → `404 SHARE_NOT_FOUND`.
10. External (unauthenticated) user visits a valid, unexpired, unrevoked link → `200` with note title/body/viewCount/sharedAt; `viewCount` is one higher than before the request.
11. Two concurrent public views of the same valid link → both increment atomically; final `viewCount` reflects both (no lost update) — verified via integration test against real Postgres (SDS §14).
12. External user visits an expired link → `410 GONE_LINK_INVALID`.
13. External user visits a revoked link → `410 GONE_LINK_INVALID`.
14. External user visits a valid link whose parent note has since been soft-deleted → `410 GONE_LINK_INVALID`.
15. A note's share link becomes viewable again after the note is restored from Trash within its recovery window, provided the link itself hasn't separately expired or been revoked — no extra code path, a side effect of the `deletedAt IS NULL` check re-evaluating true.
16. Owner lists share links for a note that has both active and revoked links → all are returned, newest first, `revokedAt` populated only for the revoked ones.
17. Owner lists share links for a note currently in Trash (within the 30-day window) → list still returns successfully (owner-scoped lookup ignores `deletedAt`).
18. Non-owner requests `GET /notes/:id/shares` for a note they don't own → `404 NOTE_NOT_FOUND`.
19. A single IP exceeds 60 requests/min against the same share token → `429 RATE_LIMITED`; requests against a *different* token from the same IP are unaffected.
20. Request to any owner-facing endpoint (`POST`/`DELETE`/`GET` under `/notes/:id/shares`) with no/invalid access token → `401 AUTH_TOKEN_INVALID`.

## Dependencies

- AB-1004 (Core Note Models) — merged; this ticket's `ShareLink.note` relation and all note-ownership/soft-delete lookups reuse the existing `Note` model and its `requireAuth` middleware wiring unchanged.
- No dependency on AB-1006 (Tags) or AB-1007 (Search) — unrelated domains.
- AB-1014 (Sharing Frontend) depends on this ticket for the API contract and the `shareUrl` shape.

## Open Questions

None — `shareUrl` target, rate-limiting scope, router structure, and trash-state handling for create vs. list/revoke were all resolved with the user before drafting; see Ticket-Specific Decisions.
