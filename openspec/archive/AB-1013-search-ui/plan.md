---
ticket: AB-1013
type: FRONTEND
status: APPROVED
---

# AB-1013: Search Frontend — Plan

## Files to Create

- `apps/web/src/hooks/useDebouncedValue.ts` — generic `useDebouncedValue<T>(value: T, delayMs: number): T` hook (mirrors the timer-ref pattern already used in `useMinLoadingTime.ts`).
- `apps/web/src/lib/sanitize.ts` — `sanitizeHeadline(html: string): string`, wraps `DOMPurify.sanitize(html, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] })`.
- `apps/web/src/components/search/SearchPage.tsx` — input, debounce wiring, result list, pagination, loading/empty states.
- `apps/web/src/components/search/SearchResultCard.tsx` — title, sanitized headline (`dangerouslySetInnerHTML`), tag chips, "Updated" timestamp, links to `/notes/$noteId`.
- `apps/web/src/routes/search.tsx` — `/search` route def, `beforeLoad` auth guard copied from `notes.tsx`, renders `<AppShell><SearchPage /></AppShell>`.
- Test files (co-located, matching the project's existing `*.test.ts(x)` convention): `useDebouncedValue.test.ts`, `sanitize.test.ts`, `SearchPage.test.tsx`, `SearchResultCard.test.tsx`.

## Files to Modify

- `apps/web/src/routes/router.tsx` — import and register `searchRoute` in `routeTree`.
- `apps/web/src/components/layout/AppShell.tsx` — add a "Search" `<Link to="/search">` between "Notes" and "Trash"; extend `AppShell.test.tsx`.
- `apps/web/src/lib/notesApi.ts` — add `search({ q, page, pageSize }): Promise<Page<SearchResultItem>>`, same `buildQueryString` helper already used by `listNotes`; extend `notesApi.test.ts`.
- `apps/web/src/lib/notesQueries.ts` — add `notesKeys.search(params)` and `useSearchQuery(params, { enabled })`; extend `notesQueries.test.ts`.
- `apps/web/src/lib/uiCopy.ts` — add `EMPTY_SEARCH_RESULTS` (heading/subtext, no `cta`) and `SEARCH_IDLE_PROMPT` (heading/subtext) keys.
- `apps/web/src/components/notes/EmptyState.tsx` — add a `'no-search-results'` variant (reuses the `Search` icon from `lucide-react`, no CTA button, per `docs/UX.md` §3's search exception); extend `EmptyState.test.tsx`. **Implementation refinement over spec wording**: only the zero-results case routes through `EmptyState`. The "haven't typed a query yet" prompt is a small inline block directly in `SearchPage` (not an `EmptyState` variant) — it isn't really an empty *collection* state, and `EmptyState`'s existing three variants are all genuinely collection-empty states; forcing a fourth non-collection variant in would blur that component's single responsibility. Visible behavior matches spec.md exactly; only the internal wiring differs.
- `apps/web/package.json` — add `dompurify` to `dependencies`.
- `apps/web/src/routes/router.test.tsx` — extend with a `/search` unauthenticated-redirect case, mirroring the existing per-route guard assertions.

## Prisma / Schema Changes

None. This is a frontend-only ticket; `GET /search` (AB-1007) is consumed as-is with no backend changes. No `Note`/`NoteVersion` rows are read or written beyond what AB-1007's existing soft-delete-safe (`deletedAt IS NULL`) query already does.

## New Packages

- `dompurify` — pin to `3.4.12` (current stable at plan time; re-verify against the npm registry at implementation time, same "verify current stable release" caveat spec.md and AB-1012 both use for pinned deps). Ships its own TypeScript types (no separate `@types/dompurify` needed for v3.x).

## Dependencies on Prior Tickets

- **AB-1007 (Search Architecture, merged)** — `GET /search` contract, `SearchResultItem`/`searchQuerySchema` types already exist in `packages/shared/src` (confirmed via graph: `search.controller.ts`'s `toSearchResultResponse`/`toSearchResultPageResponse` already return `SearchResultItem`/`Page<SearchResultItem>`). No changes needed there.
- **AB-1010 (Auth Frontend, merged)** — `authStore`, `apiClient.ts` (401→refresh→retry), `errorMessages.ts`, route-guard pattern reused unchanged.
- **AB-1011 (Notes List Frontend, merged)** — `AppShell`, `Pagination`, `EmptyState` (extended, not replaced), `useMinLoadingTime`, `useTagsQuery`, `notesKeys` reused/extended.
- **AB-1012 (Note Editor Frontend, merged)** — result click-through lands on its real `/notes/:id` page.

## Risk Areas

- **Sanitizer config correctness**: `sanitizeHeadline` must strip everything except `<mark>` with no attributes. Test with a crafted `headline` string containing `<script>`, an `onerror` attribute, and a nested/malformed `<mark>` to confirm DOMPurify actually strips them — not just the happy-path "one clean `<mark>`" case.
- **Debounce timer flakiness in tests**: `useDebouncedValue`/`SearchPage` tests must use `vi.useFakeTimers()` + `vi.advanceTimersByTime(400)` rather than real timers, to avoid flaky CI-less-but-still-local-hook timing issues (matches how `useAutosave.test.ts` already handles its own debounce).
- **Query-key stability**: `useSearchQuery`'s key must use the *debounced* `q`, not the raw input value, or every keystroke would create a distinct (wasted) cache entry even though no request fires for most of them (`enabled` gate only prevents the request, not the key churn) — confirm `SearchPage` passes the debounced value into the key, not the raw `useState` input value.
- **`EmptyState` variant scope creep**: adding a 4th variant risks the component's prop surface becoming a grab-bag. Mitigated by keeping the idle-prompt out of it (see Files to Modify).

## Test Strategy

| Scenario (spec.md) | Test file | Notes |
|---|---|---|
| 1, 6 (empty input → no request, idle prompt) | `SearchPage.test.tsx` | assert no `search()` call while debounced value is empty |
| 2, 5 (debounce settles once, not per keystroke) | `useDebouncedValue.test.ts`, `SearchPage.test.tsx` | fake timers; type multiple chars rapidly, assert one settled value/request |
| 3 (result renders title/headline/tags/timestamp) | `SearchResultCard.test.tsx` | mock `SearchResultItem`, assert sanitized headline markup + tag chip resolution |
| 4 (zero results → EmptyState, no CTA) | `SearchPage.test.tsx`, `EmptyState.test.tsx` | assert `'no-search-results'` variant renders no button |
| 7 (query change resets to page 1) | `SearchPage.test.tsx` | set page to 2, change query, assert next request has `page=1` |
| 8 (pagination re-fetches same query) | `SearchPage.test.tsx` | assert `q` unchanged across a page-change |
| 9 (click navigates to /notes/:id) | `SearchResultCard.test.tsx` | assert `Link` `to`/`params` |
| 10, 11 (server-side scoping) | none new | already covered by AB-1007's integration tests; not re-tested client-side per spec.md's own note |
| 12 (unauthenticated redirect) | `router.test.tsx` | mirrors existing per-route guard assertions |
| 13 (sanitizer strips unexpected tags/attrs) | `sanitize.test.ts` | crafted malicious `headline` input, see Risk Areas |
| `search()` request shape | `notesApi.test.ts` | asserts query-string construction (`q`, `page`, `pageSize`) |
| `useSearchQuery` enabled-gating + key | `notesQueries.test.ts` | asserts `enabled: false` for empty/whitespace `q`, key includes debounced `q`/`page`/`pageSize` |
| AppShell nav link | `AppShell.test.tsx` | assert "Search" link present, `to="/search"` |

Coverage target: ≥80% on all new code (AGENTS.md §10), enforced via the existing Husky pre-commit hook — no new coverage tooling needed.
