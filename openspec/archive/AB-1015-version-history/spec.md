---
ticket: AB-1015
type: FRONTEND
status: APPROVED
---

# AB-1015: Version History Frontend

## Overview
Builds the owner-facing `VersionHistoryModal` (version list, split-view preview, restore-with-confirmation) that AB-1009 deliberately left unbuilt. Consumes the `NoteVersionSummary`/`NoteVersionDetail` contract already exported from `packages/shared` (added by AB-1009) with no shared-package changes needed. Follows the same Dialog-based pattern already established by `ShareModal` (AB-1014) and `RestoreConfirmModal` (AB-1011).

## Goals
- `VersionHistoryModal` component, triggered from a new "History" icon button in `NoteEditorPage`'s header (alongside the existing Share and Delete buttons), for existing notes only (`mode === 'existing'`).
  - Version list via `GET /notes/:id/versions`, newest first, each row showing `version`, `title`, `savedAt`.
  - Selecting a row fetches that version's full content via `GET /notes/:id/versions/:versionId` and renders a split view: the current (last-saved) title/body on one side, the selected historical version's title/body on the other.
  - Restore requires an explicit confirmation step (apps/web/CLAUDE.md §5 / FR-UI-4) before calling `POST /notes/:id/versions/:versionId/restore`.
  - On successful restore, the currently-open editor reflects the reverted content without a page reload (see Ticket-Specific UX Decisions).
- New API/query functions wiring TanStack Query hooks for all three version endpoints.
- Reuses the existing `sanitizeNoteBody` helper (built in AB-1014, `apps/web/src/lib/sanitize.ts`) for both split-view panes — no new sanitize function needed since `NoteVersionDetail.body` is the same `TipTapDocument` shape as `Note.body`.

## Non-Goals
- No changes to `packages/shared` — `NoteVersionSummary`, `NoteVersionDetail`, and `VERSION_NOT_FOUND` already exist from AB-1009.
- No line-by-line diff/text-highlighting algorithm — FR-UI-4 asks for a "split view," satisfied by rendering both sides side-by-side, not a computed diff.
- No editing capability inside the version preview — read-only, matching FR-VER-1.
- No tag display anywhere in the version preview — `NoteVersion` never stored `tagIds` (SDS §10); restoring never touches the note's current tags.
- No changes to the backend restore transaction, purge job, or API contract — that is AB-1009's completed scope.
- AB-1016's E2E journey step ("Restore Version") is out of scope here; this ticket only needs to make that step possible for AB-1016 to later drive.

## FRs Covered
| FR | Coverage |
|---|---|
| FR-VER-1 | `VersionHistoryModal`'s list (via `GET /notes/:id/versions`) and single-version preview (via `GET /notes/:id/versions/:versionId`) |
| FR-VER-2 | Restore button + confirmation modal calling `POST /notes/:id/versions/:versionId/restore`; note's current tags are never touched (already guaranteed backend-side by AB-1009) |
| FR-UI-4 | Split view comparing current vs. historical state; restore requires explicit confirmation via `RestoreVersionConfirmModal` before the action is taken |

