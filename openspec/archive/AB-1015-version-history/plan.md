---
ticket: AB-1015
status: APPROVED
---

# AB-1015: Version History Frontend — Implementation Plan

## Graph / Reuse Verification

No `code-review-graph` MCP tools are available in this session (`get_architecture_overview` / `query_graph` not found via `ToolSearch`), so reuse was verified by direct read during `/spec` instead, per CLAUDE.md's fallback rule. Confirmed in `packages/shared/src`:
- `types.ts` already exports `NoteVersionSummary` and `NoteVersionDetail` (added by AB-1009) — no new shared types needed.
- `errorCodes.ts` already exports `VERSION_NOT_FOUND` — `errorMessages.ts` already has user-facing copy for it (`apps/web/src/lib/errorMessages.ts:17`).
- `schemas.ts` has no version-related schema, and none is needed — all three version endpoints (`GET .../versions`, `GET .../versions/:versionId`, `POST .../versions/:versionId/restore`) take no request body (SDS §4), so there is nothing for the client to validate before sending.

This ticket adds **zero** files/exports to `packages/shared`.

## Files to Create

| File | Purpose |
|---|---|
| `apps/web/src/components/versions/VersionHistoryModal.tsx` | Owner-facing dialog: version list + split-view preview + restore trigger |
| `apps/web/src/components/versions/VersionHistoryModal.test.tsx` | Scenarios 1, 2, 3, 6, 9, 10 |
| `apps/web/src/components/versions/RestoreVersionConfirmModal.tsx` | Nested destructive-confirm dialog for restore |
| `apps/web/src/components/versions/RestoreVersionConfirmModal.test.tsx` | Scenarios 4, 5, 7 |

No backend files, no Prisma migration — this ticket is purely additive on the frontend and consumes AB-1009's contract unchanged. No `routes/`→`controllers/`→`services/` backend layering applies.

## Files to Modify

| File | Change |
|---|---|
| `apps/web/src/lib/notesApi.ts` | Add `listVersions(noteId)`, `getVersionDetail(noteId, versionId)`, `restoreVersion(noteId, versionId)` |
| `apps/web/src/lib/notesApi.test.ts` | Test the 3 new functions call the correct method/URL and return the typed response |
| `apps/web/src/lib/notesQueries.ts` | Add `versionsKeys`, `useVersionsQuery`, `useVersionDetailQuery`, `useRestoreVersionMutation` |
| `apps/web/src/lib/notesQueries.test.ts` | Test the 3 new hooks, incl. `useRestoreVersionMutation` invalidating both `notesKeys.detail(noteId)` and `versionsKeys.list(noteId)` on success |
| `apps/web/src/lib/uiCopy.ts` | Add `VERSION_HISTORY` (heading, emptyState, currentLabel, restoreButton) and `RESTORE_VERSION_CONFIRM` (heading, body, confirm, cancel) copy blocks, matching the existing `SHARE_MODAL`/`RESTORE_CONFIRM` shape |
| `apps/web/src/components/editor/NoteEditorPage.tsx` | Add `History` icon button (mirrors the existing `Share2`/`Trash2` buttons, same `mode === 'existing' && noteId` guard) + `versionsModalOpen` state + render `VersionHistoryModal`; render `EditorBody` with `key={noteQuery.data.version}` so a version bump remounts it with fresh `initialTitle`/`initialBody` |
| `apps/web/src/components/editor/NoteEditorPage.test.tsx` | Add: History button renders only in `mode="existing"`; clicking it opens `VersionHistoryModal` (mocked, same pattern as the existing `DeleteNoteModal`/`ShareModal` mocks); `EditorBody` remounts (title input reflects new value) when `noteQuery.data.version` changes between renders |

## Prisma Schema Changes

None. No backend/database changes in this ticket.

## New Packages

None. Every library this ticket needs is already an exact-pinned dependency in `apps/web/package.json`:
- `lucide-react` — needs the `History` icon; verify it exists in the installed version's type declarations before first use (same one-time check pattern as `Share2`/`Copy` in AB-1014), not a new dependency.
- `@radix-ui/react-dialog`, `sonner` — already used by every existing modal.
- `dompurify`, `@tiptap/core` (`generateHTML`) — already used via the existing `sanitizeNoteBody` (AB-1014), reused unchanged.

## Dependencies on Prior Tickets

- **AB-1009** (Version History Architecture, backend) — merged/archived. Supplies all 3 endpoints and the shared types this ticket consumes unchanged.
- **AB-1010** (Auth Frontend) — merged/archived. Reuses `apiClient.ts` token handling as-is.
- **AB-1012** (Note Editor Frontend) — merged/archived. `NoteEditorPage.tsx`, `Dialog.tsx` are extended/mirrored directly.
- **AB-1014** (Sharing Frontend) — merged/archived. `sanitizeNoteBody` (`apps/web/src/lib/sanitize.ts`) is reused as-is; no changes to that file in this ticket.
- **AB-1016** (E2E Testing) depends on this ticket for the Restore Version step of the core journey — not a blocker for this work.

