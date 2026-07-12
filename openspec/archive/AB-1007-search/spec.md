---
ticket: AB-1007
type: BACKEND
status: APPROVED
---

# AB-1007: Search Architecture

## Overview

Implements full-text search across a user's active notes (title + body), with relevance-ranked, paginated results and highlighted excerpts. Built on the Postgres `tsvector`/GIN infrastructure the SDS reserves specifically for this ticket (SDS §9, §18) — `Note.bodyText` (kept in sync via Prisma middleware since AB-1004) already exists precisely to feed this feature, per the comment in `apps/api/src/lib/tiptap.ts` ("feeding `Note.bodyText` for future search (AB-1007)").

## Goals

- New generated `searchVector` `tsvector` column on `Note`, computed from `title` + `bodyText`, backed by a GIN index — added via a hand-written `--create-only` raw SQL migration (Prisma cannot model generated columns), applied to both `notes_dev` and `notes_test` (SDS §2.2, §18).
- `GET /search`: `?q=<query>&page=1&pageSize=10` → `200 Page<{ note: Note, headline: string }>`.
  - `q` is required, trimmed, min 1 non-whitespace character; missing/empty/whitespace-only → `400 VALIDATION_FAILED`.
  - Reuses the existing shared `paginationQuerySchema` (default `page=1`, `pageSize=10`, max `50`) — same convention as every other list endpoint.
  - Scoped to the caller's own **active** (non-deleted) notes only.
- Query path: `plainto_tsquery('english', :q)` matched against `searchVector`, via raw SQL (`$queryRaw`/`Prisma.sql`, parameterized — never string-concatenated) since Prisma cannot express `tsvector` operators.
- Results ordered by relevance: `ts_rank(searchVector, plainto_tsquery(...))` descending.
- `headline: string` per result, generated via `ts_headline('english', bodyText, plainto_tsquery(...), 'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2')` — matched terms wrapped in `<mark>` tags (FR-SEARCH-2). This is raw HTML; the frontend (AB-1013) **must** pass it through DOMPurify before rendering, same as every other rich-text surface (AGENTS.md §11) — noted here since this ticket is the producer of that HTML.
- Each result's `note` is the full shared `Note` object (same shape as every other notes endpoint — `id, title, body, tagIds, version, createdAt, updatedAt, deletedAt`), including `tagIds` resolved the same way `notes.service.ts` does today (join against `NoteTag`).

## Non-Goals

- No search-term highlighting within the note `title` field itself — only the body-derived `headline` is highlighted server-side. A client that wants to visually mark a title match may do so itself against the plain-text `note.title` and the same `q`.
- No fuzzy/typo-tolerant matching, stemming configuration beyond Postgres's built-in `english` text search configuration, or synonym support.
- No search across Trash (soft-deleted notes) or other users' notes — FR-SEARCH-1 scopes this to "active notes" only.
- No frontend search page/component — that is AB-1013 (Search Frontend).
- No new error codes — `VALIDATION_FAILED` (empty/missing `q`) and `AUTH_TOKEN_INVALID` (missing/invalid token) already exist and fully cover this endpoint's failure modes.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-SEARCH-1 | Full-Text Search — keyword search across title + body of active notes, paginated |
| FR-SEARCH-2 | Search Highlights — excerpt with matched terms visually marked (`<mark>`) via `ts_headline` |

Soft-delete rule (AGENTS.md §6, §11): search only ever queries `Note` rows with `deletedAt IS NULL`; no `Note` row is read, written, or deleted by this ticket beyond the additive `searchVector` column. No `CASCADE DELETE` is introduced — the migration adds a generated column and an index only, no new foreign keys.

## API Contract

All endpoints require `Authorization: Bearer <accessToken>` (`middleware/auth.ts`).

- `GET /search`
  - Query: `?q=<string>&page=1&pageSize=10` (`q` required, trimmed, min length 1; `page`/`pageSize` reuse `paginationQuerySchema`)
  - `200 Page<{ note: Note, headline: string }>` — ordered by relevance (`ts_rank` descending)
  - `400 VALIDATION_FAILED` (missing/empty/whitespace-only `q`, or invalid `page`/`pageSize`)
  - `401 AUTH_TOKEN_INVALID` (missing or invalid access token)

## Data Model

No new Prisma models. `Note` gains a database-only generated column, added via raw SQL (not represented as a Prisma-managed field, same treatment as the AB-1006 tag case-insensitive index):

```sql
-- --create-only migration; Prisma cannot model a STORED generated column.
ALTER TABLE "Note"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce("bodyText", ''))
  ) STORED;

CREATE INDEX "note_search_idx" ON "Note" USING GIN ("searchVector");
```

