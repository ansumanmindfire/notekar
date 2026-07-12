---
ticket: AB-1005
type: BACKEND
status: APPROVED
---

# AB-1005: Notes List & Filtering

## Overview

Extends the `GET /notes` endpoint shipped in AB-1004 with a `sort` query parameter, letting callers order their active notes by creation date or last-updated date, ascending or descending. This ticket does **not** add tag filtering (FR-NOTE-6) despite the FRS tracing it here — the `Tag`/`NoteTag` models don't exist yet (that's AB-1006, a parallel sibling ticket per the dependency map, not yet built). Resolved with user: defer `tagIds` entirely to AB-1006 rather than pre-scaffolding tag models ahead of their owning ticket, matching the phased-relation precedent already used between AB-1002/1003 and AB-1004/1006.

## Goals

- `GET /notes` gains an optional `sort` query parameter: `createdAt:asc`, `createdAt:desc`, `updatedAt:asc`, `updatedAt:desc`. Default remains `createdAt:desc` (unchanged from AB-1004, matches FRS "newest first" default).
- New Zod schema `listNotesQuerySchema` in `packages/shared/src/schemas.ts`, extending the existing `paginationQuerySchema` with the `sort` field. `GET /notes` uses the new schema; `GET /notes/trash` continues using plain `paginationQuerySchema` unchanged.
- `notes.service.ts`'s `listNotes` parses the `sort` value into a Prisma `orderBy` clause (`{ createdAt: 'asc' | 'desc' }` or `{ updatedAt: 'asc' | 'desc' }`).
- Migration adds `@@index([userId, updatedAt])` to the `Note` model — deliberately deferred by AB-1004 to land alongside the feature that needs it — applied to both `notes_dev` and `notes_test` (SDS §2.2/§18).

## Non-Goals

- No `Tag`/`NoteTag` Prisma models, no `tagIds` query parameter, no tag-filter logic — entirely deferred to AB-1006 (resolved with user). Any `tagIds` value sent on `GET /notes` in this ticket is silently ignored (Zod strips unrecognized keys by default) rather than rejected — same non-strict behavior as `paginationQuerySchema` today.
- No `sort` parameter added to `GET /notes/trash` — Trash keeps its fixed `deletedAt desc` order per FR-NOTE-7 ("same mechanism as the active notes list" refers to the pagination envelope, not sort semantics, which FR-NOTE-7 never mentions).
- No changes to `POST /notes`, `GET /notes/:id`, `PATCH /notes/:id`, `DELETE /notes/:id`, or `POST /notes/:id/restore` — unaffected by this ticket.
- No frontend work — AB-1011 (Notes List Frontend) consumes this contract.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-NOTE-5 | Pagination and Sorting — `GET /notes` paginates (unchanged from AB-1004) and now supports sort by `createdAt`/`updatedAt`, ascending or descending, default newest-first |
| FR-NOTE-6 | Filter Notes by Tags — **not covered in this ticket**; deferred to AB-1006 per the Tags Architecture ticket, which will extend this same `GET /notes` endpoint with `tagIds` (AND semantics) without breaking this ticket's contract |

Soft-delete rule (AGENTS.md §6, §11): unaffected — this ticket only changes read-path ordering on an already-soft-delete-scoped query (`deletedAt: null`); no delete/update logic is touched.

## API Contract

All endpoints require `Authorization: Bearer <accessToken>` (unchanged).

- `GET /notes`
  - Query: `?page=1&pageSize=10&sort=createdAt:desc` (all optional)
    - `page`: integer ≥ 1, default `1`
    - `pageSize`: integer 1–50, default `10`
    - `sort`: one of `createdAt:asc | createdAt:desc | updatedAt:asc | updatedAt:desc`, default `createdAt:desc`
  - `200 Page<Note>` — only non-deleted notes, ordered per `sort`
  - `400 VALIDATION_FAILED` — invalid `page`, `pageSize`, or `sort` value
  - No `tagIds` parameter (Non-Goal; AB-1006)
- `GET /notes/trash` — unchanged from AB-1004: `?page=1&pageSize=10`, fixed `deletedAt desc` order, no `sort` parameter.

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
  @@index([userId, updatedAt])   // NEW — supports sort=updatedAt:*
}
```

- Standard Prisma migration (`prisma migrate dev`), no raw SQL needed.
- No `CASCADE DELETE` changes — untouched.
- Migration applied to both `DATABASE_URL` (`notes_dev`) and `TEST_DATABASE_URL` (`notes_test`) per SDS §2.2/§18.

## Ticket-Specific Decisions

- **Tags deferred entirely to AB-1006** (resolved with user): despite FR-NOTE-6 being traced to AB-1005 in the FRS traceability matrix, the Tag/NoteTag models are AB-1006's scope and don't exist yet. Rather than pulling that schema work forward, this ticket ships sort-only and leaves `tagIds` for AB-1006 to add as a pure extension of this same endpoint.
- **Separate query schema instead of extending `paginationQuerySchema` in place**: `listNotesQuerySchema = paginationQuerySchema.extend({ sort: ... })` is a new schema used only by `GET /notes`. `GET /notes/trash` keeps using the original `paginationQuerySchema`, so Trash's contract and behavior stay byte-for-byte identical to AB-1004 — no risk of a `sort` param silently doing nothing (or worse, being misread as meaningful) on the Trash endpoint.
- **Sort value shape**: single combined string (`field:direction`) rather than two separate params (`sortBy`/`sortDir`), matching the exact format already documented in SDS §4 (`sort=createdAt:desc`).

## Scenarios

1. `GET /notes` with no query params → `200`, default order unchanged (`createdAt desc`), same as AB-1004 behavior.
2. `GET /notes?sort=createdAt:asc` → `200`, oldest-created note first.
3. `GET /notes?sort=updatedAt:desc` → `200`, most-recently-updated note first.
4. `GET /notes?sort=updatedAt:asc` → `200`, least-recently-updated note first.
5. `GET /notes?sort=title:desc` (or any value outside the fixed enum) → `400 VALIDATION_FAILED`.
6. `GET /notes?tagIds=abc` → `200`, `tagIds` silently ignored, results unaffected (Non-Goal; not an error in this ticket).
7. `GET /notes?sort=updatedAt:desc&page=2&pageSize=5` → `200`, sort and pagination compose correctly across pages.
8. `GET /notes/trash` (with or without a stray `sort` query param) → `200`, unaffected, still fixed `deletedAt desc` — confirms Trash's contract is untouched by this ticket.
9. Migration run → `@@index([userId, updatedAt])` exists on `Note` in both `notes_dev` and `notes_test`.

## Dependencies

- AB-1004 (Core Note Models) — merged; this ticket extends its `GET /notes` handler/service/schema without changing existing callers' behavior.
- No dependency on AB-1006 (Tags Architecture) — explicitly deferred, not blocking.

## Open Questions

None — the tag-filtering scope conflict was resolved with the user before drafting (see Non-Goals and Ticket-Specific Decisions).
