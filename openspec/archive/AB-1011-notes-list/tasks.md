---
ticket: AB-1011
status: APPROVED
---

# AB-1011: Notes List Frontend (incl. Trash UI) — Tasks

Plan: `openspec/changes/AB-1011-notes-list/plan.md` (status: APPROVED)

Ordering note: tasks are grouped into phases (Setup → Core Libraries → UI Primitives → List Components → Pages → Routes → Integration Check). Within a phase, `[PARALLEL]` tasks touch disjoint files and have no dependency on each other — they can be worked simultaneously. Tasks without `[PARALLEL]` depend on the task(s) named in "Depends on". No task exceeds 45 minutes, so none are tagged `[SUBAGENT]`.

## Phase 0 — Setup

- [x] **T1.** Add `lucide-react` and `@radix-ui/react-dialog` to `apps/web/package.json` (exact pinned versions, verified via Context7/npm — no `^`/`~`); run install.
  - Files: `apps/web/package.json`, `pnpm-lock.yaml`
  - Scenario refs: none directly (infrastructure for T14, T15, T25 icons/dialog)
  - Time: 10 min
  - Depends on: none

## Phase 1 — Core Libraries (no UI dependencies)

- [x] **T2.** `notesViewStore.ts` — Zustand store: `{ sort, tagIds, page }` + `setSort`/`toggleTag`/`clearTagFilter`/`setPage` actions (each filter/sort action resets `page` to `1`). No `persist` middleware.
  - Files: `apps/web/src/stores/notesViewStore.ts`
  - Scenario refs: 3, 4, 6, 7
  - Time: 20 min · `[PARALLEL]`
  - Depends on: none

- [x] **T3.** `notesViewStore.test.ts` — unit tests for each action, especially that `setSort`/`toggleTag`/`clearTagFilter` reset `page` to `1` and `setPage` leaves `sort`/`tagIds` untouched.
  - Files: `apps/web/src/stores/notesViewStore.test.ts`
  - Scenario refs: 3, 4, 6, 7
  - Time: 15 min
  - Depends on: T2

