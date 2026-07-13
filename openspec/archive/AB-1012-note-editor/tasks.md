---
ticket: AB-1012
status: APPROVED
---

# AB-1012: Note Editor Frontend — Tasks

Plan: `openspec/changes/AB-1012-note-editor/plan.md` (status: APPROVED)

Ordering note: tasks are grouped into phases (Setup → Core Libraries → API/Query Layer → Autosave Hook → Editor Components → Page Shell → Routes → Integration Check). Within a phase, `[PARALLEL]` tasks touch disjoint files and have no dependency on each other — they can be worked simultaneously. Tasks without `[PARALLEL]` depend on the task(s) named in "Depends on". No task exceeds 45 minutes, so none are tagged `[SUBAGENT]`.

## Phase 0 — Setup

- [x] **T1.** Add `@tiptap/react`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm` to `apps/web/package.json` (exact pinned versions, verified via Context7/npm for React 19 compatibility — no `^`/`~`); run install.
  - Files: `apps/web/package.json`, `pnpm-lock.yaml`
  - Scenario refs: none directly (infrastructure for T16–T19 editor tasks)
  - Time: 15 min
  - Depends on: none

- [x] **T2.** Add minimal `.ProseMirror` CSS to `apps/web/src/index.css` (visible caret, list/blockquote/code-block spacing that Tailwind's reset otherwise strips — nothing exists yet since no editor has been mounted before this ticket).
  - Files: `apps/web/src/index.css`
  - Scenario refs: 9
  - Time: 10 min · `[PARALLEL]`
  - Depends on: none

## Phase 1 — Core Libraries (stores, small lib helpers, no UI dependency)

- [x] **T3.** `tagColor.ts` — `pickRandomTagColor()` returning a random value from the shared `TAG_COLORS` palette.
  - Files: `apps/web/src/lib/tagColor.ts`
  - Scenario refs: 12
  - Time: 10 min · `[PARALLEL]`
  - Depends on: none

- [x] **T4.** `tagColor.test.ts` — asserts the returned color is always a member of `TAG_COLORS` across repeated calls.
  - Files: `apps/web/src/lib/tagColor.test.ts`
  - Scenario refs: 12
  - Time: 10 min
  - Depends on: T3

- [x] **T5.** `editorStatusStore.ts` — Zustand store: `{ status: 'idle' | 'saving' | 'saved' | 'error' }` + `setSaving`/`setSaved`/`setError`/`reset` actions. No `persist` middleware.
  - Files: `apps/web/src/stores/editorStatusStore.ts`
  - Scenario refs: 4, 5, 6, 7, 21
  - Time: 15 min · `[PARALLEL]`
  - Depends on: none

- [x] **T6.** `editorStatusStore.test.ts` — unit tests for each action/state transition.
  - Files: `apps/web/src/stores/editorStatusStore.test.ts`
  - Scenario refs: 4, 5, 6, 7, 21
  - Time: 15 min
  - Depends on: T5

- [x] **T7.** `draftStore.ts` — Zustand store: latest unsent `{ title, body }` keyed by `noteId | 'new'`; `setDraft(key, draft)` / `clearDraft(key)` actions, each scoped to its own key only. No `persist` middleware (see plan.md State Management rationale).
  - Files: `apps/web/src/stores/draftStore.ts`
  - Scenario refs: 6, 8
  - Time: 15 min · `[PARALLEL]`
  - Depends on: none

- [x] **T8.** `draftStore.test.ts` — set/clear per key; asserts one key's `clearDraft` never affects another key's stored draft.
  - Files: `apps/web/src/stores/draftStore.test.ts`
  - Scenario refs: 6, 8
  - Time: 15 min
  - Depends on: T7

- [x] **T9.** Extend `uiCopy.ts` — add `AUTOSAVE_SAVING`, `AUTOSAVE_SAVED`, `AUTOSAVE_ERROR`, `DELETE_NOTE_CONFIRM` (`{heading, body, confirm, cancel}`, mirroring `RESTORE_CONFIRM`'s shape), `TAG_CREATE_LABEL`.
  - Files: `apps/web/src/lib/uiCopy.ts`
  - Scenario refs: 6, 7, 15, 16, 17
  - Time: 10 min · `[PARALLEL]`
  - Depends on: none

## Phase 2 — API + Query Layer

- [x] **T10.** Extend `notesApi.ts` — `createNote({title, body, tagIds})`, `updateNote(id, {title?, body?, tagIds?})`, `deleteNote(id)`, `createTag({name, color})`, each wrapping the existing `apiRequest<T>()`.
  - Files: `apps/web/src/lib/notesApi.ts`
  - Scenario refs: 2, 4, 12, 13, 16
  - Time: 25 min
  - Depends on: none

- [x] **T11.** Extend `notesApi.test.ts` — mocked-`fetch` tests asserting correct method/path/body for all four new functions.
  - Files: `apps/web/src/lib/notesApi.test.ts`
  - Scenario refs: 2, 4, 12, 13, 16
  - Time: 20 min
  - Depends on: T10

- [x] **T12.** Extend `notesQueries.ts` — `notesKeys.detail(noteId)`, `useNoteQuery(noteId)`, `useCreateNoteMutation` (seeds `useNoteQuery`'s cache via `setQueryData` with the create response, per plan.md Risk Area 3, and invalidates `['notes','list']`), `useUpdateNoteMutation` (invalidates `['notes','detail',id]` + `['notes','list']`), `useDeleteNoteMutation` (invalidates `['notes','list']` + `['notes','trash']`), `useCreateTagMutation` (invalidates `['tags','list']` on success).
  - Files: `apps/web/src/lib/notesQueries.ts`
  - Scenario refs: 2, 4, 16, 20, 21
  - Time: 35 min
  - Depends on: T10

- [x] **T13.** Extend `notesQueries.test.ts` — mocked mutations: create seeds the detail cache and invalidates the list; update/delete invalidate the correct key prefixes; `createTag` success and `409 TAG_NAME_DUPLICATE` paths.
  - Files: `apps/web/src/lib/notesQueries.test.ts`
  - Scenario refs: 2, 4, 13, 16, 20, 21
  - Time: 30 min
  - Depends on: T12

## Phase 3 — Autosave Hook

- [x] **T14.** `useAutosave.ts` — 2000ms debounce after the last title/body change; holds off entirely while the title is empty; tracks a "create in flight" guard so a second debounce tick during an in-flight `POST` never double-creates (plan.md Risk Area 2); on first successful create, seeds the query cache and signals the caller to navigate (`replace: true`) to `/notes/:id`; thereafter fires `PATCH` with only changed fields; exactly one automatic retry on failure, then `editorStatusStore.status = 'error'` with the content preserved in `draftStore`; exposes a manual-retry function.
  - Files: `apps/web/src/hooks/useAutosave.ts`
  - Scenario refs: 1, 2, 3, 4, 5, 6, 7, 8, 21
  - Time: 40 min
  - Depends on: T5, T7, T12

- [x] **T15.** `useAutosave.test.ts` — fake-timer tests: debounce timing, title-empty gate (no request), single in-flight create guard, one-retry-then-success (no visible error), one-retry-then-failure (error state, draft preserved), manual retry re-invocation, `404 NOTE_NOT_FOUND` on an existing note sets error without falling back to create.
  - Files: `apps/web/src/hooks/useAutosave.test.ts`
  - Scenario refs: 1, 2, 3, 4, 5, 6, 7, 8, 21
  - Time: 40 min
  - Depends on: T14

## Phase 4 — Editor Components

- [x] **T16.** `NoteEditor.tsx` — TipTap `useEditor` wrapper configured with `StarterKit` only; controlled via `content`/`onUpdate` props emitting the current TipTap JSON document; exposes the underlying `Editor` instance so `EditorToolbar` can drive commands.
  - Files: `apps/web/src/components/editor/NoteEditor.tsx`
  - Scenario refs: 9, 10
  - Time: 35 min
  - Depends on: T1, T2

- [x] **T17.** `NoteEditor.test.tsx` — mounts with initial content; simulated input triggers `onUpdate` with the updated TipTap JSON; the undo command reverts a formatting change.
  - Files: `apps/web/src/components/editor/NoteEditor.test.tsx`
  - Scenario refs: 9, 10
  - Time: 25 min
  - Depends on: T16

- [x] **T18.** `EditorToolbar.tsx` — Bold/Italic/Strike/H1–H3/Bullet List/Ordered List/Blockquote/Code Block/Undo/Redo buttons calling `editor.chain().focus().toggleX().run()`; `aria-pressed` reflects `editor.isActive(...)` at the cursor.
  - Files: `apps/web/src/components/editor/EditorToolbar.tsx`
  - Scenario refs: 9
  - Time: 30 min · `[PARALLEL]`
  - Depends on: T16

- [x] **T19.** `EditorToolbar.test.tsx` — each button invokes its correct chain command against a live `Editor` instance; `aria-pressed` reflects active formatting state.
  - Files: `apps/web/src/components/editor/EditorToolbar.test.tsx`
  - Scenario refs: 9
  - Time: 25 min
  - Depends on: T18

- [x] **T20.** `AutosaveStatusPill.tsx` — renders `saving` / `saved` (auto-hides after 2s) / `error` states from `editorStatusStore`; error state includes a manual-retry button.
  - Files: `apps/web/src/components/editor/AutosaveStatusPill.tsx`
  - Scenario refs: 5, 6, 7
  - Time: 20 min · `[PARALLEL]`
  - Depends on: T5, T9

- [x] **T21.** `AutosaveStatusPill.test.tsx` — each status renders the correct copy; `saved` auto-hides after 2s (fake timers); the retry button in `error` state calls the provided retry callback.
  - Files: `apps/web/src/components/editor/AutosaveStatusPill.test.tsx`
  - Scenario refs: 5, 6, 7
  - Time: 20 min
  - Depends on: T20

- [x] **T22.** `TagCombobox.tsx` — attached-tag chips (resolved via `useTagsQuery()`) + add-tag input; case-insensitive existing-tag match short-circuits creation; new-name path calls `useCreateTagMutation` with `pickRandomTagColor()`; a `409 TAG_NAME_DUPLICATE` response refetches `useTagsQuery()` and attaches the resolved tag instead of erroring; attach/detach fires an immediate `useUpdateNoteMutation({tagIds})` on an existing note, or only updates local `pendingTagIds` state on a not-yet-created note.
  - Files: `apps/web/src/components/editor/TagCombobox.tsx`
  - Scenario refs: 11, 12, 13, 14
  - Time: 40 min
  - Depends on: T3, T9, T12

- [x] **T23.** `TagCombobox.test.tsx` — case-insensitive selection (no `createTag` call), new-tag creation asserting a `TAG_COLORS` member is used, the 409-race refetch-and-attach path, attach/detach behavior for an existing vs. a new (id-less) note.
  - Files: `apps/web/src/components/editor/TagCombobox.test.tsx`
  - Scenario refs: 11, 12, 13, 14
  - Time: 35 min
  - Depends on: T22

- [x] **T24.** `DeleteNoteModal.tsx` — built on the existing `components/ui/Dialog.tsx`; confirm calls `useDeleteNoteMutation`, navigates to `/notes` on success; standard (non-destructive) primary button styling per spec's Ticket-Specific UX Decisions. Not rendered for a not-yet-created note.
  - Files: `apps/web/src/components/editor/DeleteNoteModal.tsx`
  - Scenario refs: 15, 16, 17, 18
  - Time: 25 min · `[PARALLEL]`
  - Depends on: T12

- [x] **T25.** `DeleteNoteModal.test.tsx` — open/cancel (no request sent)/confirm (calls `deleteNote` once, navigates to `/notes`) flow.
  - Files: `apps/web/src/components/editor/DeleteNoteModal.test.tsx`
  - Scenario refs: 15, 16, 17
  - Time: 20 min
  - Depends on: T24

## Phase 5 — Page Shell

- [x] **T26.** `NoteEditorPage.tsx` — composes a plain title `<input>` (validated on blur against the shared `titleSchema`) + `EditorToolbar` + `NoteEditor` + `TagCombobox` + `AutosaveStatusPill` + a Delete trigger (hidden for `mode="new"`) wired to `DeleteNoteModal`; drives `useAutosave`; for `mode="existing"` seeds initial state from `useNoteQuery(noteId)` and renders the `docs/UX.md` §2 full-page error state on `404 NOTE_NOT_FOUND`.
  - Files: `apps/web/src/components/editor/NoteEditorPage.tsx`
  - Scenario refs: 1, 2, 3, 4, 8, 15, 18, 20
  - Time: 40 min
  - Depends on: T14, T16, T18, T20, T22, T24

- [x] **T27.** `NoteEditorPage.test.tsx` — new-note empty render, title-gate inline validation, existing-note load, `404` full-page error state, Delete button visibility differing by `mode`.
  - Files: `apps/web/src/components/editor/NoteEditorPage.test.tsx`
  - Scenario refs: 1, 2, 3, 8, 18, 20
  - Time: 35 min
  - Depends on: T26

## Phase 6 — Routes

- [x] **T28.** Replace `apps/web/src/routes/notes.new.tsx` — `component` becomes `<AppShell><NoteEditorPage mode="new" /></AppShell>`; `beforeLoad` guard preserved verbatim.
  - Files: `apps/web/src/routes/notes.new.tsx`
  - Scenario refs: 1, 19
  - Time: 15 min · `[PARALLEL]`
  - Depends on: T26

- [x] **T29.** Replace `apps/web/src/routes/notes.$noteId.tsx` — `component` becomes `<AppShell><NoteEditorPage mode="existing" noteId={noteId} /></AppShell>`; removes the old `getNote`/`extractPlainText` read-only rendering; `beforeLoad` guard preserved verbatim.
  - Files: `apps/web/src/routes/notes.$noteId.tsx`
  - Scenario refs: 19, 20
  - Time: 15 min · `[PARALLEL]`
  - Depends on: T26

- [x] **T30.** Confirm `apps/web/src/routes/router.tsx` needs no structural change (both routes are already registered by AB-1011) — update only if either replaced file's export shape changed.
  - Files: `apps/web/src/routes/router.tsx`
  - Scenario refs: 19
  - Time: 10 min
  - Depends on: T28, T29

- [x] **T31.** Extend `apps/web/src/routes/router.test.tsx` — confirm/adjust guard coverage for `/notes/new` and `/notes/:id` against the new components (mock any new query calls `NoteEditorPage` makes on mount).
  - Files: `apps/web/src/routes/router.test.tsx`
  - Scenario refs: 19
  - Time: 20 min
  - Depends on: T30

## Phase 7 — Integration Check

- [x] **T32.** Manual verification pass (`pnpm dev`, real browser): create a note (title → autosave → `POST` → route swap to `/notes/:id`), apply toolbar formatting, create and attach a new tag, delete the note, and confirm `docs/UX.md` §5 modal focus behavior plus TipTap caret/placeholder rendering — jsdom can't fully prove ProseMirror rendering (plan.md Test Strategy). Confirm `apps/web/e2e/smoke.spec.ts` still passes unmodified.
  - Files: none (manual verification only)
  - Scenario refs: 1–21 (end-to-end manual pass)
  - Time: 25 min
  - Depends on: T27, T28, T29, T31

---

**Total estimated time:** ~12.3 hours across 32 tasks. Phase 1's and Phases 4–6's `[PARALLEL]`-tagged tasks can be distributed across contributors/subagents concurrently within their phase; no single task exceeds 45 minutes so none require `[SUBAGENT]` decomposition.

Before every commit (per CLAUDE.md): `pnpm build`, `pnpm lint --max-warnings 0`, `pnpm test` must all be green.
