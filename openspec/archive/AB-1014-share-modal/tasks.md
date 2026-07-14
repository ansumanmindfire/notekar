---
ticket: AB-1014
status: APPROVED
---

# AB-1014: Sharing Frontend — Tasks

Ordered so each task leaves `pnpm build`/`pnpm test` passing before the next begins. `[PARALLEL]` tasks are independent of their siblings at that point in the sequence (safe to hand to separate agents/contributors). `[SUBAGENT]` marks tasks estimated over 45 minutes.

## Foundation

- [x] **1. Verify `lucide-react@1.24.0` exports `Share2` and `Copy`** — 5 min — `[PARALLEL]`
  Files: none (read-only check of installed type defs)
  Scenarios: none directly; unblocks tasks 9 and 11 (icon imports)

- [x] **2. Add `sanitizeNoteBody` to `sanitize.ts`** — 30 min — `[PARALLEL]`
  `generateHTML(body, [StarterKit.configure({ link: false })])` → `DOMPurify.sanitize` with the `p/h1-h6/strong/em/s/ul/ol/li/blockquote/pre/code/br/hr` allowlist and `ALLOWED_ATTR: []`; wrap in `try/catch` falling back to a sanitized `<p>` of `extractPlainText(body)` on failure (plan.md risk #1).
  Files: `apps/web/src/lib/sanitize.ts`
  Scenarios: 10 (partial — implementation half)

- [x] **3. Test `sanitizeNoteBody`** — 20 min
  Cover: normal doc → expected HTML; malicious payload (e.g. a node type/attribute that would render `<script>` or an `onerror` attribute via a hand-crafted `generateHTML` output) → stripped; malformed/unknown node type → falls back to sanitized plain text instead of throwing.
  Files: `apps/web/src/lib/sanitize.test.ts`
  Scenarios: 10 (unit half)
  Depends on: 2

- [x] **4. Add share-related copy to `uiCopy.ts`** — 15 min — `[PARALLEL]`
  Add `SHARE_MODAL` (heading/empty-state/create-form labels), `REVOKE_SHARE_CONFIRM` (heading/body/confirm/cancel, matching `DELETE_NOTE_CONFIRM` shape), `SHARE_LINK_COPIED` toast string, `PUBLIC_SHARE_INVALID` (heading/subtext for the 410 state).
  Files: `apps/web/src/lib/uiCopy.ts`
  Scenarios: none directly; unblocks tasks 8-13

- [x] **5. Add share API functions to `notesApi.ts`** — 30 min — `[PARALLEL]`
  `listShareLinks(noteId)`, `createShareLink(noteId, { days? })` (computes `expiresAt` as `new Date(Date.now() + days * 86_400_000).toISOString()` when `days` is provided, omits the field otherwise), `revokeShareLink(noteId, token)`, `getPublicShare(token)`.
  Files: `apps/web/src/lib/notesApi.ts`
  Scenarios: unblocks 2, 3 (implementation half)

- [x] **6. Test the new `notesApi.ts` functions** — 25 min
  Cover: `listShareLinks`/`revokeShareLink` hit the right URLs/methods; `createShareLink` with `days` present sends the correctly-computed ISO `expiresAt`; `createShareLink` with `days` omitted sends no `expiresAt` field at all; `getPublicShare` hits `/public/shares/:token`.
  Files: `apps/web/src/lib/notesApi.test.ts`
  Scenarios: 2, 3
  Depends on: 5

## Query Layer

- [x] **7. Add share query/mutation hooks to `notesQueries.ts`** — 25 min
  `sharesKeys.list(noteId)`, `useShareLinksQuery(noteId)`, `useCreateShareLinkMutation(noteId)` (invalidates `sharesKeys.list(noteId)` on success), `useRevokeShareLinkMutation(noteId)` (same invalidation), `usePublicShareQuery(token)` (`enabled: token.length > 0`).
  Files: `apps/web/src/lib/notesQueries.ts`
  Depends on: 5

- [x] **8. Test the new hooks, incl. invalidation targets** — 25 min
  Assert `useCreateShareLinkMutation`/`useRevokeShareLinkMutation` invalidate `sharesKeys.list(noteId)` specifically (plan.md risk #6), not a bare `['notes']` prefix.
  Files: `apps/web/src/lib/notesQueries.test.ts`
  Depends on: 7

## Revoke Confirmation Modal

- [x] **9. Build `RevokeShareLinkModal.tsx`** — 25 min
  Nested `Dialog` mirroring `RestoreConfirmModal.tsx`'s structure: auto-focused Cancel, red destructive Confirm, `Loader2` spinner while `useRevokeShareLinkMutation` is pending, error toast via `getErrorMessage` on failure.
  Files: `apps/web/src/components/shares/RevokeShareLinkModal.tsx`
  Depends on: 1, 4, 7

- [x] **10. Test `RevokeShareLinkModal.tsx`** — 20 min
  Cover: Cancel closes with no request sent; Confirm calls the mutation with the right `(noteId, token)`; pending state disables both buttons and shows the spinner; error toast on mutation failure.
  Files: `apps/web/src/components/shares/RevokeShareLinkModal.test.tsx`
  Scenarios: 6
  Depends on: 9

## Share Modal

- [x] **11. Build `ShareModal.tsx`** — 50 min — `[SUBAGENT]`
  Days-count input (1-30, client-side validated, blank allowed) + create button (`useCreateShareLinkMutation`); link list from `useShareLinksQuery` (`shareUrl`, formatted `expiresAt`, `viewCount`, Copy button via `navigator.clipboard.writeText` + toast, Revoke button only for links where `revokedAt` is null and `expiresAt` is in the future) rendering `RevokeShareLinkModal` on click; empty-state text when the list is empty.
  Files: `apps/web/src/components/shares/ShareModal.tsx`
  Scenarios: 1, 2, 3, 7, 11
  Depends on: 1, 4, 7, 9

- [x] **12. Test `ShareModal.tsx`** — 55 min — `[SUBAGENT]`
  Cover scenario 1 (open, empty list), 2 (create blank → no `expiresAt` sent), 3 (create with `days=14`), 4 (boundary cases `0`/`1`/`30`/`31`/`45` — only `1` and `30` submit), 5 (copy button with stubbed `navigator.clipboard`, plan.md risk #4), 7 (two simultaneous active links both independently manageable), 11 (empty list renders without crashing).
  Files: `apps/web/src/components/shares/ShareModal.test.tsx`
  Scenarios: 1, 2, 3, 4, 5, 7, 11
  Depends on: 11

## Public Share Page

- [x] **13. Build `PublicSharePage.tsx`** — 30 min
  Three-state render (mirrors `NoteEditorPage`'s `noteQuery` pattern): `isPending` → `Skeleton` (via `useMinLoadingTime`); `isError` with `GONE_LINK_INVALID` → centered "link no longer valid" message (`PUBLIC_SHARE_INVALID` copy); success → title + `sanitizeNoteBody(body)` via `dangerouslySetInnerHTML` + `viewCount`/`sharedAt`. No `AppShell` — own minimal centered layout.
  Files: `apps/web/src/components/shares/PublicSharePage.tsx`
  Scenarios: 8, 9
  Depends on: 2, 4, 7

- [x] **14. Test `PublicSharePage.tsx`** — 30 min
  Cover scenario 8 (valid link renders sanitized content + view count), 9 (410 → invalid-link message, no content rendered), 10 integration check (a malicious body's dangerous markup never appears in the rendered DOM — asserts on the actual rendered output, not just that `sanitizeNoteBody` was called).
  Files: `apps/web/src/components/shares/PublicSharePage.test.tsx`
  Scenarios: 8, 9, 10
  Depends on: 13

## Route Wiring

- [x] **15. Add `shares.$token.tsx` route file** — 15 min
  No `beforeLoad` auth guard; renders `PublicSharePage` with the `$token` param; reads the token via the route's own `useParams()`, mirroring `notes.$noteId.tsx`'s structure minus the auth check and `AppShell` wrapper.
  Files: `apps/web/src/routes/shares.$token.tsx`
  Depends on: 13

- [x] **16. Register the route in `router.tsx`** — 10 min
  Add `sharesTokenRoute` as a **direct child of `rootRoute`** in `routeTree.addChildren([...])`, sibling to `loginRoute`/`notesRoute` — not nested under any guarded subtree (plan.md risk #3).
  Files: `apps/web/src/routes/router.tsx`
  Depends on: 15

- [x] **17. Test route wiring in `router.test.tsx`** — 20 min
  Add `getPublicShare` to the existing `vi.mock('../lib/notesApi')` fixture set; assert `/shares/:token` renders `PublicSharePage` (not a redirect to `/login`) under both `'authenticated'` and `'unauthenticated'` seeded `authStore` states.
  Files: `apps/web/src/routes/router.test.tsx`
  Depends on: 16

## Editor Integration

- [x] **18. Wire the Share button into `NoteEditorPage.tsx`** — 25 min
  Add `Share2` icon button next to the existing `Trash2` Delete button (same `mode === 'existing' && noteId` guard), `shareModalOpen` state toggled the same way as `deleteModalOpen`, render `ShareModal` conditionally.
  Files: `apps/web/src/components/editor/NoteEditorPage.tsx`
  Depends on: 1, 11

- [x] **19. Test the Share button wiring in `NoteEditorPage.test.tsx`** — 20 min
  Mock `ShareModal` the same way `DeleteNoteModal` is already mocked; assert the Share button is absent in `mode="new"`, present in `mode="existing"`, and clicking it opens the (mocked) `ShareModal`.
  Files: `apps/web/src/components/editor/NoteEditorPage.test.tsx`
  Scenarios: 1
  Depends on: 18

## Not Covered by a Task

Scenario 12 (non-owner 404) has no frontend code path and needs no test, per spec.md's Non-Goals — no task is created for it.