- `searchVector` is never read or written through the Prisma client's normal query API — it is queried exclusively via `$queryRaw`/`Prisma.sql` in `search.service.ts`, parameterized to prevent SQL injection (mirrors the existing atomic view-count raw-SQL precedent planned for AB-1008, and the tag case-insensitive index precedent from AB-1006).
- Because it's a `STORED GENERATED` column, Postgres recomputes it automatically on every `INSERT`/`UPDATE` of `title`/`bodyText` — no application-code sync is needed beyond what AB-1004 already does to keep `bodyText` current.
- Applied to both `notes_dev` (`DATABASE_URL`) and `notes_test` (`TEST_DATABASE_URL`) — same migration file run twice (SDS §2.2, §18).

## Ticket-Specific Decisions

- **Relevance ranking (resolved with user):** results are ordered by `ts_rank(searchVector, plainto_tsquery(...))` descending, not by recency. This is a new sort dimension (search is not sortable by the caller — no `sort` query param, unlike `GET /notes`).
- **Result shape (resolved with user):** `note` is the full shared `Note` object, identical to every other notes endpoint (including full TipTap `body` JSON and `tagIds`), rather than a search-specific trimmed summary. Consistency with the rest of the API outweighs the marginally heavier payload.
- **Highlight scope (resolved with user):** exactly one `headline: string` field per result, built from `bodyText` only. Title-match highlighting is not computed server-side; the SDS §4 literal response shape (`{ note, headline }`) is followed as-is rather than adding a second highlighted field.
- **Empty/missing `q` (resolved with user):** rejected with `400 VALIDATION_FAILED`, consistent with how every other required string field in `packages/shared/src/schemas.ts` (e.g. `titleSchema`, `tagNameSchema`) is validated — not silently treated as a zero-result search.
- **`ts_headline` tuning:** `StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2` is a starting configuration to implement against; exact word/fragment counts may be tuned during `/plan` or `/implement` without constituting a contract change, since they only affect the *content* of the `headline` string, not its type or the endpoint's shape.
- **Route mount point:** `GET /search` is mounted top-level (new `search.router.ts`, wired in `routes/index.ts` alongside `/notes` and `/tags`), matching the SDS §4 literal path and the repository layout's `routes/search.router.ts` (AGENTS.md §2) — not nested under `/notes`.

## Scenarios

1. Search for a keyword present only in a note's title → note is returned.
2. Search for a keyword present only in a note's body → note is returned, `headline` shows the matching excerpt with `<mark>` around the term.
3. Search for a multi-word phrase → notes matching the query terms (via `plainto_tsquery` tokenization) are returned.
4. Search for a keyword that exists only in another user's note → not returned (scoped by `userId`).
5. Search for a keyword that exists only in the caller's own soft-deleted (trashed) note → not returned (`deletedAt IS NULL` filter).
6. Search for a keyword matching no notes → `200` with an empty `items` array, `totalItems: 0`.
7. Two notes both match; one is a stronger match (more/denser occurrences) → the stronger match is ordered first (`ts_rank` descending).
8. Missing `q` param → `400 VALIDATION_FAILED`.
9. `q` present but empty string or whitespace-only → `400 VALIDATION_FAILED`.
10. `page`/`pageSize` outside allowed bounds (e.g. `pageSize=0` or `pageSize=51`) → `400 VALIDATION_FAILED`.
11. Default pagination (`page`/`pageSize` omitted) → `page=1, pageSize=10` applied.
12. Each result's `note.tagIds` reflects the note's current tag associations, consistent with `GET /notes`.
13. Request with no/invalid access token → `401 AUTH_TOKEN_INVALID`.
14. Migration applied → `searchVector` generated column and `note_search_idx` GIN index exist on `Note` in both `notes_dev` and `notes_test`; verified via integration test since this is Postgres-only behavior no mock can prove (SDS §14).
15. A note's `title`/`body` is updated → `searchVector` (STORED generated column) reflects the new content automatically on the next search, with no extra application code.

## Dependencies

- AB-1004 (Core Note Models) — merged; this ticket adds a generated column on top of the existing `Note.title`/`Note.bodyText` columns and reuses `bodyText`'s existing sync-on-write behavior unchanged.
- AB-1006 (Tags Architecture) — merged; this ticket's `note` result field includes `tagIds`, consistent with the shared `Note` type AB-1006 established.
- No dependency on AB-1008 (Sharing) or AB-1009 (Version History) — unrelated domains.

## Open Questions

None — ranking order, result shape, highlight scope, and empty-query handling were all resolved with the user before drafting; see Ticket-Specific Decisions.
