---
ticket: AB-1012
type: FRONTEND
status: APPROVED
---

# AB-1012: Note Editor Frontend

## Overview

Implements the real note editor: a TipTap-based rich-text editor with a formatting toolbar, debounced autosave (create-on-first-save for new notes, PATCH-on-change for existing ones), on-the-fly tag creation/attachment (FR-UI-3), and a soft-delete action — replacing the AB-1011 throwaway stubs (`notes.new.tsx`, `notes.$noteId.tsx`) wholesale, per those routes' own documented precedent.

Four scope questions were resolved with the user before drafting:

1. **Autosave delay is 2000ms**, following FR-UI-2's literal business rule ("e.g. 2 seconds after typing stops") rather than `docs/UX.md` §1's 1500ms, which is documentation drift this ticket does not attempt to reconcile in `UX.md` itself (out of scope — a `fix-bundle`-style correction, if wanted, is a separate concern).
2. **New notes use create-on-first-save**: `/notes/new` renders the editor locally with no note yet persisted. Autosave holds off entirely until the title has at least one character (required by `titleSchema`); the first successful autosave `POST`s the note, then the route transitions to `/notes/:id`, and every subsequent autosave is a `PATCH`.
3. **This ticket adds the note-level Delete (soft-delete) action.** No delete affordance exists anywhere in the app yet (AB-1011's notes list didn't add one), and this is the only page that owns a single note's full context — a natural, and currently the only scheduled, home for it before FR-E2E-1's journey needs it.
4. **Editor toolbar scope is TipTap StarterKit basics**: bold, italic, strikethrough, headings (H1–H3), bullet/ordered lists, blockquote, code block, undo/redo. No link mark, no further extensions.

## Goals

