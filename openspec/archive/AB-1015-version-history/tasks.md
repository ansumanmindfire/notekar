---
ticket: AB-1015
status: APPROVED
---

# AB-1015: Version History Frontend — Tasks

Ordered so each task leaves `pnpm build`/`pnpm test` passing before the next begins. `[PARALLEL]` tasks are independent of their siblings at that point in the sequence (safe to hand to separate agents/contributors). `[SUBAGENT]` marks tasks estimated over 45 minutes.

## Foundation

- [x] **1. Verify `lucide-react` exports `History`** — 5 min — `[PARALLEL]`
  Files: none (read-only check of installed type defs)
  Scenarios: none directly; unblocks tasks 7, 9, 11 (icon import)

- [x] **2. Add version-history copy to `uiCopy.ts`** — 15 min — `[PARALLEL]`
  Add `VERSION_HISTORY` (heading, emptyState, currentLabel, restoreButton) and `RESTORE_VERSION_CONFIRM` (heading, body, confirm, cancel — matching `RESTORE_CONFIRM`'s shape).
  Files: `apps/web/src/lib/uiCopy.ts`
  Scenarios: none directly; unblocks tasks 7, 9

- [x] **3. Add version API functions to `notesApi.ts`** — 25 min — `[PARALLEL]`
  `listVersions(noteId): Promise<NoteVersionSummary[]>`, `getVersionDetail(noteId, versionId): Promise<NoteVersionDetail>`, `restoreVersion(noteId, versionId): Promise<Note>`.
  Files: `apps/web/src/lib/notesApi.ts`
  Scenarios: none directly; unblocks task 5

- [x] **4. Test the new `notesApi.ts` functions** — 20 min
  Cover: all three functions hit the correct method/URL (`GET .../versions`, `GET .../versions/:versionId`, `POST .../versions/:versionId/restore`) and return the typed response.
  Files: `apps/web/src/lib/notesApi.test.ts`
  Depends on: 3

## Query Layer

- [x] **5. Add version query/mutation hooks to `notesQueries.ts`** — 25 min
  `versionsKeys.list(noteId)`, `versionsKeys.detail(noteId, versionId)`, `useVersionsQuery(noteId)`, `useVersionDetailQuery(noteId, versionId, { enabled? })`, `useRestoreVersionMutation(noteId)` (invalidates both `notesKeys.detail(noteId)` and `versionsKeys.list(noteId)` on success).
  Files: `apps/web/src/lib/notesQueries.ts`
  Depends on: 3

- [x] **6. Test the new hooks, incl. invalidation targets and key scoping** — 25 min
  Assert `useRestoreVersionMutation` invalidates exactly `notesKeys.detail(noteId)` and `versionsKeys.list(noteId)` (plan.md risk #5), not a bare `['notes']` prefix; assert `versionsKeys.detail` is scoped by both `noteId` and `versionId` (plan.md risk #4).
  Files: `apps/web/src/lib/notesQueries.test.ts`
  Depends on: 5

## Restore Confirmation Modal

- [x] **7. Build `RestoreVersionConfirmModal.tsx`** — 25 min
  Nested `Dialog` mirroring `RestoreConfirmModal.tsx`'s structure exactly: auto-focused Cancel, red destructive Confirm, `Loader2` spinner while `useRestoreVersionMutation` is pending, error toast via `getErrorMessage` on failure, `onRestored` callback fired only on success (mirrors `RestoreConfirmModal`'s `onRestored` prop, plan.md risk #2).
  Files: `apps/web/src/components/versions/RestoreVersionConfirmModal.tsx`
  Depends on: 1, 2, 5

- [x] **8. Test `RestoreVersionConfirmModal.tsx`** — 20 min
  Cover: Cancel closes with no request sent and never calls `onRestored` (scenario 4); Confirm calls the mutation with the right `(noteId, versionId)`, pending state disables both buttons and shows the spinner, `onRestored` fires exactly once on success (scenario 5); mutation rejection (e.g. `VERSION_NOT_FOUND`) shows an error toast, modal stays open, `onRestored` never fires (scenario 7).
  Files: `apps/web/src/components/versions/RestoreVersionConfirmModal.test.tsx`
  Scenarios: 4, 5, 7
  Depends on: 7

## Version History Modal

- [x] **9. Build `VersionHistoryModal.tsx`** — 50 min — `[SUBAGENT]`
  Version list (left column) from `useVersionsQuery`, newest first; clicking a row sets `selectedVersionId` (reset to `null` on reopen) and fetches its detail via `useVersionDetailQuery`; split view once loaded — "Current" column always renders the `currentTitle`/`currentBody` props via `sanitizeNoteBody`, selected-version column renders the fetched detail via `sanitizeNoteBody`; "Restore this version" button opens `RestoreVersionConfirmModal`, whose `onRestored` closes both modals (`onOpenChange(false)` on this modal too, plan.md risk #2); empty-state text when the list is empty, no split-view/restore controls in that case.
  Files: `apps/web/src/components/versions/VersionHistoryModal.tsx`
  Scenarios: 1, 2, 3, 6, 9, 10
  Depends on: 1, 2, 5, 7

- [x] **10. Test `VersionHistoryModal.tsx`** — 45 min — `[SUBAGENT]`
  Cover scenario 1 (open with 3 versions → list newest-first, nothing preselected, no split view yet), 2 (zero versions → empty state, no restore control), 3 (select a row → split view shows both sanitized panes, loading indicator while detail is pending), 6 (restore does not touch/re-render tag data — no `TagCombobox` interaction happens inside this component), 8 integration check (a version body with dangerous markup never appears in the rendered DOM — reuses `sanitize.test.ts`'s existing unit coverage of `sanitizeNoteBody` per plan.md's test-strategy note, no new sanitize-layer test needed), 9 (close without restoring sends no request; reopening resets `selectedVersionId` to `null`), 10 (list/detail load normally when the underlying note query reflects a `deletedAt`-set note).
  Files: `apps/web/src/components/versions/VersionHistoryModal.test.tsx`
  Scenarios: 1, 2, 3, 6, 8, 9, 10
  Depends on: 9

## Editor Integration

- [x] **11. Wire the History button and version-keyed remount into `NoteEditorPage.tsx`** — 30 min
  Add `History` icon button next to the existing `Share2`/`Trash2` buttons (same `mode === 'existing' && noteId` guard), `versionsModalOpen` state toggled the same way as `deleteModalOpen`/`shareModalOpen`, render `VersionHistoryModal` conditionally with `currentTitle`/`currentBody` from `noteQuery.data`; render `EditorBody` with `key={noteQuery.data.version}` (plan.md risk #1) so a version bump after restore remounts it with fresh `initialTitle`/`initialBody`.
  Files: `apps/web/src/components/editor/NoteEditorPage.tsx`
  Depends on: 1, 9

- [x] **12. Test the History button wiring and remount behavior in `NoteEditorPage.test.tsx`** — 30 min
  Mock `VersionHistoryModal` the same way `DeleteNoteModal`/`ShareModal` are already mocked; assert the History button is absent in `mode="new"`, present in `mode="existing"`, and clicking it opens the (mocked) modal (scenario 1); assert that re-rendering with a `noteQuery.data` whose `version` has incremented (simulating a post-restore refetch) remounts `EditorBody` with the new title/body reflected in the title input, and that `TagCombobox`'s `attachedTagIds` prop is unaffected by the remount (scenarios 5, 6).
  Files: `apps/web/src/components/editor/NoteEditorPage.test.tsx`
  Scenarios: 1, 5, 6
  Depends on: 11

## Not Covered by a Task

All ten spec.md scenarios (1-10) are covered by tasks above — no scenario is left untested.
