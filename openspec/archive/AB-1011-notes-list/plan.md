---
ticket: AB-1011
status: APPROVED
---

# AB-1011: Notes List Frontend (incl. Trash UI) — Plan

Spec: `openspec/changes/AB-1011-notes-list/spec.md` (status: APPROVED)

## Graph Lookup Findings (Reuse Check)

- `get_architecture_overview` shows the knowledge graph still only indexes `apps/api` (11 communities: `routes-note`, `controllers-no`, `services-note`, `lib-when`, `jobs-purge`, `middleware-error`, plus three raw-SQL migration nodes) — `apps/web` has no indexed community yet, same finding AB-1010's plan recorded. No stale frontend graph data to reconcile against.
- `query_graph(file_summary)` on `packages/shared/src/schemas.ts` and `packages/shared/src/types.ts` returned only file-level nodes (the graph hasn't parsed exported members for these files), so reuse was verified by direct read instead: confirmed every schema/type this ticket needs already exists and requires **zero changes** —
  - `schemas.ts`: `noteSortSchema`, `tagIdsQuerySchema`, `listNotesQuerySchema`, `paginationQuerySchema`.
  - `types.ts`: `Note` (already carries `tagIds: string[]`), `TagWithCount`, `Page<T>`.
  - Nothing in this ticket duplicates or re-derives these — all imported from `shared`.
- Confirmed via direct read of `apps/api/src/services/notes.service.ts` / `notes.controller.ts` that `GET /notes`, `GET /notes/trash`, `GET /tags`, `POST /notes/:id/restore` all behave exactly as AB-1005/AB-1006's specs describe — no backend drift to account for.
- Confirmed via direct read that `apps/web` has **not** yet adopted shadcn/ui or lucide-react despite `apps/web/CLAUDE.md` listing them as the intended UI stack — AB-1010 shipped four forms with hand-rolled Tailwind only (no icons, no modals, `<button>` text instead of spinners). This is the first ticket that structurally needs a modal (Trash preview, restore confirm) and icons (empty-state icons named explicitly in `docs/UX.md` §3), so it's the first to actually pull in those packages (see New Packages).

## Files to Create

```
apps/web/src/lib/notesApi.ts               listNotes, listTrash, listTags, restoreNote — wraps apiClient.ts
apps/web/src/lib/notesQueries.ts            useNotesListQuery, useTagsQuery, useTrashListQuery, useRestoreNoteMutation (TanStack Query)
apps/web/src/lib/noteExcerpt.ts             TipTap JSON -> plain-text walk (mirrors apps/api/src/lib/tiptap.ts's walk/BLOCK_NODE_TYPES logic) + truncate() helper
apps/web/src/lib/uiCopy.ts                  UI_COPY constants (empty states, restore-confirm copy)
apps/web/src/lib/useMinLoadingTime.ts       hook: holds a loading boolean true for >=200ms minimum
apps/web/src/stores/notesViewStore.ts       Zustand: sort/tagIds/page for the active list
apps/web/src/components/ui/Dialog.tsx       thin wrapper around @radix-ui/react-dialog (Cancel-autofocus support, Escape-to-close)
apps/web/src/components/ui/Skeleton.tsx     plain Tailwind pulsing-div skeleton primitive (no new dependency)
apps/web/src/components/layout/AppShell.tsx   header: app name, Notes/Trash nav links, logout button
apps/web/src/components/notes/NoteCard.tsx
apps/web/src/components/notes/TagFilterBar.tsx
apps/web/src/components/notes/SortSelect.tsx
apps/web/src/components/notes/Pagination.tsx
apps/web/src/components/notes/EmptyState.tsx
apps/web/src/components/notes/NotesListPage.tsx
apps/web/src/components/notes/TrashListPage.tsx
apps/web/src/components/notes/TrashPreviewModal.tsx
apps/web/src/components/notes/RestoreConfirmModal.tsx
apps/web/src/routes/notes.trash.tsx          /notes/trash route def + guard (mirrors notes.tsx's beforeLoad)
apps/web/src/routes/notes.$noteId.tsx         /notes/:id — placeholder read-only stub route
apps/web/src/routes/notes.new.tsx             /notes/new — placeholder stub route
```

Test files (co-located, matching `include: ['src/**/*.test.{ts,tsx}']` in `vitest.config.ts`):

```
apps/web/src/lib/notesApi.test.ts
apps/web/src/lib/notesQueries.test.ts
apps/web/src/lib/noteExcerpt.test.ts
apps/web/src/lib/useMinLoadingTime.test.ts
apps/web/src/stores/notesViewStore.test.ts
apps/web/src/components/notes/NoteCard.test.tsx
apps/web/src/components/notes/TagFilterBar.test.tsx
apps/web/src/components/notes/SortSelect.test.tsx
apps/web/src/components/notes/Pagination.test.tsx
apps/web/src/components/notes/EmptyState.test.tsx
apps/web/src/components/notes/NotesListPage.test.tsx
apps/web/src/components/notes/TrashListPage.test.tsx
apps/web/src/components/notes/TrashPreviewModal.test.tsx
apps/web/src/components/notes/RestoreConfirmModal.test.tsx
apps/web/src/routes/router.test.tsx            EXTENDED: guard coverage for the 3 new routes
```

## Files to Modify

- `apps/web/src/routes/notes.tsx` — replaced: renders `<AppShell><NotesListPage /></AppShell>` instead of the AB-1010 placeholder; `beforeLoad` guard unchanged verbatim.
- `apps/web/src/routes/router.tsx` — register `notesTrashRoute`, `noteDetailRoute`, `noteNewRoute` as additional children of `rootRoute`.
- `apps/web/package.json` — add `lucide-react`, `@radix-ui/react-dialog` (see New Packages).
- `apps/web/e2e/smoke.spec.ts` — check whether it asserts anything about the `/notes` placeholder's exact markup (per AB-1010's plan, it currently only asserts the `/login` redirect at `/`); if it does inspect `/notes` content directly, update the assertion to match the new list page rather than the placeholder heading. If it doesn't touch `/notes` at all, no change needed — confirm during implementation.