- [x] **T4.** `noteExcerpt.ts` — client-side TipTap JSON → plain-text walk (mirrors `apps/api/src/lib/tiptap.ts`'s `walk`/`BLOCK_NODE_TYPES` logic exactly) + a `truncate(text, maxLength)` helper for card excerpts.
  - Files: `apps/web/src/lib/noteExcerpt.ts`
  - Scenario refs: 2, 12 (Trash preview shows untruncated text; cards show truncated)
  - Time: 25 min · `[PARALLEL]`
  - Depends on: none

- [x] **T5.** `noteExcerpt.test.ts` — nested paragraph/heading traversal, malformed/non-conforming input yields `''`, `truncate()` boundary cases (exact-length, under-limit, over-limit with ellipsis).
  - Files: `apps/web/src/lib/noteExcerpt.test.ts`
  - Scenario refs: 2, 12
  - Time: 20 min
  - Depends on: T4

- [x] **T6.** `uiCopy.ts` — `UI_COPY` constants: `EMPTY_NOTES_LIST`, `EMPTY_TRASH_BIN`, filtered-empty-state copy, restore-confirm modal copy.
  - Files: `apps/web/src/lib/uiCopy.ts`
  - Scenario refs: 1, 5, 6, 10
  - Time: 10 min · `[PARALLEL]`
  - Depends on: none

- [x] **T7.** `useMinLoadingTime.ts` — hook that keeps a loading boolean `true` for a minimum 200ms even if the underlying condition resolves sooner.
  - Files: `apps/web/src/lib/useMinLoadingTime.ts`
  - Scenario refs: 19
  - Time: 15 min · `[PARALLEL]`
  - Depends on: none

- [x] **T8.** `useMinLoadingTime.test.ts` — fake-timer test asserting the hook stays `true` for the full 200ms window even when the input flips `false` immediately.
  - Files: `apps/web/src/lib/useMinLoadingTime.test.ts`
  - Scenario refs: 19
  - Time: 15 min
  - Depends on: T7

- [x] **T9.** `notesApi.ts` — `listNotes(query)`, `listTrash(pagination)`, `listTags()`, `restoreNote(id)`, each wrapping the existing `apiRequest<T>()` from `apiClient.ts` against `GET /notes`, `GET /notes/trash`, `GET /tags?pageSize=50`, `POST /notes/:id/restore`.
  - Files: `apps/web/src/lib/notesApi.ts`
  - Scenario refs: 5 (tagIds passthrough), 14, 15
  - Time: 25 min · `[PARALLEL]`
  - Depends on: none

- [x] **T10.** `notesApi.test.ts` — mocked-`fetch` tests asserting correct query-string construction (`sort`, comma-joined `tagIds`, `page`/`pageSize`) and correct method/path for `restoreNote`.
  - Files: `apps/web/src/lib/notesApi.test.ts`
  - Scenario refs: 5, 14, 15
  - Time: 20 min
  - Depends on: T9

## Phase 2 — Query Layer

- [x] **T11.** `notesQueries.ts` — TanStack Query hooks: `useNotesListQuery`, `useTagsQuery`, `useTrashListQuery`, `useRestoreNoteMutation`. Centralize query-key construction in a single `notesKeys` helper (`notesKeys.list(params)`, `notesKeys.trash(params)`, `notesKeys.tags()`) so no call site hand-builds a partial key. Restore mutation invalidates by key *prefix* (`['notes']`) on success.
  - Files: `apps/web/src/lib/notesQueries.ts`
  - Scenario refs: 3, 4, 7, 14, 15
  - Time: 30 min
  - Depends on: T9

- [x] **T12.** `notesQueries.test.ts` — mocked restore mutation: success path asserts both `['notes','trash']`- and `['notes','list']`-prefixed caches invalidated; `404 NOTE_NOT_FOUND` path asserts `getErrorMessage` copy surfaced and the trash query still re-invalidated (so a stale row disappears after refetch).
  - Files: `apps/web/src/lib/notesQueries.test.ts`
  - Scenario refs: 14, 15
  - Time: 25 min
  - Depends on: T11

## Phase 3 — UI Primitives

- [x] **T13.** `components/ui/Skeleton.tsx` — plain Tailwind pulsing-div primitive, sized via `className` prop to match `NoteCard` dimensions.
  - Files: `apps/web/src/components/ui/Skeleton.tsx`
  - Scenario refs: 19
  - Time: 10 min · `[PARALLEL]`
  - Depends on: none

- [x] **T14.** `components/ui/Dialog.tsx` — thin wrapper around `@radix-ui/react-dialog` exposing `Dialog`, `DialogContent`, `DialogTitle`, and a `initialFocusRef` prop so callers can force Cancel-button autofocus (per `docs/UX.md` §5); Escape-to-close and overlay-click-to-close enabled by Radix defaults.
  - Files: `apps/web/src/components/ui/Dialog.tsx`
  - Scenario refs: 13, 16
  - Time: 30 min
  - Depends on: T1

## Phase 4 — List Components

- [x] **T15.** `AppShell.tsx` — header with app name, "Notes"/"Trash" nav links (`@tanstack/react-router` `Link`), and a logout button reusing the exact logout call/redirect sequence from the AB-1010 `/notes` placeholder (`authStore.logout()` → clear session regardless of outcome → navigate `/login`).
  - Files: `apps/web/src/components/layout/AppShell.tsx`
  - Scenario refs: 18
  - Time: 25 min · `[PARALLEL]`
  - Depends on: T1

- [x] **T16.** `AppShell.test.tsx` — asserts the logout button calls `authStore.logout()` and navigates to `/login`; asserts Notes/Trash links point to the correct routes. Does not re-test `logout()`'s internal behavior (already covered by AB-1010's `authStore.test.ts`).
  - Files: `apps/web/src/components/layout/AppShell.test.tsx`
  - Scenario refs: 18
  - Time: 15 min
  - Depends on: T15

- [x] **T17.** `NoteCard.tsx` — title, truncated plain-text excerpt (`noteExcerpt.ts`), tag chips resolved from a `tags: TagWithCount[]` prop by `tagIds`, relative timestamp, click-through `Link` to `/notes/:id`.
  - Files: `apps/web/src/components/notes/NoteCard.tsx`
  - Scenario refs: 2, 8
  - Time: 30 min · `[PARALLEL]`
  - Depends on: T4

- [x] **T18.** `NoteCard.test.tsx` — renders excerpt/tags/timestamp correctly; asserts the rendered link target is `/notes/:id` for the given note id.
  - Files: `apps/web/src/components/notes/NoteCard.test.tsx`
  - Scenario refs: 2, 8
  - Time: 20 min
  - Depends on: T17

- [x] **T19.** `TagFilterBar.tsx` — renders each tag as a toggle chip (selected/unselected style via static Tailwind classes); "Clear filters" affordance shown once `tagIds.length > 0`. Reads/writes `notesViewStore`.
  - Files: `apps/web/src/components/notes/TagFilterBar.tsx`
  - Scenario refs: 4, 6
  - Time: 25 min · `[PARALLEL]`
  - Depends on: T2

- [x] **T20.** `TagFilterBar.test.tsx` — clicking a chip calls `toggleTag`; "Clear filters" only renders and only fires `clearTagFilter` when at least one tag is selected.
  - Files: `apps/web/src/components/notes/TagFilterBar.test.tsx`
  - Scenario refs: 4, 6
  - Time: 20 min
  - Depends on: T19