- Add TipTap as a runtime dependency: `@tiptap/react`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm` (exact pinned versions per AGENTS.md §3 — verify current stable releases at implementation time, same pattern SDS §2.1 uses for the Postgres image tag).
- Replace `notes.new.tsx` and `notes.$noteId.tsx` with a shared `NoteEditorPage`, parameterized by mode (`new` — no id yet; `existing` — id from route params).
- `NoteEditor`: TipTap `useEditor` wrapper configured with `StarterKit` only, emitting the current TipTap JSON document on every change.
- `EditorToolbar`: buttons for Bold / Italic / Strike / H1–H3 / Bullet List / Ordered List / Blockquote / Code Block / Undo / Redo, each reflecting active-formatting state at the cursor (`aria-pressed`).
- A plain title `<input>` above the editor body, validated on blur against the shared `titleSchema` (1–200 chars), independent of the TipTap document.
- `useAutosave` hook: debounces 2000ms after the last title/body change.
  - While the title is empty, autosave never fires (no request, no error) — required because `titleSchema`/`updateNoteSchema` both reject an empty title.
  - New note, title non-empty: fires `POST /notes` `{ title, body, tagIds: pendingTagIds }`; on success, navigates (`replace: true`, so the browser back button skips `/notes/new`) to `/notes/:id` with the returned id, and every later change becomes a `PATCH`.
  - Existing note: fires `PATCH /notes/:id` with only the changed fields (`title`/`body`).
  - On a save failure, fires exactly one automatic retry. If that retry also fails, autosave stops auto-retrying, `editorStatusStore.status` becomes `'error'`, and the currently-typed content stays visible and intact in the editor/title input (nothing reverts) — this is what "preserves a local draft" means per FR-UI-2; see State Management for why no separate persisted-draft storage is introduced.
  - The error pill (`AutosaveStatusPill`, per `docs/UX.md` §1) offers a manual retry button; a manual retry click is itself eligible for the same one-automatic-retry-on-failure behavior.
- `AutosaveStatusPill`: `saving` / `saved` (auto-hides after 2s) / `error` states per `docs/UX.md` §1.
- `TagCombobox` (FR-UI-3): shows attached tags as removable chips (name + fixed-palette color, resolved from the existing `useTagsQuery()` cache — same technique AB-1011's `NoteCard` already uses) plus an add-tag input.
  - Typing a name that case-insensitively matches an existing tag (from the `useTagsQuery()` cache) selects that tag — no `POST /tags` call.
  - Typing a name with no case-insensitive match offers "Create '<name>'", which calls `POST /tags { name, color: <random from the shared TAG_COLORS palette> }` (frontend picks the random color, per AB-1006's Non-Goals).
  - If that `POST /tags` unexpectedly returns `409 TAG_NAME_DUPLICATE` (a race — e.g. the same tag created concurrently in another tab), the combobox refetches `GET /tags` and attaches the now-existing tag instead of surfacing an error.
  - Attaching/detaching a tag on an **existing** note fires an immediate `PATCH /notes/:id { tagIds }` (full-replacement set, per AB-1006) — not batched into the debounced autosave, since it's a discrete click, not continuous typing.
  - On a **new**, not-yet-created note, tag selections are held in local `pendingTagIds` state and included in the first `POST /notes` autosave fires.
- `DeleteNoteModal`: confirmation modal before `DELETE /notes/:id`; on confirm, navigates to `/notes` and invalidates the notes-list query cache so the note disappears immediately. Only rendered/enabled once the note has an id (existing notes) — nothing to delete on an unsaved `/notes/new` draft.
- `uiCopy.ts` gains new keys: `AUTOSAVE_SAVING`, `AUTOSAVE_SAVED`, `AUTOSAVE_ERROR`, `DELETE_NOTE_CONFIRM_HEADING`, `DELETE_NOTE_CONFIRM_BODY`, `TAG_CREATE_LABEL`.

## Non-Goals

- No sharing UI (`ShareModal`, share links list) — AB-1014.
- No version history UI (list, preview, split-view compare, restore) — AB-1015. This ticket only triggers the version snapshots AB-1004 already writes as a side effect of `PATCH /notes/:id`; it renders none of that history.
- No search UI — AB-1013.
- No dedicated tag-management page (rename/recolor/delete a tag) — `TagCombobox` only *creates* and *attaches/detaches* tags; editing or deleting a tag outright has no UI anywhere yet and isn't scoped here.
- No link mark / hyperlink support in the editor (resolved with user — StarterKit basics only; see Overview point 4).
- No "unsaved changes" navigation guard (e.g. `beforeunload` warning, blocking in-app navigation while a save is pending) — FR-UI-2's literal scope is autosave-retry-on-network-failure, not navigation-time data loss; out of scope for this ticket.
- No persisted (`localStorage`/`IndexedDB`) draft storage that survives a hard reload — see State Management for why the in-memory-only `draftStore` satisfies FR-UI-2 as written.
- No manual "Save" button — autosave is the only save mechanism, matching FR-UI-2's literal wording ("Notes must auto-save").
- No backend changes — AB-1004/AB-1006 contracts are treated as fixed and consumed as-is.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-NOTE-1 | Create Note (frontend) — create-on-first-save via the editor, optional `tagIds` included on first save |
| FR-NOTE-3 | Update Note (frontend) — debounced autosave `PATCH`, each triggering AB-1004's version snapshot server-side |
| FR-NOTE-4 | Soft Delete Note (frontend) — `DeleteNoteModal` + `DELETE /notes/:id`, the app's first delete affordance |
| FR-UI-2 | Editor & Autosave — TipTap rich-text editor, 2000ms debounce, one automatic retry on failure, error state with preserved local content |
| FR-UI-3 | Tagging UX — on-the-fly tag creation from the editor with an automatically assigned random color |
| FR-UI-1 (partial) | Loading/disabled feedback on the Delete confirm button; autosave status pill as the background-operation feedback for this page |

## Pages / Components

```
apps/web/src/
  routes/
    notes.new.tsx           REPLACED: real editor page, mode="new" (no id yet)
    notes.$noteId.tsx       REPLACED: real editor page, mode="existing" (id from params)
  components/
    editor/
      NoteEditorPage.tsx     shared page shell: title input, EditorToolbar, NoteEditor, TagCombobox, AutosaveStatusPill, Delete button
      NoteEditor.tsx          TipTap useEditor wrapper (StarterKit only)
      EditorToolbar.tsx       formatting buttons, aria-pressed active state
      AutosaveStatusPill.tsx  saving / saved / error pill (docs/UX.md §1)
      TagCombobox.tsx         attached-tag chips + add-tag input; case-insensitive match, on-the-fly create (FR-UI-3)
      DeleteNoteModal.tsx     confirm-before-soft-delete modal
  hooks/
    useAutosave.ts            2000ms debounce; create-vs-update decision; one automatic retry on failure; reports to editorStatusStore/draftStore
  stores/
    editorStatusStore.ts      Zustand: status: 'idle' | 'saving' | 'saved' | 'error'
    draftStore.ts             Zustand: latest unsent { title, body } keyed by noteId | 'new'; cleared on successful save
  lib/
    notesApi.ts               EXTENDED: createNote, updateNote, deleteNote, createTag
    notesQueries.ts           EXTENDED: useCreateNoteMutation, useUpdateNoteMutation, useDeleteNoteMutation, useCreateTagMutation
    tagColor.ts                NEW: pickRandomTagColor() over the shared TAG_COLORS palette
    uiCopy.ts                  EXTENDED: autosave + delete-confirm + tag-create copy keys