No changes to `packages/shared/src/schemas.ts`, `types.ts`, or `errorCodes.ts` — this ticket consumes the existing contract as-is (see Graph Lookup Findings).

## Prisma Schema Changes

None. Pure frontend ticket — no `apps/api/prisma/schema.prisma` changes, no migrations, no backend files touched at all.

## New Packages

| Package | Target | Notes |
|---|---|---|
| `lucide-react` | `apps/web/package.json` (`dependencies`) | Icons for `EmptyState` (`FileText`, `Trash2`) and button loading spinners (`Loader2`) introduced by this ticket's new components. Exact pinned version, no `^`/`~` (AGENTS.md §3) — verify the current stable release compatible with React 19 via Context7/npm at implementation time; working assumption is the `0.4xx` line. |
| `@radix-ui/react-dialog` | `apps/web/package.json` (`dependencies`) | Accessible modal primitive (focus trap, Escape-to-close, `aria-*` wiring) for `TrashPreviewModal` and `RestoreConfirmModal`, wrapped by a small local `components/ui/Dialog.tsx`. Needed so the Cancel-autofocus / keyboard-operability requirements in `docs/UX.md` §5/§9 don't have to be hand-rolled and re-verified for correctness. Exact pinned version, no ranges — verify current stable release at implementation time. |

No other new dependencies:
- **No shadcn/ui CLI install** — shadcn/ui isn't itself an npm package; its components are copied source built on Radix primitives + Tailwind. This ticket hand-writes only the two primitives it actually needs (`Dialog`, `Skeleton`) directly against `@radix-ui/react-dialog` and plain Tailwind, rather than running the shadcn CLI scaffold for a much larger component set this ticket doesn't use.
- **No `class-variance-authority`/`clsx`/`tailwind-merge`** — this ticket's components have simple two-state styling (selected/unselected tag chip, loading/idle button), expressible with static Tailwind class strings the same way AB-1010's forms already do (`disabled:opacity-50` etc.) — no conditional-classname utility needed.
- **No native `<select>` replacement** — `SortSelect` uses a plain HTML `<select>` styled with Tailwind, not a Radix `Select` primitive; a native element is already keyboard/screen-reader accessible and avoids a second Radix package for one dropdown.
- **No new HTTP client or form library** — `notesApi.ts` reuses `apiClient.ts` verbatim; no forms are introduced in this ticket (filters/sort/pagination are all direct state updates, not submitted forms).

## Dependencies on Prior Tickets

