---
ticket: AB-1013
type: FRONTEND
status: APPROVED
---

# AB-1013: Search Frontend — Tasks

- [x] **1. Add `dompurify` runtime dependency** (10 min)
  Pin `dompurify` to `3.4.12` (re-verify current stable at implementation time) in `apps/web/package.json`; run `pnpm install`.
  Files: `apps/web/package.json`, `pnpm-lock.yaml`.
  Satisfies: prerequisite for Task 3 (no scenario directly).

- [x] **2. `useDebouncedValue` hook + tests** [PARALLEL] (20 min)
  Generic `useDebouncedValue<T>(value, delayMs)`, timer-ref pattern mirroring `useMinLoadingTime.ts`. Tests use `vi.useFakeTimers()`.
  Files: `apps/web/src/hooks/useDebouncedValue.ts`, `apps/web/src/hooks/useDebouncedValue.test.ts`.
  Satisfies: Scenario 5 (debounce settles once, not per keystroke).

- [x] **3. `sanitizeHeadline` helper + tests** (25 min, depends on Task 1)
  `DOMPurify.sanitize(html, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] })`. Tests include a crafted malicious `headline` (`<script>`, `onerror`, malformed `<mark>`) to prove stripping, not just the clean-input case.
  Files: `apps/web/src/lib/sanitize.ts`, `apps/web/src/lib/sanitize.test.ts`.
  Satisfies: Scenario 13.

- [x] **4. `search()` API function + tests** [PARALLEL] (20 min)
  `search({ q, page, pageSize }): Promise<Page<SearchResultItem>>` in `notesApi.ts`, reusing the existing `buildQueryString` helper.
  Files: `apps/web/src/lib/notesApi.ts`, `apps/web/src/lib/notesApi.test.ts`.
  Satisfies: prerequisite for Task 5 (query-string-shape assertions, no scenario ID directly).

- [x] **5. `useSearchQuery` hook + tests** (20 min, depends on Task 4)
  `notesKeys.search(params)` + `useSearchQuery(params, { enabled })` in `notesQueries.ts`, keyed on `['search', q, page, pageSize]`, `enabled: q.trim().length > 0`.
  Files: `apps/web/src/lib/notesQueries.ts`, `apps/web/src/lib/notesQueries.test.ts`.
  Satisfies: prerequisite for Scenario 1/6 (enabled-gating), no request for empty `q`.

- [x] **6. `uiCopy.ts` search copy keys** [PARALLEL] (10 min)
  Add `EMPTY_SEARCH_RESULTS` (heading/subtext, no `cta`) and `SEARCH_IDLE_PROMPT` (heading/subtext).
  Files: `apps/web/src/lib/uiCopy.ts`.
  Satisfies: prerequisite for Task 7 and Task 10 (no scenario ID directly — copy content only).

- [x] **7. `EmptyState` `'no-search-results'` variant + tests** (20 min, depends on Task 6)
  New variant: `Search` icon (`lucide-react`), `EMPTY_SEARCH_RESULTS` copy, no CTA button.
  Files: `apps/web/src/components/notes/EmptyState.tsx`, `apps/web/src/components/notes/EmptyState.test.tsx`.
  Satisfies: Scenario 4 (zero results → no primary action button).

- [x] **8. `AppShell` "Search" nav link + tests** [PARALLEL] (10 min)
  Add `<Link to="/search">Search</Link>` between "Notes" and "Trash".
  Files: `apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/components/layout/AppShell.test.tsx`.
  Satisfies: navigation entry point (Overview point 2, no scenario ID directly).

- [x] **9. `SearchResultCard` component + tests** (30 min, depends on Task 3)
  Title (plain text), sanitized headline via `dangerouslySetInnerHTML`, tag chips resolved from `useTagsQuery()` cache by `note.tagIds` (same technique as `NoteCard`), "Updated" relative timestamp, links to `/notes/$noteId`.
  Files: `apps/web/src/components/search/SearchResultCard.tsx`, `apps/web/src/components/search/SearchResultCard.test.tsx`.
  Satisfies: Scenarios 3, 9.

- [x] **10. `SearchPage` component + tests** (40 min, depends on Tasks 2, 3, 5, 7, 9)
  Search input (autofocus, `aria-label="Search notes"`), wires `useDebouncedValue` → `useSearchQuery`, page resets to `1` on debounced-query change, idle prompt (`SEARCH_IDLE_PROMPT`, inline — not an `EmptyState` variant) when debounced value is empty, `Skeleton` loading via `useMinLoadingTime`, `EmptyState variant="no-search-results"` on zero results, `Pagination` on results.
  Files: `apps/web/src/components/search/SearchPage.tsx`, `apps/web/src/components/search/SearchPage.test.tsx`.
  Satisfies: Scenarios 1, 2, 4, 5, 6, 7, 8.

- [x] **11. `/search` route definition** (10 min, depends on Task 10)
  `beforeLoad` auth guard copied from `notes.tsx`; renders `<AppShell><SearchPage /></AppShell>`.
  Files: `apps/web/src/routes/search.tsx`.
  Satisfies: prerequisite for Scenario 12.

- [x] **12. Register `/search` route + guard test** (15 min, depends on Task 11)
  Import and add `searchRoute` to `routeTree` in `router.tsx`; extend `router.test.tsx` with an unauthenticated-redirect-to-`/login` case for `/search`.
  Files: `apps/web/src/routes/router.tsx`, `apps/web/src/routes/router.test.tsx`.
  Satisfies: Scenario 12.

- [x] **13. Quality gate checkpoint** (15 min, depends on all above)
  Run `pnpm build` (0 errors), `pnpm lint --max-warnings 0`, `pnpm test` (all green), confirm ≥80% coverage on all new files (AGENTS.md §10).
  Files: none (verification only).
  Satisfies: non-negotiable gate per CLAUDE.md — no scenario ID (cross-cutting).
