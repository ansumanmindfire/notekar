---
ticket: AB-1007
status: APPROVED
---

# AB-1007: Search Architecture — Technical Plan

## Files to Create/Modify

### `packages/shared` (single source of truth — edit first, everything else imports from here)

| File | Change |
|---|---|
| `packages/shared/src/schemas.ts` | Add `searchQuerySchema = paginationQuerySchema.extend({ q: z.string().trim().min(1, 'Search query is required') })`. Export inferred type `SearchQuery`. Reuses the existing `paginationQuerySchema` untouched (no new pagination defaults). |
| `packages/shared/src/types.ts` | Add `SearchResultItem { note: Note; headline: string }` interface, reusing the existing `Note` and `Page<T>` types (`Page<SearchResultItem>` is the endpoint's response type — no new page-shape wrapper needed). |
| `packages/shared/src/schemas.test.ts` | Add unit tests for `searchQuerySchema`: valid `q`, missing `q`, empty string, whitespace-only string (trimmed to empty), `q` combined with `page`/`pageSize` overrides, default `page`/`pageSize` when omitted. |

### `apps/api/prisma`

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | No new model or field declared (Prisma cannot model a `STORED GENERATED` `tsvector` column). Add a comment on the `Note` model, mirroring the existing `Tag` case-insensitive-index comment, documenting that `searchVector` exists at the database level only and is queried exclusively via raw SQL in `search.service.ts`. |
| `apps/api/prisma/migrations/<ts>_note_search_vector/migration.sql` | Hand-written `--create-only` migration (`prisma migrate dev --create-only --name note_search_vector`, then edit the generated empty file): adds the generated `searchVector` column and `note_search_idx` GIN index exactly as specified in `spec.md` § Data Model. Applied to both `notes_dev` and `notes_test` (SDS §2.2/§18), same dual-database flow as every prior ticket. |

### `apps/api/src` — Search (new vertical slice, routes → controllers → services)

| File | Change |
|---|---|
| `apps/api/src/services/search.service.ts` | New. `searchNotes(prisma, userId, query: SearchQuery): Promise<Page<{ note: NoteWithTags; headline: string }>>`. Runs two parameterized raw queries via `prisma.$queryRaw` + `Prisma.sql` tagged templates (never string concatenation): (1) a `SELECT id, ts_headline(...) AS headline, ts_rank(...) AS rank FROM "Note" WHERE "userId" = $1 AND "deletedAt" IS NULL AND "searchVector" @@ plainto_tsquery('english', $2) ORDER BY rank DESC LIMIT $3 OFFSET $4` for the page of matching IDs + headlines + ranks, and (2) a `SELECT count(*)` with the same `WHERE` clause (no `ORDER BY`/`LIMIT`) for `totalItems`. Matched note IDs are then re-fetched via `prisma.note.findMany({ where: { id: { in: ids } }, include: TAGS_INCLUDE })` (reusing the exact `NoteWithTags` shape `notes.service.ts` already produces) so the controller's existing `toNoteResponse` mapper can be reused unchanged; results are re-ordered in application code to match the rank order from query (1), since `findMany({ where: { id: { in } } })` does not preserve input-array order. |
| `apps/api/src/services/search.service.test.ts` | New. Unit tests, Prisma mocked (`$queryRaw`, `note.findMany` mocked directly) — covers pagination math, rank-order reassembly, empty-result handling, and that the raw query is invoked with a `Prisma.sql`/tagged-template value (not a plain string) as a lightweight injection-safety regression guard. |
| `apps/api/src/controllers/search.controller.ts` | New. `search(req, res, next)`: `searchQuerySchema.parse(req.query)` → `searchNotes(prisma, req.userId!, query)` → maps each item to `{ note: toNoteResponse(item.note), headline: item.headline }` (imports `toNoteResponse` from `notes.controller.ts`, exported for reuse — see below) → `res.status(200).json(page)`. |
| `apps/api/src/controllers/search.controller.test.ts` | New. Mirrors `tags.controller.test.ts`/`notes.controller.test.ts` conventions: validation-error passthrough (missing `q` → next(ZodError)), successful mapping of a service result to the response shape. |
| `apps/api/src/routes/search.router.ts` | New. `requireAuth(env.JWT_SECRET)` mounted, single route: `router.get('/', controller.search)`. |
| `apps/api/src/routes/search.integration.test.ts` | New. Supertest against the real `notes_test` database (SDS §14) — the only tier that can prove `tsvector`/GIN/`plainto_tsquery`/`ts_rank`/`ts_headline` actually behave as expected; a mocked Prisma client cannot simulate real Postgres text-search matching or ranking. |
| `apps/api/src/routes/index.ts` | Modify. Add `router.use('/search', createSearchRouter(env));` alongside the existing `/notes`/`/tags` mounts. |

### `apps/api/src` — Notes (export existing mapper for reuse, no behavior change)

| File | Change |
|---|---|
| `apps/api/src/controllers/notes.controller.ts` | Export `toNoteResponse` (currently a private function) and its `PrismaNote` type alias, so `search.controller.ts` can reuse the identical note-shape mapping instead of duplicating it (AGENTS.md §11 — no duplicated logic/types). No behavior change to any existing `notes.controller.ts` route handler. |

## Prisma Schema Changes

No new Prisma model or field. `Note` gains a **database-only** generated column and index, added via raw SQL only — not declared in `schema.prisma`, following the exact precedent set by AB-1006's `tag_user_name_ci_idx` (also undeclared in the Prisma schema):

```sql
-- --create-only migration; Prisma cannot model a STORED generated column.
ALTER TABLE "Note"
  ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce(title, '') || ' ' || coalesce("bodyText", ''))
  ) STORED;

CREATE INDEX "note_search_idx" ON "Note" USING GIN ("searchVector");
```

- **No physical deletes of `Note` or `NoteVersion` rows anywhere in this ticket.** This migration only adds a column and an index — no new foreign keys, no `CASCADE DELETE`, no change to any existing soft-delete path (`softDeleteNote`, `restoreNote`, `purgeNotes.ts` are all untouched).
- One migration, applied to both `DATABASE_URL` (`notes_dev`) and `TEST_DATABASE_URL` (`notes_test`) — same migration file run twice (SDS §2.2/§18), same as the AB-1006 tag ci-index migration.

## New Packages

None. `@prisma/client`/`prisma` (`6.19.3`) already support `$queryRaw`/`Prisma.sql` tagged templates; Postgres's built-in `english` text search configuration (`to_tsvector`, `plainto_tsquery`, `ts_rank`, `ts_headline`) requires no extension or new dependency. No `package.json` changes in this ticket.

## Dependencies on Prior Tickets

- **AB-1004 (Core Note Models)** — merged. This ticket adds a generated column on top of the existing `Note.title`/`Note.bodyText` columns; `bodyText`'s sync-on-write behavior (Prisma middleware / `extractPlainText`) is reused completely unchanged — it was built in AB-1004 with this exact ticket in mind (see the comment in `apps/api/src/lib/tiptap.ts`).
- **AB-1006 (Tags Architecture)** — merged. This ticket's `note` result field includes `tagIds`, reusing `notes.service.ts`'s existing `TAGS_INCLUDE`/`NoteWithTags` pattern and `notes.controller.ts`'s `toNoteResponse` mapper as-is.
- **AB-1002 (Core User & Auth Models)** — merged. `middleware/auth.ts` (`requireAuth`) is reused unmodified on the new `/search` router, same as `/notes`/`/tags`.
- No dependency on AB-1008 (Sharing) or AB-1009 (Version History) — unrelated domains, confirmed in spec.

## Risk Areas

1. **Raw SQL must be parameterized, never string-concatenated.** `search.service.ts` is the third raw-SQL exception in this codebase (alongside the tag ci-index and the AB-1008 view-count increment). Every dynamic value (`userId`, `q`, `page`/`pageSize`-derived offsets) must go through `Prisma.sql`/`$queryRaw` tagged-template placeholders. Mitigated by the unit test explicitly asserting the query is built via `Prisma.sql`, and by never interpolating `q` into a template string.
2. **`searchVector` is undeclared in `schema.prisma`, same as the AB-1006 ci-index precedent.** Since Prisma's migrate-dev diffing is driven by the migration history rather than live DB introspection against the datamodel, this is not expected to cause drift — but it must be verified once, immediately after this migration is applied: run `prisma migrate status` (expect "up to date," no drift reported) and confirm a subsequent unrelated `prisma migrate dev` (e.g. for a later ticket) does not propose dropping `searchVector`/`note_search_idx`.
3. **Result re-ordering after the ID re-fetch.** `prisma.note.findMany({ where: { id: { in: ids } } })` does not guarantee it returns rows in the same order as the `ids` array (rank order from the raw query). The service must explicitly re-sort the `findMany` result to match the original rank-ordered `ids` array — easy to silently get wrong (e.g. relying on Postgres's incidental physical row order), so covered explicitly by a unit test with results returned out of order by the mock.
4. **`plainto_tsquery` on an all-stopword query (e.g. `q=the`) yields an empty tsquery**, which matches zero rows. This is expected native Postgres behavior (per spec's Non-Goals — no custom stemming/synonym handling) and requires no special-case code, but should be covered by an integration test so it's a known, intentional `200` + empty page rather than a surprise during `/implement`.
5. **JSON column round-tripping through `$queryRaw`.** The raw query only ever selects `id`/`headline`/`rank` (not `body`) — the full `Note` (including `body: Json`) is always re-fetched through the normal (non-raw) Prisma client via `findMany`, exactly like every other endpoint, so there is no risk of `body` being returned as an unparsed string from the raw query path. This constraint should be called out during `/implement` so nobody "optimizes" the raw query to also select `body` directly.
6. **`ts_headline`'s `StartSel`/`StopSel` option string must be passed as a single parameterized argument, not built via string interpolation of `q`**, to avoid any possibility of the search term breaking the options-string syntax. The options string itself (`'StartSel=<mark>, StopSel=</mark>, MaxWords=35, MinWords=15, MaxFragments=2'`) is a fixed literal, never derived from user input.

## Test Strategy

| Spec Scenario # | Behavior | Test File | Tier |
|---|---|---|---|
| 1–2 | Keyword match in title-only / body-only, headline contains `<mark>` | `search.integration.test.ts` | Integration |
| 3 | Multi-word phrase, `plainto_tsquery` tokenization | `search.integration.test.ts` | Integration |
| 4–5 | Scoping: other user's note excluded, caller's own soft-deleted note excluded | `search.service.test.ts` (mocked `WHERE` construction), `search.integration.test.ts` (real scoping) | Unit + Integration |
| 6 | No matches → empty page | `search.service.test.ts`, `search.integration.test.ts` | Unit + Integration |
| 7 | Relevance ordering (`ts_rank` descending) between two matches of differing strength | `search.integration.test.ts` | Integration |
| 8–9 | Missing / empty / whitespace-only `q` → `400 VALIDATION_FAILED` | `packages/shared/src/schemas.test.ts` (schema-level), `search.controller.test.ts` (controller passthrough) | Unit |
| 10–11 | Invalid / default `page`/`pageSize` | `packages/shared/src/schemas.test.ts`, `search.controller.test.ts` | Unit |
| 12 | `note.tagIds` present and correct on each result | `search.service.test.ts` (mocked `TAGS_INCLUDE` fetch), `search.integration.test.ts` (real tag association) | Unit + Integration |
| 13 | No/invalid access token → `401 AUTH_TOKEN_INVALID` | `search.integration.test.ts` (reuses the existing `requireAuth` behavior already covered by `notes.integration.test.ts`'s equivalent case) | Integration |
| 14 | Migration creates `searchVector`/`note_search_idx` in both databases | `search.integration.test.ts` (implicitly, by every search query succeeding against real Postgres) | Integration |
| 15 | `searchVector` auto-recomputes on note title/body update | `search.integration.test.ts` (update a note via the real `/notes` API, then search for new content) | Integration |

Coverage gate (≥80% on new code, AGENTS.md §10) applies to every new/modified file above, enforced locally via the Husky pre-commit hook — no CI in this project (FRS §11).