- **AB-1005** (merged, `openspec/archive/AB-1005-notes-listing`) — `GET /notes?sort=` contract consumed as-is by `notesApi.ts`/`SortSelect`.
- **AB-1006** (merged, `openspec/archive/AB-1006-tags-crud`) — `GET /tags`, `GET /notes?tagIds=` contracts consumed as-is by `notesApi.ts`/`TagFilterBar`; `Note.tagIds` and `TagWithCount` shared types consumed as-is.
- **AB-1010** (merged, `openspec/archive/AB-1010-auth-pages`) — this ticket replaces its `/notes` placeholder wholesale and reuses `authStore`, `apiClient.ts`, `errorMessages.ts`, `rootRoute`/`router.tsx` route-tree pattern, and the `beforeLoad` guard idiom unchanged.
- Nothing here blocks AB-1012–1015 (they build their own routes/components); AB-1012 is expected to replace `notes.$noteId.tsx` and `notes.new.tsx` wholesale, same as this ticket replaced AB-1010's `/notes` placeholder.

## Risk Areas

1. **Placeholder-route churn**: `notes.$noteId.tsx` and `notes.new.tsx` are explicitly throwaway (AB-1012 replaces both). Risk: over-investing in their internals. Mitigation: keep both to the minimum described in the spec (title + excerpt read-only; static "coming soon" stub) — no state management, no data mutations beyond the single `GET /notes/:id` read on the detail stub.
2. **Trash preview must never call `GET /notes/:id`**: that endpoint 404s for soft-deleted notes by design (AB-1004). Risk: a developer wires `TrashPreviewModal` to navigate to `/notes/:id` out of habit (matching `NoteCard`'s click behavior) instead of reading from the already-fetched `GET /notes/trash` cache. Mitigation: flag explicitly in code review; `TrashPreviewModal`'s props take the note object directly, not an id, making a route-navigation shortcut awkward to introduce by accident.
3. **Query-key completeness**: per `docs/UX.md` §7, every filter token (`sort`, `tagIds`, `page`, `pageSize`) must be in the TanStack Query key or stale results can flash between filter changes. Mitigation: `notesQueries.ts` centralizes key construction in one place (`notesKeys.list(params)` helper) so no call site can hand-build a partial key.
4. **Restore double-invalidation ordering**: `useRestoreNoteMutation` must invalidate both `['notes','trash', ...]` and `['notes','list', ...]` on success — missing either leaves a stale cache (a restored note either lingers in Trash or doesn't appear in the active list until an unrelated refetch). Mitigation: invalidate by query-key *prefix* (`['notes']`) rather than enumerating every parameterized variant, so no combination of page/sort/filter is missed.
5. **New Radix dependency's accessibility contract**: `@radix-ui/react-dialog` handles focus-trap and Escape-to-close automatically, but the Cancel-autofocus requirement (`docs/UX.md` §5) requires explicitly passing `onOpenAutoFocus`/`ref`+`autoFocus` to the Cancel button — Radix's own default initial focus target is the dialog content, not a specific button. Must be verified manually (keyboard Tab from open, confirm Cancel is focused) since jsdom-based tests can assert `document.activeElement` but a manual browser check is worth doing per the `/verify` skill's spirit.
6. **`pageSize=50` tag-fetch limitation is silent past 50 tags**: documented in the spec as an accepted limitation, but must not regress into a bug — if `totalItems > 50` on the tags page, no error should surface; the filter bar simply shows the first 50. Add an explicit test asserting no crash/error state when `totalPages > 1`.
7. **`notes.tsx` replacement changing `/notes`'s rendered content breaks `apps/web/e2e/smoke.spec.ts`** if that spec asserts anything about the placeholder — same category of risk AB-1010 flagged for the root-path redirect; must be checked, not assumed, during implementation (see Files to Modify).

## Test Strategy

| Spec Scenario(s) | Test File | Coverage |
|---|---|---|
| 1, 2, 19 (empty list, default sort/skeleton, min 200ms display) | `NotesListPage.test.tsx`, `useMinLoadingTime.test.ts` | Empty-state render at `totalItems: 0`; skeleton shown while query pending; timer test asserts skeleton stays mounted for the full 200ms even when the mocked query resolves faster |
| 3 (sort change resets page, refetches) | `SortSelect.test.tsx`, `notesViewStore.test.ts` | `setSort` action resets `page` to `1`; selecting an option calls `setSort` with the correct enum value |
| 4, 6, 17 (tag filter AND semantics, filtered-empty state, clear filters) | `TagFilterBar.test.tsx`, `notesViewStore.test.ts`, `EmptyState.test.tsx` | `toggleTag` adds/removes ids and resets page; query key includes `tagIds`; `EmptyState` renders "no matches" copy + Clear-filters action when `totalItems === 0` and `tagIds.length > 0`, vs. "no notes yet" + CTA when `tagIds.length === 0` |
| 5 (INVALID/zero-match tagIds) | `notesApi.test.ts` | `listNotes` passes `tagIds` through to the query string unchanged; a mocked `200` empty-page response renders the filtered-empty state (covered above) |
| 7 (pagination preserves sort/filter) | `Pagination.test.tsx`, `NotesListPage.test.tsx` | `setPage` updates only `page` in the store, leaving `sort`/`tagIds` untouched; query key reflects the new page with prior sort/filter intact |
| 8, 9 (NoteCard click-through, New Note navigation) | `NoteCard.test.tsx`, `router.test.tsx` | `NoteCard` renders a link to `/notes/:id`; `router.test.tsx` asserts `/notes/new` and `/notes/:id` are registered and guarded |
| 10, 11 (Trash empty state, Trash list rendering/pagination) | `TrashListPage.test.tsx` | Empty-bin copy at `totalItems: 0`; paginated render with soft-deleted notes, no edit affordances present |
| 12 (Trash preview from cached data, no extra fetch) | `TrashPreviewModal.test.tsx` | Renders from a note prop with no network call; asserts `noteExcerpt`'s full (non-truncated) plain-text output |
| 13, 16 (restore confirm modal, Cancel autofocus, cancel closes without request) | `RestoreConfirmModal.test.tsx` | Modal opens with Cancel focused; clicking Cancel closes with no mutation call; clicking Restore triggers the mutation once |
| 14, 15 (restore success invalidates both caches; restore 404 race shows toast + refetches trash) | `notesQueries.test.ts` | Mocked `POST /notes/:id/restore`: success path asserts both `['notes','trash']` and `['notes','list']` query-key prefixes invalidated; `404 NOTE_NOT_FOUND` path asserts `getErrorMessage` copy surfaced and trash query re-invalidated |
| 18 (logout from AppShell) | reuses `authStore.test.ts` coverage (AB-1010) + a light `AppShell.test.tsx` assertion that its logout button calls `authStore.logout()` | No duplication of AB-1010's `logout()` unit test; only the wiring is new |
| Route guards for all 3 new routes reject unauthenticated access | `router.test.tsx` (extended) | Same pattern as AB-1010's existing guard tests, parameterized over `/notes/trash`, `/notes/:id`, `/notes/new` |
| `noteExcerpt.ts` correctness (truncation, block-node separation, malformed input) | `noteExcerpt.test.ts` | Mirrors `apps/api/src/lib/tiptap.test.ts`'s test shape (nested paragraphs/headings, non-conforming input yields `''`), plus new cases for the `truncate()` helper (exact-boundary, multi-byte-safe truncation, no truncation when under the limit) |

- All new tests are Vitest + Testing Library component/unit tests (`apps/web/**/*.test.{ts,tsx}`), matching AGENTS.md §10 — no Supertest/integration DB involved (no backend changes).
- No new Playwright spec — the full authenticated E2E journey (including Trash/restore) belongs to AB-1016; this ticket only touches the existing baseline `smoke.spec.ts` if it needs updating for the `/notes` markup change (see Risk Area 7).
- Coverage gate: ≥80% on all new files, enforced via the existing Husky pre-commit hook — no separate configuration needed.
- Quality gates before commit: `pnpm build`, `pnpm lint --max-warnings 0`, `pnpm test` (per CLAUDE.md, all three must be green; proceed without asking per CLAUDE.md's permission model).

## Open Questions

None — tag-filtering scope, content-preview approach, placeholder-route strategy (resolved in `/spec`), and the shadcn/ui-vs-hand-rolled dependency question (resolved above in New Packages, consistent with `apps/web/CLAUDE.md`'s documented stack and AB-1010's minimal-dependency precedent) are all settled before drafting this plan.
