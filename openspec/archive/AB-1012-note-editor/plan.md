---
ticket: AB-1012
status: APPROVED
---

# AB-1012: Note Editor Frontend — Plan

Spec: `openspec/changes/AB-1012-note-editor/spec.md` (status: APPROVED)

## Graph Lookup Findings (Reuse Check)

- `get_architecture_overview` still shows the knowledge graph indexing only `apps/api` (12 communities: `routes-note`, `controllers-no`, `services-note`, `lib-when`, `middleware-error`, `stores-auth` (an API-side community despite the name), plus migration SQL) — `apps/web` remains unindexed by the graph, the same gap AB-1010's and AB-1011's plans recorded. `semantic_search_nodes` for `notesApi`/`notesQueries` returned zero matches for the same reason (frontend TS/TSX isn't parsed into named nodes yet), and `query_graph(file_summary)` on `packages/shared/src/schemas.ts` returned only the file-level node, not its exports.
- Reuse verified instead by direct read of `packages/shared/src/schemas.ts` and `types.ts`: `createNoteSchema`, `updateNoteSchema`, `titleSchema`, `tagColorSchema`, `TAG_COLORS`, `createTagSchema` and `Note`, `Tag`, `TagWithCount`, `TipTapDocument`, `Page<T>` all already exist and require **zero changes** — this ticket only imports them.
- `apps/web/src/lib/notesApi.ts` and `notesQueries.ts` (built in AB-1011) already contain `listNotes`, `listTrash`, `listTags`, `restoreNote`, `getNote` and their matching query hooks — this ticket **extends these two files in place** (adds `createNote`/`updateNote`/`deleteNote`/`createTag` and their mutation hooks) rather than creating parallel files, avoiding duplication.
- `errorMessages.ts` already maps every error code this ticket can receive (`VALIDATION_FAILED`, `NOTE_NOT_FOUND`, `TAG_NAME_DUPLICATE`, `INVALID_TAG`) — confirmed via direct read; **no changes needed** to that file.
- `components/ui/Dialog.tsx` (AB-1011, wraps `@radix-ui/react-dialog` with Cancel-autofocus support) is reused as-is by `DeleteNoteModal` — no new dialog primitive needed.
- `notes.$noteId.tsx`'s current stub (`getNote` + `extractPlainText`, read-only) and `notes.new.tsx`'s current stub (static text) are both confirmed still exactly the AB-1011 throwaway placeholders described in that ticket's spec — safe to replace wholesale, no accreted logic to preserve.
- No TipTap package is installed anywhere in the repo yet (confirmed via `apps/web/package.json` read and a repo-wide grep for `tiptap` — the only existing hits are `apps/api/src/lib/tiptap.ts`, the server-side plain-text extractor, and doc references) — this is a genuinely new dependency, not a version bump.

## Files to Create

```
apps/web/src/components/editor/NoteEditorPage.tsx    shared page shell (mode: 'new' | 'existing'): title input, toolbar, editor, tag combobox, autosave pill, delete button
apps/web/src/components/editor/NoteEditor.tsx          TipTap useEditor wrapper (StarterKit only), emits TipTap JSON on change
apps/web/src/components/editor/EditorToolbar.tsx        Bold/Italic/Strike/H1-H3/BulletList/OrderedList/Blockquote/CodeBlock/Undo/Redo buttons, aria-pressed
apps/web/src/components/editor/AutosaveStatusPill.tsx   saving / saved / error pill (docs/UX.md §1)
apps/web/src/components/editor/TagCombobox.tsx          attached-tag chips + add-tag input; case-insensitive match, on-the-fly create (FR-UI-3)
apps/web/src/components/editor/DeleteNoteModal.tsx      confirm-before-soft-delete modal (reuses components/ui/Dialog.tsx)
apps/web/src/hooks/useAutosave.ts                        2000ms debounce; create-vs-update decision; one automatic retry on failure
apps/web/src/stores/editorStatusStore.ts                 Zustand: status: 'idle' | 'saving' | 'saved' | 'error'
apps/web/src/stores/draftStore.ts                        Zustand: latest unsent { title, body } keyed by noteId | 'new'; cleared on successful save
apps/web/src/lib/tagColor.ts                              pickRandomTagColor() over the shared TAG_COLORS palette
```

Test files (co-located, matching `include: ['src/**/*.test.{ts,tsx}']` in `vitest.config.ts`):

```
apps/web/src/components/editor/NoteEditorPage.test.tsx
apps/web/src/components/editor/NoteEditor.test.tsx
apps/web/src/components/editor/EditorToolbar.test.tsx
apps/web/src/components/editor/AutosaveStatusPill.test.tsx
apps/web/src/components/editor/TagCombobox.test.tsx
apps/web/src/components/editor/DeleteNoteModal.test.tsx
apps/web/src/hooks/useAutosave.test.ts
apps/web/src/stores/editorStatusStore.test.ts
apps/web/src/stores/draftStore.test.ts
apps/web/src/lib/tagColor.test.ts
```

## Files to Modify

- `apps/web/src/routes/notes.new.tsx` — replaced: `beforeLoad` guard unchanged verbatim; `component` becomes `<AppShell><NoteEditorPage mode="new" /></AppShell>`.
- `apps/web/src/routes/notes.$noteId.tsx` — replaced: guard unchanged; `component` becomes `<AppShell><NoteEditorPage mode="existing" noteId={noteId} /></AppShell>`; removes the old `getNote`/`extractPlainText` read-only rendering (superseded by `useNoteQuery` + the live editor).
- `apps/web/src/lib/notesApi.ts` — add `createNote`, `updateNote`, `deleteNote`, `createTag`, extending the existing file (not duplicating `getNote`/`listTags`/etc.).
- `apps/web/src/lib/notesApi.test.ts` — extended with cases for the four new functions.
- `apps/web/src/lib/notesQueries.ts` — add `notesKeys.detail(noteId)`, `useNoteQuery(noteId)`, `useCreateNoteMutation`, `useUpdateNoteMutation`, `useDeleteNoteMutation`, `useCreateTagMutation`; success/settled handlers invalidate `['notes', 'list']`, `['notes', 'trash']`, and `['notes', 'detail', noteId]` as appropriate (same invalidate-by-prefix pattern `useRestoreNoteMutation` already established).
- `apps/web/src/lib/notesQueries.test.ts` — extended.
- `apps/web/src/lib/uiCopy.ts` — add `AUTOSAVE_SAVING`, `AUTOSAVE_SAVED`, `AUTOSAVE_ERROR`, `DELETE_NOTE_CONFIRM` ({heading, body, confirm, cancel}, mirroring `RESTORE_CONFIRM`'s shape), `TAG_CREATE_LABEL`.
- `apps/web/package.json` — add TipTap dependencies (see New Packages).
- `apps/web/src/index.css` — add the minimal `.ProseMirror` CSS TipTap needs for cursor/placeholder visibility and basic block spacing (no such rules exist yet since no editor has been mounted before this ticket).

No changes to `packages/shared/src/schemas.ts`, `types.ts`, `errorCodes.ts`, `apps/web/src/lib/apiClient.ts`, `errorMessages.ts`, `stores/authStore.ts`, `stores/notesViewStore.ts`, `components/layout/AppShell.tsx`, `components/ui/Dialog.tsx`, or `apps/web/e2e/smoke.spec.ts` (that test only asserts the `/login` redirect at `/`, untouched by this ticket — confirmed by direct read).

## Prisma Schema Changes

None. Pure frontend ticket — no `apps/api/prisma/schema.prisma` changes, no migrations, no backend files touched at all. (No soft-delete concerns introduced: `DELETE /notes/:id` already performs `deletedAt` assignment server-side per AB-1004; this ticket only calls that existing endpoint.)

## New Packages

| Package | Target | Notes |
|---|---|---|
| `@tiptap/react` | `apps/web/package.json` (`dependencies`) | React bindings (`useEditor`, `EditorContent`). |
| `@tiptap/core` | `apps/web/package.json` (`dependencies`) | Core editor engine `@tiptap/react` depends on. |
| `@tiptap/starter-kit` | `apps/web/package.json` (`dependencies`) | Bundles the extensions this ticket's toolbar scope needs (bold, italic, strike, heading, bullet/ordered list, blockquote, code block, history/undo-redo) — no separate extension packages required since the spec's resolved scope is "StarterKit basics" with no link mark. |
| `@tiptap/pm` | `apps/web/package.json` (`dependencies`) | ProseMirror bindings TipTap requires as a peer; pinned explicitly rather than left as a transitive install, consistent with AGENTS.md §3's exact-version-everywhere rule. |

All four: exact pinned versions, no `^`/`~` (AGENTS.md §3). **Verify current stable releases compatible with React 19 via Context7/npm at implementation time** (same "don't carry forward a stale version" caveat SDS §2.1 applies to the Postgres tag, and AB-1010/AB-1011 applied to `@tanstack/react-router`/`lucide-react`) — working assumption for this plan is the TipTap v2 line (the current stable major as of drafting), to be confirmed, not assumed, before pinning.

No other new dependencies:
- **No `@tiptap/extension-link`** — resolved with user; out of scope (Overview point 4, Non-Goals).
- **No new form library** — the title input is a single plain controlled `<input>` validated via `titleSchema.safeParse` on blur, matching AB-1010's established no-`react-hook-form` precedent for small forms.
- **No new combobox/autocomplete package** — `TagCombobox` is hand-rolled (a text input + a filtered list of existing tags + a "Create" affordance), the same complexity class as AB-1011's `TagFilterBar`/`SortSelect`, not warranting a dependency like `cmdk` or `downshift`.
- **No debounce utility package** (e.g. `lodash.debounce`) — `useAutosave` implements its own `setTimeout`-based debounce, matching `useMinLoadingTime`'s existing hand-rolled-hook precedent from AB-1011.

## Dependencies on Prior Tickets

- **AB-1004** (merged, `openspec/archive/AB-1004-notes-core`) — `POST`/`PATCH`/`DELETE /notes/:id` contracts consumed as-is; every `PATCH` continues to trigger AB-1004's server-side version snapshot unchanged, with no visible surface in this ticket.
- **AB-1006** (merged, `openspec/archive/AB-1006-tags-crud`) — `POST /tags`, `tagIds` on note create/update, and the fixed `TAG_COLORS` palette (`packages/shared`) consumed as-is.
- **AB-1010** (merged, `openspec/archive/AB-1010-auth-pages`) — `authStore`, `apiClient.ts`, `errorMessages.ts`, route-guard (`beforeLoad`) pattern reused unchanged.
- **AB-1011** (merged, `openspec/archive/AB-1011-notes-list`) — this ticket wholesale-replaces its `notes.new.tsx`/`notes.$noteId.tsx` placeholders (explicitly anticipated in that ticket's own risk log), extends its `notesApi.ts`/`notesQueries.ts`/`uiCopy.ts` in place, and reuses `AppShell`, `components/ui/Dialog.tsx`, and `useTagsQuery()` unchanged.
- Nothing here blocks AB-1013 (Search), AB-1014 (Sharing), or AB-1015 (Version History) — each builds its own routes/components against the same `Note`/`Tag` contracts this ticket also consumes, without touching this ticket's files.

## Risk Areas

1. **TipTap API surface unfamiliarity** — `useEditor`, `EditorContent`, `StarterKit` configuration, and command-chaining (`editor.chain().focus().toggleBold().run()`) must be checked against current library docs (Context7 MCP, per AB-1001 FR-INFRA-9's mandatory tooling rule) rather than assumed from training data, since TipTap's API has changed across majors (v1→v2, and a v3 beta may exist by implementation time).
2. **Duplicate-create race**: if the user keeps typing during an in-flight `POST /notes` (new-note autosave), a second debounce firing before the first request resolves must not fire a second `POST` (which would create two notes). Mitigation: `useAutosave` must track an explicit "create in flight" flag and hold subsequent saves until the create resolves and the route has transitioned to `/notes/:id`, at which point they become ordinary `PATCH`es.
3. **Route transition losing in-progress content**: navigating from `/notes/new` to `/notes/:id` after the first successful save unmounts `notes.new.tsx`'s component tree and mounts `notes.$noteId.tsx`'s. If `NoteEditorPage` (mode `"existing"`) refetches `GET /notes/:id` from scratch instead of trusting the just-returned `POST` response, there's a moment where stale/empty content could flash. Mitigation: on create success, seed the `useNoteQuery(newId)` TanStack Query cache directly via `queryClient.setQueryData` with the `POST` response before navigating, so the new route mounts already-populated, no network waterfall.
4. **Tag-change vs. autosave overlap**: an immediate tag-attach `PATCH { tagIds }` and a debounced title/body `PATCH` can be in flight concurrently. Since they touch disjoint fields server-side this can't corrupt data, but the UI must not let an older response's data overwrite newer local edits — mitigation: the editor's visible title/body state is never overwritten by a mutation response after the initial load; only `TagCombobox`'s own attached-tags display re-derives from its own mutation's result / the `useTagsQuery()` cache.
5. **Debounce timer leak / lost final edit on unmount**: if the user navigates away (e.g. clicks "Notes" in `AppShell`) within the 2000ms window after their last keystroke, the pending debounced save is lost unless `useAutosave` flushes on unmount. Mitigation: flush any pending dirty save synchronously in a cleanup effect; accept (per spec Non-Goals) that no `beforeunload`/navigation-blocking guard exists beyond this in-app flush.
6. **TipTap requires baseline CSS** (`.ProseMirror` class) for a visible caret and reasonable block spacing that Tailwind's reset otherwise strips — must be added to `index.css`; easy to miss since no prior ticket has touched editor-specific CSS.
7. **DOMPurify decision is a documented judgment call, not a default exemption** — flagged explicitly in the spec's Ticket-Specific UX Decisions (StarterKit-only schema, no `dangerouslySetInnerHTML` anywhere in this ticket). Must be verified in code review that no call site introduces `dangerouslySetInnerHTML` or a `generateHTML`-based render path, which would silently re-open the exact risk this decision assumes doesn't exist.
8. **`draftStore`'s practical value is limited to the error-state UI**, since the mounted editor's own state already holds the current content — worth confirming in review that `draftStore` isn't accidentally treated as the *source of truth* for the editor (it should only ever be read for the "your changes are preserved" messaging, per spec's State Management section), to avoid two divergent copies of the same content.

## Test Strategy

| Spec Scenario(s) | Test File | Coverage |
|---|---|---|
| 1–3 (empty new-note render, create-on-first-title, autosave held off with no title) | `NoteEditorPage.test.tsx`, `useAutosave.test.ts` | No request fires with an empty title; a mocked debounce-elapsed tick with a non-empty title fires exactly one `POST /notes` |
| 4 (existing-note edit → `PATCH` with only changed fields) | `useAutosave.test.ts` | Given `mode="existing"`, only changed field(s) appear in the `PATCH` body |
| 5–7 (one automatic retry on failure; error state after two failures with content preserved; manual retry) | `useAutosave.test.ts`, `AutosaveStatusPill.test.tsx`, `draftStore.test.ts` | Mocked `updateNote`/`createNote` rejecting once then succeeding (no error state reached); rejecting twice (status becomes `'error'`, `draftStore` entry still holds the typed content); manual retry button re-invokes the save function |
| 8 (title cleared mid-edit halts autosave + inline validation) | `NoteEditorPage.test.tsx` | Clearing the title field prevents `useAutosave` from firing; inline error text renders on blur |
| 9–10 (toolbar formatting + active state, undo) | `EditorToolbar.test.tsx`, `NoteEditor.test.tsx` | Clicking Bold/H2/BulletList calls the corresponding TipTap chain command; `aria-pressed` reflects `editor.isActive(...)` at the cursor; undo reverts the last transaction |
| 11 (case-insensitive existing-tag match, no duplicate `POST /tags`) | `TagCombobox.test.tsx` | Typing a name matching a cached tag case-insensitively selects it; `createTag` mock is not called |
| 12 (new tag creation, random color, attach path for existing vs. new note) | `TagCombobox.test.tsx`, `tagColor.test.ts` | `createTag` called with a color drawn from `TAG_COLORS`; existing note attaches via an immediate `updateNote` call; new note adds to local `pendingTagIds` only |
| 13 (409 race → refetch and attach) | `TagCombobox.test.tsx` | Mocked `createTag` rejecting with `TAG_NAME_DUPLICATE` triggers a `useTagsQuery()` refetch and attaches the resolved existing tag, with no error toast shown |
| 14 (tag removal, existing vs. new note) | `TagCombobox.test.tsx` | Removing a chip on an existing note fires an immediate `updateNote` with the tag excluded; on a new note it only mutates local state |
| 15–17 (delete confirm modal open/cancel/confirm) | `DeleteNoteModal.test.tsx` | Modal opens on trigger; Cancel closes with no request; Confirm calls `deleteNote` once and navigates to `/notes` on success |
| 18 (`/notes/new` renders no Delete button before the note exists) | `NoteEditorPage.test.tsx` | `mode="new"` with no `noteId` yet renders no delete affordance |
| 19 (unauthenticated redirect on both routes) | `router.test.tsx` (extended, same pattern AB-1010/1011 used) | `beforeLoad` guard exercised for `/notes/new` and `/notes/:id` |
| 20 (`404 NOTE_NOT_FOUND` full-page error state) | `NoteEditorPage.test.tsx` | Mocked `getNote` rejecting with `NOTE_NOT_FOUND` renders the `docs/UX.md` §2 full-page error state, not a broken editor |
| 21 (mid-edit note removed elsewhere → autosave 404 → error state, no recreate) | `useAutosave.test.ts` | Mocked `updateNote` rejecting with `NOTE_NOT_FOUND` sets `editorStatusStore.status = 'error'` and does not fall back to a `createNote` call |
| `editorStatusStore`/`draftStore` state transitions in isolation | `editorStatusStore.test.ts`, `draftStore.test.ts` | Direct unit coverage of each store's actions, independent of the component tests above |

- All new tests are Vitest + Testing Library component/unit tests (`apps/web/**/*.test.{ts,tsx}`), matching AGENTS.md §10 — no Supertest/integration DB involved (no backend changes). TipTap's `useEditor` runs against jsdom; if any TipTap internals need a real `contenteditable`/selection API jsdom doesn't support, isolate those specific interactions behind a thin, independently-testable command-dispatch layer (`EditorToolbar` calling `editor.chain()...run()`) rather than asserting on rendered ProseMirror DOM output — confirm this approach works during implementation and fall back to mocking the `Editor` instance in `EditorToolbar.test.tsx` if jsdom can't run real ProseMirror transactions.
- No new Playwright spec — the full authenticated E2E journey (including note creation, autosave, tagging, and delete) belongs to AB-1016 per the FRS traceability matrix; `smoke.spec.ts` needs no change (confirmed in Graph Lookup Findings).
- Coverage gate: ≥80% on all new files, enforced via the existing Husky pre-commit hook — no separate configuration needed.
- Quality gates before commit: `pnpm build`, `pnpm lint --max-warnings 0`, `pnpm test` (per CLAUDE.md, all three must be green; proceed without asking per CLAUDE.md's permission model).

## Open Questions

None — autosave delay, new-note creation strategy, delete-action placement, and editor toolbar scope were resolved during `/spec`; this plan surfaces no new ambiguity requiring a decision beyond implementation-time library-version verification (Risk Area 1, New Packages).