## Pages / Components
- `apps/web/src/components/versions/VersionHistoryModal.tsx` — `Dialog`-based (matches `ShareModal`'s structure, widened via `className="max-w-4xl"` to accommodate the split view). Takes `noteId`, `currentTitle`, `currentBody`, `open`, `onOpenChange`. Contains:
  - A version list (left column) from `useVersionsQuery(noteId)`: each row shows `version`, formatted `savedAt`, and `title`; clicking a row sets local `selectedVersionId` state and fetches its detail via `useVersionDetailQuery(noteId, selectedVersionId, { enabled: selectedVersionId !== null })`.
  - A split-view pane (right side, rendered once a version is selected and its detail has loaded): two columns headed "Current" and `Version {n} · {formatted savedAt}`, each rendering `sanitizeNoteBody(...)` output via `dangerouslySetInnerHTML`. The "Current" column always renders `currentTitle`/`currentBody` as passed down from `NoteEditorPage` (i.e. `noteQuery.data`), never the selected version's own data.
  - A "Restore this version" button under the selected version's column, opening `RestoreVersionConfirmModal`.
  - Empty-state text when the list is empty (note has never been updated since creation) — no split-view or restore controls rendered in that case.
- `apps/web/src/components/versions/RestoreVersionConfirmModal.tsx` — nested confirmation `Dialog` (mirrors `RestoreConfirmModal` from AB-1011 exactly), auto-focused Cancel button, red destructive Confirm button, calls `useRestoreVersionMutation(noteId)`.
- `apps/web/src/components/editor/NoteEditorPage.tsx`:
  - Add a `History` (lucide-react) icon button next to the existing `Share2`/`Trash2` buttons (same `mode === 'existing' && noteId` guard), toggling a `versionsModalOpen` state exactly like `deleteModalOpen`/`shareModalOpen`.
  - `EditorBody` is now rendered with `key={noteQuery.data.version}` from the parent `NoteEditorPage`. Restoring a version bumps `Note.version` server-side; once the note-detail query refetches (see API Integration), the changed `version` key forces React to remount `EditorBody`, reinitializing its local `title`/`body` state from the fresh `initialTitle`/`initialBody` props — no `window.location` reload, no explicit imperative reset needed.

## State Management
- No new Zustand store. Version list/detail data is server state — TanStack Query only, per apps/web/CLAUDE.md §1.
- `VersionHistoryModal`'s open/closed state (`versionsModalOpen`) lives in `NoteEditorPage`, matching `deleteModalOpen`/`shareModalOpen`. `selectedVersionId` is local `useState` inside `VersionHistoryModal` itself, reset to `null` whenever the modal is reopened.

## API Integration
- New functions in `apps/web/src/lib/notesApi.ts`:
  - `listVersions(noteId): Promise<NoteVersionSummary[]>` → `GET /notes/:id/versions`
  - `getVersionDetail(noteId, versionId): Promise<NoteVersionDetail>` → `GET /notes/:id/versions/:versionId`
  - `restoreVersion(noteId, versionId): Promise<Note>` → `POST /notes/:id/versions/:versionId/restore`
- New hooks in `apps/web/src/lib/notesQueries.ts`:
  - `versionsKeys.list(noteId)`, `versionsKeys.detail(noteId, versionId)`
  - `useVersionsQuery(noteId)`
  - `useVersionDetailQuery(noteId, versionId, options: { enabled?: boolean })`
  - `useRestoreVersionMutation(noteId)` — on success, invalidates `notesKeys.detail(noteId)` (so `noteQuery` in `NoteEditorPage` refetches with the bumped `version`, triggering the `EditorBody` remount described above) and `versionsKeys.list(noteId)` (so the new pre-restore snapshot appears at the top of the list immediately if the modal is reopened).
- Existing 401-retry logic in `apiClient.ts` is untouched; all three endpoints require auth like every other `/notes/:id/*` route, so no client changes are needed there.

## Ticket-Specific UX Decisions
- **Dialog modal, not a new Drawer primitive (resolved with user):** `VersionHistoryModal` is built as a `Dialog`/`DialogContent` (matching `ShareModal`), just widened via `className`. SDS §1's "`VersionDrawer`" naming is illustrative, not a literal requirement for a new slide-in primitive — no new Radix component is introduced.
- **Post-restore editor sync (resolved with user):** handled via `key={noteQuery.data.version}` on `EditorBody` plus the existing `notesKeys.detail(noteId)` invalidation — no full-route navigation/reload.
- **Split-view baseline (resolved with user):** the "Current" pane always renders `noteQuery.data`'s last-saved title/body, never the live in-editor unsaved draft. This mirrors how the rest of the app treats `Note.title`/`Note.body` as the single canonical "current" source and avoids running a possibly-invalid mid-edit TipTap document through `generateHTML`.
- **DOMPurify reuse (AGENTS.md §11 / apps/web/CLAUDE.md, mandatory):** both split-view panes render through the existing `sanitizeNoteBody` helper — no new sanitize function, no `dangerouslySetInnerHTML` call anywhere in this ticket receives unsanitized content.
- **Restore confirmation (apps/web/CLAUDE.md §5 / FR-UI-4):** restore is destructive-adjacent (it mutates the live note, even though non-destructive to history) and gets its own confirmation modal (`RestoreVersionConfirmModal`) with a focused Cancel button by default and a red destructive Confirm button — identical treatment to `RestoreConfirmModal` (trash) and `RevokeShareLinkModal` (shares).
- **Icon and placement:** `History` icon from `lucide-react`, placed to the left of the `Share2` button in `NoteEditorPage`'s header, `aria-label="Version history"`.
- **Empty state:** a note with zero historical versions (never edited since creation) shows plain empty-state text in the list column; no split view, no restore control is rendered until at least one version exists and is selected.

## Scenarios
1. Owner opens the History icon on an existing note with 3 historical versions → modal opens with the list, newest first, no version preselected, no split view yet.
2. Owner opens the History icon on a note that has never been updated since creation (zero versions) → empty-state message shown, no restore control.
3. Owner clicks a version row → split view appears: left = current title/body (sanitized), right = selected version's title/body (sanitized), while its detail request is pending a small loading indicator is shown in place of the right pane.
4. Owner clicks "Restore this version" → `RestoreVersionConfirmModal` appears; clicking Cancel dismisses it with no request sent, `VersionHistoryModal` remains open and unchanged.
5. Owner confirms restore → `POST .../restore` fires → on success, `notesKeys.detail(noteId)` and `versionsKeys.list(noteId)` are invalidated, both modals close, `EditorBody` remounts (keyed on the now-incremented `version`) showing the restored title/body, and the version list — if reopened — now shows a new top entry snapshotting what was current immediately before the restore.
6. Owner restores a version on a note whose tags have changed since that version was saved → after restore, `TagCombobox`'s displayed tags are unchanged (unaffected by the restore, per FR-VER-2/backend guarantee already covered by AB-1009's own tests).
7. A restore request 404s (e.g. `VERSION_NOT_FOUND` from a race with another restore) → error toast via `getErrorMessage`, `RestoreVersionConfirmModal` stays open, no editor remount occurs, no incorrect content is ever shown.
8. A historical version's body contains content that would render unsafely via `generateHTML` → `sanitizeNoteBody`'s DOMPurify pass strips it before it reaches `dangerouslySetInnerHTML`, exactly as it already does for the current note body and the public share page.
9. Owner opens the modal, selects a version, then closes the modal (Escape/overlay-click) without restoring → no mutation is ever sent, editor content is unchanged, and reopening the modal resets `selectedVersionId` back to `null`.
10. Owner opens the modal for a note currently in Trash (FR-VER-1: version history remains accessible during the 30-day soft-delete window) → list and preview both load normally, since `NoteEditorPage`'s existing note-detail fetch and the version endpoints both ignore trash state for owner-scoped reads (AB-1009).

## Dependencies
- AB-1009 (Version History Architecture, backend) — merged/archived. Supplies the three endpoints and `NoteVersionSummary`/`NoteVersionDetail` shared types this ticket consumes unchanged.
- AB-1010 (Auth Frontend) — merged/archived. `NoteEditorPage`'s auth-gated route and `apiClient.ts`'s token handling are reused as-is.
- AB-1012 (Note Editor Frontend) — merged/archived. `NoteEditorPage.tsx`, `Dialog.tsx`, and the `deleteModalOpen`/`DeleteNoteModal` pattern are the components this ticket extends/mirrors.
- AB-1014 (Sharing Frontend) — merged/archived. `sanitizeNoteBody` (`apps/web/src/lib/sanitize.ts`) is reused as-is; no new sanitize function is introduced.
- AB-1016 (E2E Testing) depends on this ticket for the Restore Version step of the core journey.

## Open Questions
None — layout (Dialog vs. new Drawer primitive), post-restore editor sync strategy, and the split-view comparison baseline were all resolved with the user before drafting; see Ticket-Specific UX Decisions.