- [x] **T21.** `SortSelect.tsx` — plain `<select>` mapping the four `noteSortSchema` values to labels ("Newest first" default, "Oldest first", "Recently updated", "Least recently updated"); calls `notesViewStore.setSort`.
  - Files: `apps/web/src/components/notes/SortSelect.tsx`
  - Scenario refs: 3
  - Time: 20 min · `[PARALLEL]`
  - Depends on: T2

- [x] **T22.** `SortSelect.test.tsx` — selecting each option calls `setSort` with the correct enum value; default selection matches `createdAt:desc`.
  - Files: `apps/web/src/components/notes/SortSelect.test.tsx`
  - Scenario refs: 3
  - Time: 15 min
  - Depends on: T21

- [x] **T23.** `Pagination.tsx` — prev/next buttons + "Page X of Y" text, driven purely by `page`/`totalPages` props; prev disabled on page 1, next disabled on last page.
  - Files: `apps/web/src/components/notes/Pagination.tsx`
  - Scenario refs: 7
  - Time: 20 min · `[PARALLEL]`
  - Depends on: none

- [x] **T24.** `Pagination.test.tsx` — boundary disabled-state assertions; clicking next/prev calls the provided `onPageChange` with the correct page number.
  - Files: `apps/web/src/components/notes/Pagination.test.tsx`
  - Scenario refs: 7
  - Time: 15 min
  - Depends on: T23

- [x] **T25.** `EmptyState.tsx` — shared component with three variants (`no-notes` + CTA, `no-matches` + Clear-filters action, `empty-trash`), icons from `lucide-react` (`FileText`, `Trash2`), copy from `uiCopy.ts`.
  - Files: `apps/web/src/components/notes/EmptyState.tsx`
  - Scenario refs: 1, 5, 6, 10
  - Time: 20 min · `[PARALLEL]`
  - Depends on: T1, T6

- [x] **T26.** `EmptyState.test.tsx` — each variant renders its correct heading/subtext/action; `no-matches` variant never renders the creation CTA.
  - Files: `apps/web/src/components/notes/EmptyState.test.tsx`
  - Scenario refs: 1, 5, 6, 10
  - Time: 15 min
  - Depends on: T25

- [x] **T27.** `TrashPreviewModal.tsx` — built on `components/ui/Dialog.tsx`; renders title + full (untruncated) plain-text content from a `note` prop (no network call); "Restore" button opens `RestoreConfirmModal`.
  - Files: `apps/web/src/components/notes/TrashPreviewModal.tsx`
  - Scenario refs: 12, 13
  - Time: 25 min
  - Depends on: T14, T4

- [x] **T28.** `TrashPreviewModal.test.tsx` — renders from a note prop with no `fetch`/mock network assertions needed; asserts full untruncated excerpt text; "Restore" click opens the confirm modal.
  - Files: `apps/web/src/components/notes/TrashPreviewModal.test.tsx`
  - Scenario refs: 12, 13
  - Time: 20 min
  - Depends on: T27

- [x] **T29.** `RestoreConfirmModal.tsx` — built on `components/ui/Dialog.tsx`; Cancel button forced-focused via `initialFocusRef`; Restore button calls `useRestoreNoteMutation`, shows loading state (`Loader2` icon) while in flight.
  - Files: `apps/web/src/components/notes/RestoreConfirmModal.tsx`
  - Scenario refs: 13, 14, 15, 16
  - Time: 25 min
  - Depends on: T14, T11, T1

- [x] **T30.** `RestoreConfirmModal.test.tsx` — Cancel is the focused element on open; clicking Cancel closes with zero mutation calls; clicking Restore fires the mutation exactly once and shows the loading state.
  - Files: `apps/web/src/components/notes/RestoreConfirmModal.test.tsx`
  - Scenario refs: 13, 14, 16
  - Time: 20 min
  - Depends on: T29

## Phase 5 — Pages

- [x] **T31.** `NotesListPage.tsx` — composes `useNotesListQuery` + `notesViewStore` + `TagFilterBar` + `SortSelect` + `Pagination` + `NoteCard` (list) + `EmptyState` (0-items branch, filtered vs. unfiltered) + `Skeleton` (loading, gated through `useMinLoadingTime`).
  - Files: `apps/web/src/components/notes/NotesListPage.tsx`
  - Scenario refs: 1, 2, 3, 4, 5, 6, 7, 8, 19
  - Time: 40 min
  - Depends on: T11, T2, T13, T17, T19, T21, T23, T25

- [x] **T32.** `NotesListPage.test.tsx` — mocked query responses covering: empty state, populated state with skeleton-then-content transition, filter/sort/page interactions re-triggering the query with the expected params.
  - Files: `apps/web/src/components/notes/NotesListPage.test.tsx`
  - Scenario refs: 1, 2, 3, 4, 5, 6, 7, 19
  - Time: 30 min
  - Depends on: T31

