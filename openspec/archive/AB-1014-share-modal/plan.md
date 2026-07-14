---
ticket: AB-1014
status: APPROVED
---

# AB-1014: Sharing Frontend — Implementation Plan

## Graph / Reuse Verification

No `code-review-graph` MCP tools are available in this session (`get_architecture_overview` / `query_graph` not found via ToolSearch), so reuse was verified by direct read during `/spec` instead, per CLAUDE.md's fallback rule. Confirmed in `packages/shared/src`:
- `types.ts` already exports `ShareLink`, `CreatedShareLink`, `PublicShareView` (added by AB-1008) — no new shared types needed.
- `schemas.ts` already exports `createShareLinkSchema` / `CreateShareLinkInput` — reused as-is for validating the client's optional `expiresAt` before sending, no duplicate schema.
- `errorCodes.ts` already exports `SHARE_NOT_FOUND` and `GONE_LINK_INVALID` — `errorMessages.ts` already has user-facing copy for both (`apps/web/src/lib/errorMessages.ts:15-16`).

This ticket adds **zero** files/exports to `packages/shared`.

## Files to Create

| File | Purpose |
|---|---|
| `apps/web/src/components/shares/ShareModal.tsx` | Owner-facing dialog: create-link form + link list |
| `apps/web/src/components/shares/ShareModal.test.tsx` | Scenarios 1-3, 4, 5, 7, 11 |
| `apps/web/src/components/shares/RevokeShareLinkModal.tsx` | Nested destructive-confirm dialog |
| `apps/web/src/components/shares/RevokeShareLinkModal.test.tsx` | Scenario 6 |
| `apps/web/src/components/shares/PublicSharePage.tsx` | Unauthenticated read-only share view |
| `apps/web/src/components/shares/PublicSharePage.test.tsx` | Scenarios 8, 9, 10 (integration) |
| `apps/web/src/routes/shares.$token.tsx` | New root-level, unauthenticated route rendering `PublicSharePage` |

No backend files, no Prisma migration — this ticket is purely additive on the frontend and consumes AB-1008's contract unchanged. No `routes/`→`controllers/`→`services/` backend layering applies.

## Files to Modify

| File | Change |
|---|---|
| `apps/web/src/lib/notesApi.ts` | Add `listShareLinks`, `createShareLink`, `revokeShareLink`, `getPublicShare` |
| `apps/web/src/lib/notesApi.test.ts` | Test the 4 new functions, incl. `createShareLink`'s client-side `days → expiresAt` ISO computation and the omit-when-blank case |
| `apps/web/src/lib/notesQueries.ts` | Add `sharesKeys`, `useShareLinksQuery`, `useCreateShareLinkMutation`, `useRevokeShareLinkMutation`, `usePublicShareQuery` |
| `apps/web/src/lib/notesQueries.test.ts` | Test the 4 new hooks, incl. invalidation of `sharesKeys.list(noteId)` on create/revoke success |
| `apps/web/src/lib/sanitize.ts` | Add `sanitizeNoteBody(body: TipTapDocument): string` (generateHTML + DOMPurify allowlist) |
| `apps/web/src/lib/sanitize.test.ts` | Add tests incl. a malicious-payload case (scenario 10) |
| `apps/web/src/lib/uiCopy.ts` | Add `SHARE_MODAL`, `REVOKE_SHARE_CONFIRM`, `SHARE_LINK_COPIED`, `PUBLIC_SHARE_INVALID` copy blocks, matching existing `DELETE_NOTE_CONFIRM`/`RESTORE_CONFIRM` shape |
| `apps/web/src/components/editor/NoteEditorPage.tsx` | Add `Share2` icon button (mirrors the existing `Trash2` Delete button, same `mode === 'existing' && noteId` guard) + `shareModalOpen` state + render `ShareModal` |
| `apps/web/src/components/editor/NoteEditorPage.test.tsx` | Add: Share button renders only in `mode="existing"`; clicking it opens `ShareModal` (mocked, same pattern as the existing `DeleteNoteModal` mock) |
| `apps/web/src/routes/router.tsx` | Register `sharesTokenRoute` as a **direct child of `rootRoute`** in `routeTree.addChildren([...])`, sibling to `loginRoute`/`notesRoute`/etc. — must not be nested under any route with an auth `beforeLoad` guard |
| `apps/web/src/routes/router.test.tsx` | Add: `/shares/:token` renders `PublicSharePage` regardless of auth status (both `'authenticated'` and `'unauthenticated'` seeded state) with no redirect — proves the route is genuinely guard-free |

## Prisma Schema Changes

None. No backend/database changes in this ticket.

## New Packages