```

- `router.tsx`'s existing registration of `/notes/new` and `/notes/:id` is unchanged; only each route's `component` is replaced. The existing `beforeLoad` guard (redirect to `/login` if unauthenticated) is preserved unchanged on both.
- `notes.$noteId.tsx`'s previous `getNote`/`extractPlainText` read-only rendering is removed — the real editor is now both the view and the edit surface for a single note (no separate read-only preview path in this ticket).

## State Management

- `editorStatusStore` (Zustand, no `persist`): `{ status: 'idle' | 'saving' | 'saved' | 'error' }`. Reset to `'idle'` on mount of each editor page instance (keyed implicitly by the page lifecycle, not stored per-noteId — only one editor is ever open at a time).
- `draftStore` (Zustand, no `persist`): `{ [key: string]: { title: string; body: TipTapDocument } }` keyed by `noteId` (or the literal `'new'` before a note has an id). Updated on every keystroke (title or body), cleared for a key on that key's successful save.
  - **In-memory only, deliberately** — mirrors `authStore`'s and `notesViewStore`'s established no-`persist` pattern (AGENTS.md §7, SDS §12 lists `draftStore` alongside these with no persistence middleware called out). FR-UI-2's "preserves draft locally" is satisfied by the draft never being lost *from the visible editor UI* across a failed-and-not-yet-retried save — not by surviving a hard page reload. Introducing `localStorage`/`IndexedDB` persistence here would be a scope expansion beyond what FR-UI-2 or SDS §12 actually specify.
  - Practically, `draftStore` is close to redundant with the title/body already sitting in the mounted editor's own React/TipTap state; it exists primarily so a future ticket (if ever needed) has a single documented place to add persistence, and so `AutosaveStatusPill`'s error state has an explicit "this is the preserved draft" data source to point at rather than relying on implicit component state.
- `TanStack Query`: `useNoteQuery(noteId)` (new — `GET /notes/:id`, seeds the editor's initial title/body/tagIds on mount for `mode="existing"`), plus mutations `useCreateNoteMutation`, `useUpdateNoteMutation`, `useDeleteNoteMutation`, `useCreateTagMutation`. Successful create/update/delete invalidate `['notes', 'list', ...]`, `['notes', 'trash', ...]`, and `['notes', 'detail', noteId]` as appropriate so AB-1011's list/trash views stay consistent without a manual refetch. `useTagsQuery()` (AB-1011) is reused unchanged for the combobox's catalog.
- No new client state for "which tag is being typed" beyond a component-local `useState` in `TagCombobox` — matches AB-1011's precedent of keeping single-component transient UI state local rather than in a store.

## API Integration

`lib/notesApi.ts` gains four functions, all wrapping the existing `apiRequest<T>()` (`apiClient.ts`, unchanged — its 401→refresh→retry interceptor applies here with no new logic needed):

- `createNote({ title, body, tagIds }) → Note` — `POST /notes`.
- `updateNote(id, { title?, body?, tagIds? }) → Note` — `PATCH /notes/:id`.
- `deleteNote(id) → void` — `DELETE /notes/:id` (`204`).
- `createTag({ name, color }) → Tag` — `POST /tags`.

`getNote(id)` (already added in AB-1011 for the throwaway stub) is reused as-is for `useNoteQuery`.

Error handling, all via the existing `ApiRequestError` / `errorMessages.ts` pipeline:
- `400 VALIDATION_FAILED` on create/update → surfaced as inline field errors where the field is identifiable (title), otherwise a toast.
- `404 NOTE_NOT_FOUND` on update/delete of a note removed elsewhere (race with another session, or the purge job) → error toast; `useAutosave` stops retrying and sets `editorStatusStore.status = 'error'` rather than attempting to recreate the note.
- `422 INVALID_TAG` — not expected in normal operation (the combobox only ever offers tags from the caller's own `useTagsQuery()` cache or ones it just created), but if it occurs (stale cache race) it surfaces as a toast and the tag attach is rolled back client-side.
- `409 TAG_NAME_DUPLICATE` on `POST /tags` — handled specially, not shown as an error (see Goals: refetch-and-attach).

## Ticket-Specific UX Decisions

- **DOMPurify — no applicable call site in this ticket** (flagged explicitly, per AGENTS.md §11/SDS §5's rule that every render of note body content must go through DOMPurify before display): this ticket's only render surface for note content is the live TipTap editor itself, which never uses `dangerouslySetInnerHTML` — TipTap/ProseMirror renders through its own schema-constrained DOM view. Because the editor is configured with `StarterKit` only (no `Link` extension, no arbitrary-HTML node type), there is no mark/attribute (e.g. `href="javascript:..."`) or node type through which injected content could execute; ProseMirror's schema silently drops any node/mark type it doesn't recognize when parsing a document (e.g. one created by a crafted direct API call bypassing the UI). The first ticket that introduces an actual `dangerouslySetInnerHTML`/`generateHTML`-based read-only render (a share view, a version-compare preview) is AB-1014 or AB-1015, and must apply DOMPurify at that point.
- **Autosave delay resolved as 2000ms** (FRS literal value), not `docs/UX.md` §1's 1500ms — see Overview point 1. This ticket does not modify `UX.md`.
- **Create-on-first-save, not immediate-draft-POST** (resolved with user): avoids ever creating a `Note` row with a placeholder title the user didn't choose, and avoids a `PATCH` on the very first keystroke. The tradeoff is that a `pendingTagIds` local-state layer is needed for tag selections made before the first save (see Goals) — accepted as the simpler cost.
- **Delete has a confirmation modal but standard (non-destructive) button styling**: `docs/UX.md` §5's enumerated destructive-action scope (revoke share, permanent delete from Trash, restore version) does not name note soft-delete, and soft-delete is fully reversible via Trash for 30 days (unlike the three enumerated actions). Following the same reasoning AB-1011 applied to its `RestoreConfirmModal`, `DeleteNoteModal` still requires an explicit confirmation click (interrupting an in-progress edit by deleting it is disruptive enough to warrant a pause) but uses a standard primary button, not `variant="destructive"`/red, and does not need Cancel `autoFocus` beyond the general good-practice default.
- **Tag combobox resolves duplicates client-side rather than surfacing `409`s**: case-insensitive matching against the `useTagsQuery()` cache before creating, plus a refetch-and-retry path if a `409 TAG_NAME_DUPLICATE` still occurs (concurrent-tab race), keeps FR-UI-3's "type a name, get a tag" flow from ever showing the user a raw duplicate-name error for what is, from their perspective, just selecting a tag that already exists.
- **Title-empty gate on autosave**: since `titleSchema`/`updateNoteSchema` reject an empty title, `useAutosave` treats an empty title as "not ready to save" rather than attempting a request that would `400`. This applies symmetrically to new notes (no `POST` until titled) and existing notes (no `PATCH` while the title has been cleared mid-edit) — body edits are still held in `draftStore` during this state, just not sent.

## Scenarios

1. User navigates to `/notes/new` → empty title input + empty TipTap body render; no network request fires; `AutosaveStatusPill` shows no state (idle).
2. User types a title only → 2000ms after the last keystroke, `POST /notes` fires with the typed title, the (empty) body, and any `pendingTagIds`; on success the route replaces to `/notes/:id`, pill shows "All changes saved".
3. User types body content before entering any title → autosave does not fire (no request, no error) until the title has at least one character.
4. Existing note: user edits the title and/or body → 2000ms after the last keystroke, `PATCH /notes/:id` fires with only the changed field(s); pill cycles `saving` → `saved`.
5. An autosave request fails once (e.g. transient network blip) → exactly one automatic retry fires immediately; if it succeeds, the pill shows `saved` and the user never sees an error.
6. An autosave request fails twice in a row (initial + the one retry) → pill shows the `error` state with a manual retry affordance; the title/body currently on screen are untouched (nothing reverts, nothing is lost from the visible editor).
7. User clicks the manual retry button on the error pill → another save attempt fires (itself eligible for one further automatic retry on failure); on success the pill returns to `saved`.
8. User clears an existing note's title to empty mid-edit → autosave stops firing while the title is empty; an inline validation message appears under the title field; body edits are still tracked but not sent.
9. User applies Bold, an H2 heading, and a bullet list via the toolbar → TipTap applies each mark/node; the corresponding toolbar buttons show `aria-pressed="true"` while the cursor is inside that formatting.
10. User presses the undo shortcut after a formatting change → TipTap's built-in history reverts the last edit.
11. User types a tag name that case-insensitively matches an existing tag (e.g. types `"work"`, an existing tag is named `"Work"`) → the combobox selects the existing tag; no `POST /tags` is sent.
12. User types a genuinely new tag name → `POST /tags { name, color: <random> }` fires; on success the tag is attached (existing note: immediate `PATCH /notes/:id { tagIds }`; unsaved new note: added to local `pendingTagIds`, included in the next autosave).
13. Two tabs concurrently create a tag with the same name → the second tab's `POST /tags` returns `409 TAG_NAME_DUPLICATE`; that tab refetches `GET /tags` and attaches the now-existing tag instead of showing an error.
14. User removes an attached tag chip → the tag is detached (existing note: immediate `PATCH /notes/:id` with the tag excluded from `tagIds`; unsaved new note: removed from local `pendingTagIds` only).
15. User clicks "Delete" on an existing note → `DeleteNoteModal` opens for confirmation.
16. User confirms delete → `DELETE /notes/:id` fires; on success the user is navigated to `/notes`, and the notes-list query cache is invalidated so the note is gone from the list immediately.
17. User cancels the delete confirmation → modal closes, no request sent, editor state unchanged.
18. `/notes/new` (no id yet) renders no Delete button — there is nothing to delete until the first autosave creates the note.
19. Unauthenticated user navigates directly to `/notes/new` or `/notes/:id` → redirected to `/login` (existing AB-1010/1011 route-guard pattern, unchanged).
20. User navigates to `/notes/:id` for a note that doesn't exist, isn't theirs, or is soft-deleted → `404 NOTE_NOT_FOUND` renders the full-page error state per `docs/UX.md` §2 ("Return to Active Notes" action), not a raw error or a broken editor.
21. While editing an existing note, a background process removes it (race, e.g. the 30-day purge already ran on an already-deleted note reached via a stale link) → the next autosave's `404 NOTE_NOT_FOUND` surfaces as an error toast, and the pill shows the `error` state without attempting to recreate the note.

## Dependencies

- AB-1004 (Core Note Models) — merged; `POST`/`PATCH`/`DELETE /notes/:id` contracts consumed as-is; every `PATCH` this ticket sends continues to trigger AB-1004's server-side version snapshot unchanged.
- AB-1006 (Tags Architecture) — merged; `POST /tags`, `tagIds` on note create/update, and the fixed `TAG_COLORS` palette (`packages/shared`) consumed as-is.
- AB-1010 (Auth Frontend) — merged; `authStore`, `apiClient.ts`, `errorMessages.ts`, and the route-guard pattern reused unchanged.
- AB-1011 (Notes List Frontend) — merged; this ticket wholesale-replaces its `notes.new.tsx`/`notes.$noteId.tsx` placeholders, extends its `notesApi.ts`/`notesQueries.ts`/`uiCopy.ts` in place, and reuses `AppShell` and `useTagsQuery()` unchanged.
- New runtime dependencies: `@tiptap/react`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/pm` (exact pinned versions, added to `apps/web/package.json`).

## Open Questions

None — autosave delay, new-note creation strategy, delete-action placement, and editor toolbar scope were all resolved with the user before drafting; see Overview and Ticket-Specific UX Decisions.
