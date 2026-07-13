---
ticket: AB-1011
type: FRONTEND
status: APPROVED
---

# AB-1011: Notes List Frontend (incl. Trash UI)

## Overview

Implements the real `/notes` list — replacing the AB-1010 placeholder wholesale — plus the dedicated `/notes/trash` view. Covers pagination, sort (FR-NOTE-5), tag-filter chips (FR-NOTE-6), and the full Trash/restore experience (FR-NOTE-7, FR-NOTE-8, FR-UI-5). Also introduces the first real app shell (header + nav), since AB-1010 explicitly deferred that ("a real shell arrives with AB-1011/AB-1012").

Three scope questions were resolved with the user before drafting:

1. **Tag filtering is in scope for this ticket.** AB-1006 (Tags backend, including the `GET /notes?tagIds=` AND-filter) is already merged, even though the FRS's literal ticket-dependency table only lists AB-1005/AB-1010 as this ticket's dependencies. Rather than leaving FR-NOTE-6's frontend half dangling until some later ticket, this ticket consumes AB-1006's already-shipped contract directly.
2. **Note content preview is plain-text extraction only, not rich HTML rendering.** The API returns only the full TipTap JSON `body` (no plain-text field is exposed to the client — `bodyText` is server-internal, search-only). AB-1012 (the real editor/renderer) hasn't shipped. This ticket walks the TipTap JSON client-side into a truncated plain-text excerpt, rendered as an ordinary React text node — never `dangerouslySetInnerHTML`, so DOMPurify does not apply here (see Ticket-Specific UX Decisions).
3. **Placeholder `/notes/:id` and `/notes/new` routes are added now.** Same precedent AB-1010 used for `/notes` itself: minimal read-only/stub pages that AB-1012 wholesale-replaces with the real editor, so the list stays fully clickable and "New Note" has somewhere to go.

## Goals