None. Every library this ticket needs is already an exact-pinned dependency in `apps/web/package.json`:
- `@tiptap/core@3.27.4` — exports `generateHTML` (verified present in the installed package's type declarations)
- `dompurify@3.4.12` — already used by `sanitizeHeadline`
- `lucide-react@1.24.0` — needs `Share2` and `Copy` icons; verify both exist in the installed version before first use (quick type-def check, not a new dependency)
- `sonner@2.0.7`, `@radix-ui/react-dialog@1.1.19` — already used by every existing modal

## Dependencies on Prior Tickets

- **AB-1008** (Sharing Architecture, backend) — merged/archived. Supplies all 4 endpoints and the shared types this ticket consumes unchanged.
- **AB-1010** (Auth Frontend) — merged/archived. Reuses `apiClient.ts` token handling and the `rootRoute`/`authStore` wiring as-is.
- **AB-1012** (Note Editor Frontend) — merged/archived. `NoteEditorPage.tsx`, `DeleteNoteModal.tsx`, `Dialog.tsx` are extended/mirrored directly.
- **AB-1016** (E2E Testing) depends on this ticket for the Share/Revoke steps of the core journey — not a blocker for this work.

## Risk Areas

1. **`generateHTML` schema mismatch:** if a note body ever contains a node/mark type outside what `StarterKit.configure({ link: false })` produces, `generateHTML` throws. Mitigate with a `try/catch` in `sanitizeNoteBody` that falls back to `extractPlainText(body)` wrapped in a single sanitized `<p>`, so one malformed note can't crash the whole public page.
2. **DOMPurify allowlist completeness vs. safety:** `EditorToolbar` only exposes H1-H3, but StarterKit's schema allows H1-H6. The allowlist must cover `h1`-`h6` (so no legitimately-creatable content is silently stripped) while still excluding `script`/`style`/`iframe`/event-handler attributes. Scenario 10's dedicated XSS test in `sanitize.test.ts` is the guard against regressions here.
3. **Route auth-bypass placement:** `shares.$token.tsx` must be added as a **direct sibling** in `router.tsx`'s `addChildren([...])` array, not nested inside `notesRoute` or any other guarded subtree — a misplacement here would either 404 unauthenticated visitors (breaking FR-SHARE-3) or accidentally require login for a link that must work for anonymous viewers. Covered by the new router.test.tsx assertions in both auth states.
4. **`navigator.clipboard` in jsdom:** the test environment doesn't implement Clipboard API by default — `ShareModal.test.tsx` must stub `navigator.clipboard.writeText` (e.g. `vi.stubGlobal` or a plain mock) before asserting the copy flow; omitting this would make the test throw rather than fail cleanly.
5. **Client/server day-range validation drift:** the server's rule (per AB-1008) is "`expiresAt` between `now()` and `now() + 30 days`, inclusive." The client's days-input validation must mirror this exactly (reject `0` and `> 30`, accept `1` and `30`) — a boundary-value test set (`0`, `1`, `30`, `31`) in `ShareModal.test.tsx` guards against drift in either direction.
6. **Query invalidation correctness:** `useCreateShareLinkMutation(noteId)` / `useRevokeShareLinkMutation(noteId)` must invalidate `sharesKeys.list(noteId)` (not a bare `['notes']` prefix) so the list refetches without over-invalidating unrelated note-list caches — same pattern already proven by `useUpdateNoteMutation(noteId)`, low risk but worth an explicit assertion in `notesQueries.test.ts`.

## Test Strategy

| Spec scenario | Test file |
|---|---|
| 1. Open Share icon → modal opens, empty list | `ShareModal.test.tsx`, `NoteEditorPage.test.tsx` |
| 2. Create with no days → `POST` with no body, ~7-day expiry | `ShareModal.test.tsx`, `notesApi.test.ts` |
| 3. Create with `days=14` → `expiresAt` = now+14d ISO | `notesApi.test.ts` |
| 4. `days=45` blocked client-side before request | `ShareModal.test.tsx` (+ boundary cases 0/1/30/31) |
| 5. Copy button → `clipboard.writeText` + success toast | `ShareModal.test.tsx` |
| 6. Revoke → confirm modal → `DELETE` → list refetches | `RevokeShareLinkModal.test.tsx`, `ShareModal.test.tsx` |
| 7. Two simultaneous active links, both independently manageable | `ShareModal.test.tsx` |
| 8. Valid public link renders sanitized content + view count | `PublicSharePage.test.tsx` |
| 9. Expired/revoked/deleted-note link → 410 → "link no longer valid" | `PublicSharePage.test.tsx` |
| 10. Malicious body content stripped before `dangerouslySetInnerHTML` | `sanitize.test.ts` (unit), `PublicSharePage.test.tsx` (integration) |
| 11. Empty share-link list renders empty state, no crash | `ShareModal.test.tsx` |
| 12. Non-owner 404 — no frontend code path, explicitly out of scope | N/A (documented in spec.md, no test needed) |
| Route wiring (public route reachable in any auth state, no redirect) | `router.test.tsx` |
| Query hook invalidation correctness | `notesQueries.test.ts` |

Coverage gate: ≥80% on all new code (AGENTS.md §10), enforced by the existing Husky pre-commit hook — no new tooling/config required. All new component test files follow the co-located `ComponentName.test.tsx` convention already used by every other component in `apps/web/src/components/`.
