---
ticket: AB-1013
type: FRONTEND
status: APPROVED
---

# AB-1013: Search Frontend

## Overview

Implements the real `/search` page: a debounced live-search box over the user's active notes, consuming AB-1007's already-merged `GET /search` contract (`Page<{ note: Note, headline: string }>`). This is the first ticket in the app to actually render server-produced HTML via `dangerouslySetInnerHTML` — the `<mark>`-wrapped `headline` string AB-1007 produces via `ts_headline` — so it is also the ticket that introduces `dompurify` as a runtime dependency and the app's first real DOMPurify call site (AGENTS.md §11, SDS §5).

Three scope questions were resolved with the user before drafting:

1. **Search is debounced live search-as-you-type** (~400ms after the last keystroke), not explicit-submit-only — consistent with the app's existing debounce precedent (`useAutosave`, AB-1012's 2000ms) applied at a shorter interval appropriate to a read-only query rather than a save.
2. **`/search` is a dedicated route with a persistent nav link** in `AppShell` (alongside "Notes" and "Trash"), matching SDS §1's literal route list — not a Cmd/Ctrl+K-only overlay.
3. **Clicking a result navigates to `/notes/:id`** (AB-1012's real editor/view page) — no separate read-only search-result preview component. AB-1012's page already owns 404/soft-delete handling for a single note.

## Goals

- Add `dompurify` as a new runtime dependency (exact pinned version per AGENTS.md §3 — verify current stable release at implementation time, same pattern already used for `@tiptap/*` in AB-1012).
- Add `/search` route + nav link:
  - `AppShell`: new "Search" link between "Notes" and "Trash".
  - `routes/search.tsx`: same `beforeLoad` auth-guard pattern as every other authenticated route (redirect to `/login` if `authStore.status !== 'authenticated'`).
- `SearchPage`: a search `<input>` (autofocused on mount, `aria-label="Search notes"`) plus a results list.
  - `useDebouncedValue(query, 400)` hook (new, generic) debounces the raw input value before it's used as the query key/param.
  - No request fires while the debounced, trimmed value is empty — matches `searchQuerySchema`'s `q` min-length-1 requirement and avoids a `400 VALIDATION_FAILED` round trip on page load or after clearing the box.
  - Page resets to `1` whenever the debounced query value changes (new search = new result set, not a continuation of the previous one).
- `useSearchQuery({ q, page, pageSize })` (new, `notesQueries.ts`) → `GET /search`, `enabled: q.trim().length > 0`.
- `search()` (new, `notesApi.ts`) → thin wrapper over `apiRequest<Page<SearchResultItem>>('/search?...')`, mirroring `listNotes`'s query-string-building approach.
- `SearchResultCard`: renders `note.title` (plain text, same as `NoteCard`), the sanitized `headline` (via `dangerouslySetInnerHTML`, see Ticket-Specific UX Decisions), resolved tag chips (same lookup technique as `NoteCard`: filter the `useTagsQuery()` cache by `note.tagIds`), and an "Updated" relative timestamp. Clicking navigates to `/notes/$noteId`.
- `sanitizeHeadline(html: string): string` (new, `lib/sanitize.ts`) — wraps `DOMPurify.sanitize(html, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] })`. This is the only sanitization helper in the app so far; it's written generically enough (an `allowedTags` param) that later tickets (share view, version compare) can reuse it if they render server/editor HTML through `dangerouslySetInnerHTML`, though wiring those call sites is out of scope here.
- Loading state: `Skeleton` result cards matching `SearchResultCard` dimensions while a search is in flight, held for the existing 200ms minimum (`useMinLoadingTime`, reused from AB-1011) to prevent flicker.
- Empty states via the existing `EmptyState` component:
  - No query typed yet (debounced value empty): a quiet prompt ("Search your notes" / "Find notes by title or content."), no skeleton, no request.
  - Query typed, zero results: new `UI_COPY.EMPTY_SEARCH_RESULTS` key, **no primary action button** — per `docs/UX.md` §3's already-documented Search exception (the active input is itself the recovery path).
- Pagination: reuses the existing `Pagination` component, driven by the `Page<SearchResultItem>` envelope.

## Non-Goals

- No title-match highlighting — AB-1007 only highlights within the body-derived `headline`; the client does not attempt to additionally highlight matches inside `note.title` (consistent with AB-1007's own Non-Goals).
- No sort control, tag-filter, or any other query parameter beyond `q`/`page`/`pageSize` — `GET /search` accepts none, and FR-SEARCH-1/2 don't ask for any.
- No search history, recent-searches list, or query persistence across navigations/reloads — closing/reopening `/search` starts with an empty box.
- No keyboard-shortcut launcher (Cmd/Ctrl+K) — resolved with user; see Overview point 2.
- No separate read-only preview for a result — resolved with user; see Overview point 3.
- No backend changes — AB-1007's `GET /search` contract is treated as fixed and consumed as-is.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-SEARCH-1 | Full-Text Search (frontend) — debounced `/search` page over the caller's active notes, paginated |
| FR-SEARCH-2 | Search Highlights (frontend) — sanitized `<mark>`-highlighted excerpt per result |
| FR-UI-1 (partial) | Skeleton loading states, minimum display timer, and the search-specific empty states for this page |

## Pages / Components

```
apps/web/src/
  routes/
    search.tsx              NEW: /search route + auth guard, same pattern as notes.tsx
    router.tsx                updated route tree registration
  components/
    layout/
      AppShell.tsx           EXTENDED: "Search" nav link added between Notes and Trash
    search/
      SearchPage.tsx          NEW: input + results list + pagination + empty/loading states
      SearchResultCard.tsx    NEW: title + sanitized headline + tag chips + timestamp, links to /notes/:id
  hooks/
    useDebouncedValue.ts      NEW: generic debounce hook (value, delayMs) -> debounced value
  lib/
    notesApi.ts               EXTENDED: search({ q, page, pageSize }) -> GET /search
    notesQueries.ts            EXTENDED: useSearchQuery
    sanitize.ts                NEW: sanitizeHeadline() wrapping DOMPurify.sanitize
    uiCopy.ts                  EXTENDED: EMPTY_SEARCH_RESULTS, EMPTY_SEARCH_PROMPT copy keys
```

- `router.tsx` registers the new `searchRoute` alongside the existing routes; the guard pattern (`beforeLoad` redirect to `/login`) is copied unchanged from `notes.tsx`.

## State Management

- No new Zustand store. The raw input value and current page are component-local `useState` inside `SearchPage` — there's no cross-route persistence requirement (unlike `notesViewStore`'s sort/filter, which AB-1011 deliberately kept alive across navigations), and a search session is inherently ephemeral per FRS/SDS.
- `TanStack Query`: `useSearchQuery` keyed as `['search', q, page, pageSize]` (debounced/trimmed `q`), per `docs/UX.md` §7's rule that every list/filter hook include all query tokens in its key. `enabled: q.trim().length > 0` so an empty query never issues a request or occupies cache space. `useTagsQuery()` (AB-1011) is reused unchanged for `SearchResultCard`'s tag-chip lookup.

## API Integration

`lib/notesApi.ts` gains one function, wrapping the existing `apiRequest<T>()` (`apiClient.ts`, unchanged — its 401→refresh→retry interceptor applies here with no new logic):

- `search({ q, page, pageSize }) → Page<SearchResultItem>` — `GET /search?q=...&page=...&pageSize=...`.

Error handling, via the existing `ApiRequestError`/`errorMessages.ts` pipeline:
- `400 VALIDATION_FAILED` — not expected in normal operation since the client never queries with an empty/whitespace-only `q` (`enabled` gate), but if it occurs anyway (e.g. a future edge case) it surfaces as a toast rather than a broken page.
- `401 AUTH_TOKEN_INVALID` — handled transparently by the existing interceptor; no new logic.

## Ticket-Specific UX Decisions

- **DOMPurify is required here, for the first time in the app** (AGENTS.md §11 / SDS §5 / AB-1007's explicit note): `headline` is server-produced HTML (`<mark>` tags around matched terms via `ts_headline`), and `SearchResultCard` is the only place in the entire frontend so far that needs `dangerouslySetInnerHTML`. `sanitizeHeadline()` restricts the allow-list to exactly `<mark>` with no attributes (`ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: []`) — tighter than a generic rich-text allow-list, since `ts_headline`'s only possible output tags are its configured `StartSel`/`StopSel` plus escaped plain text.
- **400ms debounce, not the 2000ms editor-autosave debounce**: search is a read-only, cheap, idempotent query (not a write with a version-history side effect like autosave), so a much shorter delay is appropriate for a responsive live-search feel while still avoiding a request per keystroke.
- **Empty-query state is not the same component state as zero-results**: `EmptyState`'s existing "no results" treatment (`docs/UX.md` §3's Search exception, no CTA) is reserved for "searched, found nothing." Before any query is typed, `SearchPage` shows a distinct, quieter prompt so a user who has just opened the page doesn't see "no results" language before they've typed anything.
- **Timestamp shown is always "Updated"**: unlike `NoteCard` (which mirrors the active sort field, since `/notes` has an explicit sort control), search results are ordered by relevance with no date-sort control, so there's no "active sort field" to mirror — `updatedAt` is picked as the more generally useful of the two.

## Scenarios

1. User navigates to `/search` with an empty input → no request fires; a quiet "Search your notes" prompt renders; no skeleton.
2. User types a query → after ~400ms of no further typing, `GET /search?q=...` fires; skeleton result cards render for at least 200ms while in flight.
3. Search returns one or more matches → each result shows the note's title, a sanitized excerpt with matched terms visually marked, resolved tag chips, and an "Updated" relative timestamp.
4. Search returns zero matches for a non-empty query → `EmptyState` shows the "no notes match your search" copy with no primary action button (the input is already the recovery path).
5. User keeps typing before the debounce window elapses → only the final settled value triggers a request; no intermediate keystroke fires its own request.
6. User clears the input back to empty → the results list clears, the "not yet searched" prompt reappears, no request fires for the empty value.
7. User is on page 2 of results and changes the query → the debounced new query fires a fresh request at `page=1`, not page 2.
8. User navigates between result pages via `Pagination` → the same (unchanged) query re-fetches the requested page.
9. User clicks a result card → navigates to `/notes/$noteId`, landing on AB-1012's real editor/view page for that note.
10. A search keyword exists only in another user's note → never appears (server-side scoping, unchanged from AB-1007; nothing new to verify client-side beyond "not rendered").
11. A search keyword exists only in a soft-deleted (trashed) note of the caller's own → never appears (server-side scoping, unchanged from AB-1007).
12. Unauthenticated user navigates directly to `/search` → redirected to `/login` (existing route-guard pattern, applied here identically).
13. The `headline` HTML contains a matched term wrapped in `<mark>` → rendered with the term visually highlighted; any non-`<mark>` tag or attribute the sanitizer wouldn't expect (defense-in-depth, not expected from `ts_headline` in practice) is stripped before render.

## Dependencies

- AB-1007 (Search Architecture) — merged; this ticket consumes `GET /search`'s `Page<{ note: Note, headline: string }>` contract as-is, including the explicit hand-off note that AB-1013 owns sanitizing `headline` before render.
- AB-1010 (Auth Frontend) — merged; `authStore`, `apiClient.ts`, `errorMessages.ts`, and the route-guard pattern reused unchanged.
- AB-1011 (Notes List Frontend) — merged; `AppShell`, `Pagination`, `EmptyState`, `useMinLoadingTime`, `useTagsQuery`, and the tag-chip-resolution technique from `NoteCard` are reused unchanged.
- AB-1012 (Note Editor Frontend) — merged; a result click navigates into its real `/notes/:id` page (no longer the AB-1011 placeholder).
- New runtime dependency: `dompurify` (exact pinned version, added to `apps/web/package.json`).

## Open Questions

None — debounce-vs-submit search triggering, the `/search` route's entry point, and result click-through behavior were all resolved with the user before drafting; see Overview.