- Replace the AB-1010 `/notes` placeholder with the real notes list page: paginated, sortable, tag-filterable, with skeleton loading and empty states per `docs/UX.md`.
- Add `/notes/trash`: paginated list of the user's soft-deleted notes, newest-deleted first, with a read-only preview and a confirm-before-restore flow.
- Add a minimal `AppShell` (header: app name, "Notes"/"Trash" nav links, logout button) wrapping all authenticated note routes, reusing the logout logic already built for the AB-1010 placeholder.
- Add placeholder `/notes/:id` (read-only stub showing title + excerpt) and `/notes/new` (stub page) routes, explicitly documented as throwaway — AB-1012 replaces both wholesale.
- `notesViewStore` (Zustand): holds the active list's `sort`, selected `tagIds` filter, and current `page` — ephemeral client UI state, not persisted to any storage, reset on hard reload (consistent with `authStore`'s no-`persist` pattern).
- TanStack Query hooks (in `lib/notesQueries.ts`, built on new `lib/notesApi.ts` fetch functions that wrap the existing `apiClient.ts`):
  - `useNotesListQuery({ sort, tagIds, page, pageSize })` → `GET /notes`
  - `useTagsQuery()` → `GET /tags` (fetched once at a fixed `pageSize=50`, the API's max, for the filter bar — see Ticket-Specific UX Decisions)
  - `useTrashListQuery({ page, pageSize })` → `GET /notes/trash`
  - `useRestoreNoteMutation()` → `POST /notes/:id/restore`, invalidates both the trash and active-list query caches on success
- `NoteCard`: title, truncated plain-text excerpt, resolved tag chips (name + fixed palette color, looked up from the `useTagsQuery()` cache by `tagIds`), relative "updated"/"created" timestamp matching the active sort field, click-through to `/notes/:id`.
- `TagFilterBar`: renders every tag as a toggle chip; selecting one or more filters the list with AND semantics (FR-NOTE-6); a "Clear filters" affordance appears once at least one tag is selected.
- `SortSelect`: dropdown mapping directly to the four `noteSortSchema` values (`createdAt:desc` default/"Newest first", `createdAt:asc`/"Oldest first", `updatedAt:desc`/"Recently updated", `updatedAt:asc`/"Least recently updated").
- `Pagination`: simple prev/next + "Page X of Y" control, driven by the `Page<T>` envelope's `page`/`totalPages`.
- `EmptyState`: shared component per `docs/UX.md` §3 — distinct copy for "no notes at all" (with a "Create your first note" CTA linking to `/notes/new`) vs. "no notes match the selected tags" (no creation CTA; a "Clear filters" action instead, mirroring the Search no-results exception already documented in UX.md §3) vs. "Trash is empty".
- `TrashPreviewModal`: read-only preview of a soft-deleted note's title + full plain-text content, opened from a Trash list item using the data already present in the `GET /notes/trash` response (never navigates to `/notes/:id`, since `GET /notes/:id` 404s for soft-deleted notes — see Ticket-Specific UX Decisions). Includes a "Restore" button that opens `RestoreConfirmModal`.
- `RestoreConfirmModal`: confirmation modal per FR-UI-5 before dispatching `POST /notes/:id/restore`; Cancel is the default-focused button (per `docs/UX.md` §5), Restore is the primary action (not styled destructive — see Ticket-Specific UX Decisions).
- `UI_COPY` constants (new `apps/web/src/lib/uiCopy.ts`) for the empty-state and confirmation copy referenced by `docs/UX.md` (`EMPTY_NOTES_LIST`, `EMPTY_TRASH_BIN`, plus new keys for the filtered-empty and restore-confirm states this ticket introduces).
- Loading states: `Skeleton` cards matching `NoteCard` dimensions while a list query is in flight, held for a minimum 200ms (`useMinLoadingTime` hook) to prevent flicker, per `docs/UX.md` §1.

## Non-Goals

- No note creation, editing, or the real rich-text editor — `/notes/new` and `/notes/:id` are throwaway stubs; AB-1012 owns the real editor.
- No rich-text/HTML rendering of note bodies anywhere in this ticket (list-card excerpts and the Trash preview are both plain-text extractions rendered as ordinary text nodes) — resolved with user; see Overview point 2. AB-1012/AB-1015 own real formatted rendering.
- No search UI (`/search`) — AB-1013.
- No sharing UI — AB-1014.
- No version history UI — AB-1015.
- No tag creation/edit/delete UI (a full Tag management page/color picker) — this ticket only *consumes* `GET /tags` read-only for filter chips. Tag CRUD UI, if it needs a dedicated surface beyond AB-1012's on-the-fly editor tagging (FR-UI-3), is not scoped here.
- No user-configurable page size — fixed at `pageSize=10` for both the active list and Trash, matching the backend default; not exposed as a control in this ticket.
- No permanent-delete-from-Trash UI — the FRS defines no such action (Trash items are only restored or left to auto-purge after 30 days); nothing in FR-NOTE-7/8 asks for one.
- No backend changes — AB-1005/AB-1006 contracts are treated as fixed and consumed as-is.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-NOTE-5 | Pagination and Sorting (frontend) — `SortSelect` + `Pagination`, default newest-first |
| FR-NOTE-6 | Filter Notes by Tags (frontend) — `TagFilterBar`, AND semantics, consuming AB-1006's already-shipped `GET /notes?tagIds=` |
| FR-NOTE-7 | View Trash (frontend) — `/notes/trash` page, paginated, newest-deleted first, read-only `TrashPreviewModal` |
| FR-NOTE-8 | Restore Soft-Deleted Note (frontend) — restore action wired to `POST /notes/:id/restore`, list/trash caches invalidated on success |
| FR-UI-1 (partial) | Skeleton loading states, minimum display timer, empty states for the notes list and Trash |
| FR-UI-5 | Trash & Restore UX — dedicated functioning Trash view (not a placeholder), read-only preview, confirm-before-restore modal |

## Pages / Components

```
apps/web/src/
  routes/
    notes.tsx             REPLACED: real notes list page + route def (guard unchanged from AB-1010)
    notes.trash.tsx        NEW: /notes/trash route + page
    notes.$noteId.tsx       NEW: /notes/:id — placeholder read-only stub (throwaway, AB-1012 replaces)
    notes.new.tsx           NEW: /notes/new — placeholder stub (throwaway, AB-1012 replaces)
    router.tsx              updated route tree registration
  components/
    layout/
      AppShell.tsx          header + nav ("Notes", "Trash") + logout button, wraps all authenticated note routes
    notes/
      NotesListPage.tsx
      NoteCard.tsx
      TagFilterBar.tsx
      SortSelect.tsx
      Pagination.tsx
      EmptyState.tsx
      TrashListPage.tsx
      TrashPreviewModal.tsx
      RestoreConfirmModal.tsx
  stores/
    notesViewStore.ts
  lib/
    notesApi.ts             raw fetch functions (listNotes, listTags, listTrash, restoreNote) built on apiClient.ts
    notesQueries.ts          TanStack Query hooks wrapping notesApi.ts
    noteExcerpt.ts           TipTap JSON -> truncated plain-text extraction (client-side mirror of apps/api/src/lib/tiptap.ts's approach; independent implementation, no cross-package import since apps/api isn't a dependency of apps/web)
    uiCopy.ts                UI_COPY constants (empty states, restore confirm)
    useMinLoadingTime.ts     hook enforcing a >=200ms minimum loading-state display
```

- `App.tsx`/`router.tsx` register the three new routes; `notes.tsx`'s existing `beforeLoad` guard (redirect to `/login` if unauthenticated) is preserved unchanged and applied to `notes.trash.tsx`, `notes.$noteId.tsx`, and `notes.new.tsx` as well.
- `AppShell` is rendered by each authenticated route's component (not a separate parent route in the router tree, to keep the route-guard pattern from AB-1010 — `beforeLoad` per leaf route — unchanged).

## State Management

- `notesViewStore` (Zustand, no `persist` middleware, mirrors `authStore`'s in-memory-only pattern):
  - State: `{ sort: NoteSort; tagIds: string[]; page: number }`. `pageSize` is a module constant (`10`), not store state.
  - Actions: `setSort(sort)` (resets `page` to `1`), `toggleTag(tagId)` (adds/removes from `tagIds`, resets `page` to `1`), `clearTagFilter()` (resets `page` to `1`), `setPage(page)`.
  - Scoped to the active notes list only; Trash's pagination is separate local `useState` inside `TrashListPage` (no sort/filter controls exist for Trash, so a shared store would be pure overhead).
- `TanStack Query` (server state, per `docs/UX.md` §7): every list query key includes all filter tokens — `['notes', 'list', sort, tagIds, page, pageSize]` and `['notes', 'trash', page, pageSize]` — for strict server-side refetching on any filter/sort/page change. `['tags', 'list']` cached with a longer `staleTime` since the filter bar's tag catalog changes infrequently relative to notes.
- No new client state for the Trash preview modal beyond a component-local "currently previewed note id" `useState` in `TrashListPage` — the preview reads directly from the already-fetched `GET /notes/trash` page data already sitting in the query cache; no separate fetch.

## API Integration

`lib/notesApi.ts` wraps `apiRequest<T>()` (existing `apiClient.ts`, unchanged) against the AB-1005/AB-1006 contracts:

- `GET /notes?page&pageSize&sort&tagIds` → `Page<Note>` — `listNotes({ sort, tagIds, page, pageSize })`.
- `GET /notes/trash?page&pageSize` → `Page<Note>` — `listTrash({ page, pageSize })`.
- `GET /tags?page&pageSize=50` → `Page<TagWithCount>` — `listTags()`.
- `POST /notes/:id/restore` → `Note` — `restoreNote(id)`.

All four are authenticated requests; the existing `apiClient.ts` 401→refresh→retry interceptor (built in AB-1010) applies unchanged — no new interceptor logic needed.

Non-2xx responses surface through the existing `ApiRequestError`/`getErrorMessage()` pipeline (AB-1010) — `NOTE_NOT_FOUND` (e.g. restoring a note the purge job already removed) is already mapped and shown via a `sonner` error toast; no new error-code mappings are required by this ticket.

## Ticket-Specific UX Decisions

- **Tag filtering included now** (resolved with user): AB-1006's backend contract is already merged; shipping AB-1011 without consuming it would leave FR-NOTE-6 with no frontend home until an unscheduled later ticket. See Overview.
- **Plain-text preview, not rich rendering** (resolved with user): both `NoteCard` excerpts and `TrashPreviewModal` render a client-side plain-text walk of the TipTap JSON as an ordinary React text node. Because no HTML is ever rendered and `dangerouslySetInnerHTML` is never used, the AGENTS.md §11 DOMPurify rule does not apply to this ticket — the first ticket that must apply it is AB-1012 (real editor/renderer renders actual formatted HTML).
- **Trash preview never routes through `/notes/:id`**: `GET /notes/:id` returns `404 NOTE_NOT_FOUND` for soft-deleted notes by design (FR-NOTE-2/AB-1004). A Trash item's read-only preview must therefore be a modal fed by the note data already present in the `GET /notes/trash` response, not a navigation to the single-note route.
- **Placeholder `/notes/:id` and `/notes/new` routes** (resolved with user): same precedent as AB-1010's `/notes` placeholder — minimal stub pages, explicitly throwaway, wholesale-replaced by AB-1012. `/notes/:id`'s stub fetches `GET /notes/:id` and shows title + plain-text excerpt read-only (reusing `noteExcerpt.ts`); `/notes/new` is a static "Note editor coming soon" stub with no form.
- **Restore confirmation uses a non-destructive primary button, not red/`variant="destructive"`**: `docs/UX.md` §5's destructive-action list (revoke share, permanent delete, restore *version*) does not name Trash-restore, and restoring is the opposite of destructive — it undoes a delete. FR-UI-5 still mandates a confirmation modal (accidental restores are mildly disruptive, e.g. cluttering the active list), so `RestoreConfirmModal` follows the same Cancel-autofocus pattern as `docs/UX.md` §5 but uses a standard primary (not red) confirm button.
- **Filtered-to-zero empty state is distinct from genuinely-zero-notes empty state**: when `totalItems === 0` and at least one tag filter is active, `EmptyState` shows "No notes match the selected tags" with a "Clear filters" action instead of a "Create your first note" CTA — mirroring the Search no-results exception `docs/UX.md` §3 already documents for the same reason (a more direct recovery path already exists on-screen).
- **Tag filter bar fetches a fixed `pageSize=50` (the API's max) once, no further pagination**: `GET /tags` is itself paginated, but a paginated *filter bar* would be significant added complexity for a case the FRS treats as a small, fixed set (tags use an 8-color fixed palette, implying modest per-user tag catalogs). If a user has more than 50 tags, only the first 50 appear as filter chips — an accepted, documented limitation, not silently swept under the rug.
- **`AppShell` is the first real navigation chrome**: AB-1010 explicitly built no header/nav beyond its placeholder's own logout button ("a real shell arrives with AB-1011/AB-1012"). This ticket delivers it — a persistent header with Notes/Trash links and logout, reusing the exact logout call/redirect logic already proven in the AB-1010 placeholder rather than re-deriving it.

## Scenarios

1. **User opens `/notes` with no notes yet** → `EmptyState` shows "No notes yet" + "Create your first note" CTA linking to `/notes/new`.
2. **User opens `/notes` with existing notes, default state** → notes render newest-created-first (`createdAt:desc`), no tag filter applied, skeleton cards shown while the query is in flight for at least 200ms.
3. **User changes `SortSelect` to "Recently updated"** → list re-fetches with `sort=updatedAt:desc`; `notesViewStore.page` resets to `1`.
4. **User selects Tag A and Tag B in `TagFilterBar`** → list re-fetches `GET /notes?tagIds=A,B`; only notes carrying both tags appear (AND semantics, FR-NOTE-6); page resets to `1`.
5. **User's tag filter matches zero notes** → `EmptyState` shows "No notes match the selected tags" with a "Clear filters" action, no creation CTA.
6. **User clicks "Clear filters"** → `tagIds` resets to `[]`, full active-notes list re-appears.
7. **User navigates between pages via `Pagination`** → `notesViewStore.page` updates, list re-fetches the requested page, current sort/filter preserved.
8. **User clicks a `NoteCard`** → navigates to `/notes/:id`, which shows the placeholder read-only stub (title + excerpt).
9. **User clicks "New Note"** → navigates to `/notes/new` stub page.
10. **User opens `/notes/trash` with no soft-deleted notes** → `EmptyState` shows "Spotless bin!" / `EMPTY_TRASH_BIN` copy, no creation CTA.
11. **User opens `/notes/trash` with soft-deleted notes** → listed newest-deleted-first, paginated identically to the active list's envelope, read-only (no edit affordance rendered).
12. **User clicks a Trash item** → `TrashPreviewModal` opens showing title + full plain-text content, sourced from the already-fetched Trash page data (no additional network request).
13. **User clicks "Restore" inside the preview** → `RestoreConfirmModal` opens; Cancel is focused by default.
14. **User confirms restore** → `POST /notes/:id/restore` fires, on success the note disappears from `/notes/trash` and reappears in `/notes` on next visit/refetch (both query caches invalidated).
15. **User confirms restore for a note the purge job already removed in the background** (race) → `404 NOTE_NOT_FOUND` surfaces as an error toast ("This note could not be found."); the Trash list is refetched so the stale row disappears.
16. **User cancels either modal** → no request is sent, modal closes, state unchanged.
17. **Unauthenticated user navigates directly to `/notes`, `/notes/trash`, `/notes/:id`, or `/notes/new`** → redirected to `/login` (existing AB-1010 guard pattern, applied to all four routes).
18. **User clicks "Log out" in `AppShell`** → identical behavior to the AB-1010 placeholder's logout button (session cleared regardless of network outcome, redirect to `/login`).
19. **A list/trash query is in flight and resolves in under 200ms** → skeleton remains visible for the full 200ms minimum before content swaps in (no flicker).

## Dependencies

- AB-1005 (Notes List & Filtering — sort) — merged; this ticket's `SortSelect`/`useNotesListQuery` consume its `GET /notes?sort=` contract as-is.
- AB-1006 (Tags Architecture) — merged; this ticket's `TagFilterBar`/`useTagsQuery` consume its `GET /tags` and `GET /notes?tagIds=` contracts as-is (see Overview point 1 for why this dependency is added beyond the FRS's literal table).
- AB-1010 (Auth Frontend) — merged; this ticket replaces its `/notes` placeholder wholesale and reuses `authStore`, `apiClient.ts`, `errorMessages.ts`, and the route-guard pattern unchanged.
- No dependency on AB-1004 directly (superseded by AB-1005/AB-1006, which extend its contract without breaking it).

## Open Questions

None — tag-filtering scope, content-preview approach, and the placeholder-route strategy were all resolved with the user before drafting; see Overview and Ticket-Specific UX Decisions.