## Risk Areas

1. **`EditorBody` remount losing in-flight state:** keying `EditorBody` on `noteQuery.data.version` means any restore also resets `useAutosave`'s internal debounce/status state and `TagCombobox`'s pending-tag local state. This is intentional (a restore is a full content replacement) but must be verified to not also clobber an *unrelated* in-progress edit that happens to be mid-autosave-debounce at the exact moment a restore completes — mitigated by the fact that restoring and typing are both driven by the same single user in the same tab, and `useAutosave`'s pending debounce timer is tied to the outgoing `EditorBody` instance that's about to unmount anyway.
2. **Stale "Current" pane after restore:** the split view's "Current" column is passed down from `NoteEditorPage`'s `noteQuery.data`, which is a snapshot from before the restore. `VersionHistoryModal` must close (via the restore's `onSuccess`/`onRestored` callback chain, mirroring `TrashPreviewModal` → `RestoreConfirmModal`'s `onRestored` pattern) rather than stay open and re-render with now-stale "current" data — covered by an explicit assertion in `VersionHistoryModal.test.tsx` that the modal's `onOpenChange(false)` fires after a successful restore.
3. **`generateHTML` schema mismatch (pre-existing risk, reused unchanged):** `sanitizeNoteBody` already has a `try/catch` fallback (built in AB-1014) for any body containing a node/mark type outside `StarterKit`'s configured schema — applies identically to `NoteVersionDetail.body` since it's the same `TipTapDocument` shape. No new mitigation needed, but scenario 8's malicious-payload test is re-run against version bodies, not just current bodies, to confirm the existing helper generalizes.
4. **Query key scoping for version detail:** `versionsKeys.detail(noteId, versionId)` must include both segments (not just `versionId`) so switching between notes never serves a cached detail response for the wrong note — low risk since this mirrors `sharesKeys.detail(token)`'s existing scoping precedent, but worth an explicit `notesQueries.test.ts` assertion.
5. **Double invalidation on restore success:** `useRestoreVersionMutation` invalidates *two* query keys (`notesKeys.detail(noteId)` and `versionsKeys.list(noteId)`) rather than one — must not accidentally over-invalidate a bare `['notes']` prefix (which would also refetch the notes list/trash unnecessarily), mirroring the precision already established by `useUpdateNoteMutation(noteId)`.

## Test Strategy

| Spec scenario | Test file |
|---|---|
| 1. Open History icon → modal opens, list newest-first, nothing preselected | `VersionHistoryModal.test.tsx`, `NoteEditorPage.test.tsx` |
| 2. Zero-version note → empty state, no restore control | `VersionHistoryModal.test.tsx` |
| 3. Select a version → split view renders current + selected (sanitized) | `VersionHistoryModal.test.tsx` |
| 4. Click Restore → confirm modal appears; Cancel sends no request | `RestoreVersionConfirmModal.test.tsx` |
| 5. Confirm restore → mutation fires, both modals close, `EditorBody` remounts with restored content | `RestoreVersionConfirmModal.test.tsx`, `VersionHistoryModal.test.tsx`, `NoteEditorPage.test.tsx` |
| 6. Tags unaffected by restore (frontend just reflects backend-returned `tagIds` unchanged) | `NoteEditorPage.test.tsx` (assert `TagCombobox` props unchanged across the remount) |
| 7. Restore 404s (`VERSION_NOT_FOUND`) → error toast, modal stays open, no remount | `RestoreVersionConfirmModal.test.tsx` |
| 8. Malicious version body stripped before `dangerouslySetInnerHTML` | `VersionHistoryModal.test.tsx` (reuses `sanitize.test.ts`'s existing coverage of `sanitizeNoteBody` itself — no new sanitize-layer test needed) |
| 9. Close modal without restoring → no mutation, `selectedVersionId` resets on reopen | `VersionHistoryModal.test.tsx` |
| 10. Version history accessible while note is in Trash | `VersionHistoryModal.test.tsx` (note-detail query mocked with `deletedAt` set, endpoints called identically) |
| Query hook invalidation correctness | `notesQueries.test.ts` |
| `notesApi.ts` function → correct method/URL/typed response | `notesApi.test.ts` |

Coverage gate: ≥80% on all new code (AGENTS.md §10), enforced by the existing Husky pre-commit hook — no new tooling/config required. All new component test files follow the co-located `ComponentName.test.tsx` convention already used by every other component in `apps/web/src/components/`.