- [x] **T33.** `TrashListPage.tsx` — composes `useTrashListQuery` + local `useState` page + `EmptyState` (`empty-trash` variant) + `Skeleton` + read-only Trash item rows + `TrashPreviewModal` (opened via local "selected note id" state, fed from already-fetched page data).
  - Files: `apps/web/src/components/notes/TrashListPage.tsx`
  - Scenario refs: 10, 11, 12
  - Time: 35 min
  - Depends on: T11, T25, T13, T27, T29

- [x] **T34.** `TrashListPage.test.tsx` — empty-bin render; populated render with no edit affordances present; clicking a row opens the preview modal with that row's data (no extra network call); full restore flow (confirm → success → row removed) and the 404-race path (confirm → error toast → list refetched).
  - Files: `apps/web/src/components/notes/TrashListPage.test.tsx`
  - Scenario refs: 10, 11, 12, 14, 15
  - Time: 25 min
  - Depends on: T33

## Phase 6 — Routes

- [x] **T35.** Replace `apps/web/src/routes/notes.tsx` — renders `<AppShell><NotesListPage /></AppShell>`; `beforeLoad` guard (redirect `/login` if unauthenticated) preserved verbatim from the AB-1010 placeholder.
  - Files: `apps/web/src/routes/notes.tsx`
  - Scenario refs: 17
  - Time: 15 min
  - Depends on: T15, T31

- [x] **T36.** `notes.trash.tsx` — new route `/notes/trash`, same `beforeLoad` guard pattern as `notes.tsx`, renders `<AppShell><TrashListPage /></AppShell>`.
  - Files: `apps/web/src/routes/notes.trash.tsx`
  - Scenario refs: 10, 11, 17
  - Time: 15 min · `[PARALLEL]`
  - Depends on: T15, T33

- [x] **T37.** `notes.$noteId.tsx` — placeholder route `/notes/:id`: same guard pattern, fetches `GET /notes/:id` via `notesApi.ts`, renders title + plain-text excerpt read-only inside `AppShell`. Explicitly documented in-file as a throwaway stub superseded by AB-1012.
  - Files: `apps/web/src/routes/notes.$noteId.tsx`
  - Scenario refs: 8, 17
  - Time: 25 min · `[PARALLEL]`
  - Depends on: T15, T9, T4

- [x] **T38.** `notes.new.tsx` — placeholder route `/notes/new`: same guard pattern, static "Note editor coming soon" stub inside `AppShell`. Explicitly documented as throwaway.
  - Files: `apps/web/src/routes/notes.new.tsx`
  - Scenario refs: 9, 17
  - Time: 10 min · `[PARALLEL]`
  - Depends on: T15

- [x] **T39.** Update `apps/web/src/routes/router.tsx` — register `notesTrashRoute`, `noteDetailRoute`, `noteNewRoute` as additional `rootRoute` children alongside the existing `notesRoute`.
  - Files: `apps/web/src/routes/router.tsx`
  - Scenario refs: 17
  - Time: 15 min
  - Depends on: T35, T36, T37, T38

- [x] **T40.** Extend `apps/web/src/routes/router.test.tsx` — guard coverage for `/notes/trash`, `/notes/:id`, `/notes/new` (unauthenticated → redirect `/login`), parameterized the same way the existing `/notes` guard test already is.
  - Files: `apps/web/src/routes/router.test.tsx`
  - Scenario refs: 17
  - Time: 25 min
  - Depends on: T39

## Phase 7 — Integration Check

- [x] **T41.** Inspect `apps/web/e2e/smoke.spec.ts`: if it asserts anything about the `/notes` placeholder's specific markup, update it to match the new list page (or the `/login` redirect it already asserts at `/`, per AB-1010's plan, may mean no change is needed — confirm rather than assume). Also manually verify in a running browser: `RestoreConfirmModal`'s Cancel-button autofocus and `Dialog`'s Escape-to-close behavior (jsdom assertions in T30 cover focus programmatically, but a real-browser keyboard check closes the loop per the `/verify` skill's spirit).
  - Files: `apps/web/e2e/smoke.spec.ts` (maybe), no other files
  - Scenario refs: 13, 16, 17 (manual confirmation only)
  - Time: 20 min
  - Depends on: T39, T29

---

**Total estimated time:** ~13.5 hours across 41 tasks. Phases 1 and 3–4's `[PARALLEL]`-tagged tasks can be distributed across contributors/subagents concurrently within their phase; no single task exceeds 45 minutes so none require `[SUBAGENT]` decomposition.

Before every commit (per CLAUDE.md): `pnpm build`, `pnpm lint --max-warnings 0`, `pnpm test` must all be green.
