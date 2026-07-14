---
ticket: AB-1014
type: FRONTEND
status: APPROVED
---

# AB-1014: Sharing Frontend

## Overview
Builds the owner-facing ShareModal (create/list/revoke public share links) and the public, unauthenticated `/shares/:token` viewing page that AB-1008 deliberately left unbuilt. Consumes the `ShareLink`/`CreatedShareLink`/`PublicShareView` contract already exported from `packages/shared` (added by AB-1008) with no shared-package changes needed.

## Goals
- `ShareModal` component, triggered from a new "Share" icon button in `NoteEditorPage`'s header (next to the existing Delete button), for existing notes only (`mode === 'existing'`).
  - Create-link form: optional days input (1-30, blank = server default of 7), submits `POST /notes/:id/shares`.
  - Link list: all share links for the note (active + revoked, newest first) via `GET /notes/:id/shares`, each row showing `shareUrl`, expiry, view count, and (for active links) a Copy button and a Revoke button.
  - Revoke requires an explicit confirmation step (apps/web/CLAUDE.md §5) before calling `DELETE /notes/:id/shares/:token`.
  - Multiple simultaneous active links are permitted (no frontend-only restriction beyond the backend contract).
- New public route `/shares/$token` (TanStack Router), unauthenticated, outside `AppShell`, that calls `GET /public/shares/:token` and renders the note's title + sanitized body read-only, or a "link no longer valid" state on 410.
- New API/query functions wiring TanStack Query hooks for all four share endpoints.
- A new `sanitizeNoteBody` helper (DOMPurify-backed) so the public share page never puts raw TipTap-derived HTML into the DOM unsanitized (AGENTS.md §11 / apps/web/CLAUDE.md).

## Non-Goals
- No changes to `packages/shared` — `ShareLink`/`CreatedShareLink`/`PublicShareView` types, `createShareLinkSchema`, and `SHARE_NOT_FOUND`/`GONE_LINK_INVALID` error codes already exist from AB-1008.
- No editing capability on the public share page — read-only per FR-SHARE-3.
- No analytics/geolocation on views — only the running `viewCount` already returned by the API.
- No changes to the note editor's own content or autosave behavior.
- AB-1016's E2E journey step ("Share Note → Revoke Share") is out of scope here; this ticket only needs to make that step possible for AB-1016 to later drive.

## FRs Covered
| FR | Coverage |
|---|---|
| FR-SHARE-1 | ShareModal create-link form; 1-30 day input, defaults to 7 if blank |
| FR-SHARE-2 | Revoke button + confirmation modal; immediate invalidation reflected in the list via query invalidation |
| FR-SHARE-3 | Public `/shares/:token` page — unauthenticated view, view count display, 410 handling for expired/revoked/deleted-note links |
| FR-SHARE-4 | ShareModal's link list — all links ever created, including revoked, newest first, owner-only (route requires auth like the rest of `/notes/:id`) |

## Pages / Components
- `apps/web/src/routes/shares.$token.tsx` — new root-level route, sibling to login/notes/search routes in `router.tsx`. No `beforeLoad` auth guard (unauthenticated by design) and does not render inside `AppShell` (anonymous visitors have no session/nav). Renders `PublicSharePage`.
- `apps/web/src/components/shares/PublicSharePage.tsx` — fetches `GET /public/shares/:token` via `usePublicShareQuery(token)`; shows a `Skeleton` while pending (`useMinLoadingTime`, matching `NoteEditorPage`'s pattern), the sanitized title/body/viewCount/sharedAt on success, or a full-page "this link is no longer valid" message (mapping `GONE_LINK_INVALID` through `getErrorMessage`) on 410.
- `apps/web/src/components/shares/ShareModal.tsx` — `Dialog`-based (matches `DeleteNoteModal`/`RestoreConfirmModal` structure), takes `noteId`, `open`, `onOpenChange`. Contains:
  - A days-count `<input type="number" min={1} max={30}>` plus a "Create link" submit button (`Loader2` spinner while `useCreateShareLinkMutation` is pending).
  - The link list from `useShareLinksQuery(noteId)`, each row: truncated `shareUrl` + Copy button (`navigator.clipboard.writeText`, toast confirmation), formatted `expiresAt`, `viewCount`, and — only for links where `revokedAt` is null and `expiresAt` is in the future — a Revoke button.
- `apps/web/src/components/shares/RevokeShareLinkModal.tsx` — nested confirmation `Dialog` (mirrors `TrashPreviewModal` → `RestoreConfirmModal` nesting), auto-focused Cancel button, red destructive Confirm button, calls `useRevokeShareLinkMutation`.
- `apps/web/src/components/editor/NoteEditorPage.tsx` — add a `Share2` icon button next to the existing `Trash2` Delete button (same `mode === 'existing' && noteId` guard), toggling a `shareModalOpen` state exactly like `deleteModalOpen`.

## State Management
- No new Zustand store. Share link data is server state — TanStack Query only, per apps/web/CLAUDE.md §1 ("NEVER store API data collections in Zustand").
- `ShareModal`'s open/closed state and the create-form's days-input value are local component `useState`, matching `deleteModalOpen`'s pattern in `NoteEditorPage`.
- The public share page needs no `authStore` interaction — it's rendered for anonymous visitors; `apiClient.ts`'s `rawRequest` already omits the `Authorization` header when `accessToken` is null, so no client changes are needed there. If a logged-in owner opens their own share link in the same browser, the header is harmlessly attached but ignored by the unauthenticated backend route.

## API Integration
- New functions in `apps/web/src/lib/notesApi.ts` (co-located with `listNotes`/`createTag`/etc., matching the existing single-file-per-domain-group convention):
  - `listShareLinks(noteId): Promise<ShareLink[]>` → `GET /notes/:id/shares`
  - `createShareLink(noteId, params: { days?: number }): Promise<CreatedShareLink>` → computes `expiresAt` client-side as `new Date(Date.now() + days * 86_400_000).toISOString()` when `days` is provided, omits the field entirely when blank (server applies its own 7-day default) → `POST /notes/:id/shares`
  - `revokeShareLink(noteId, token): Promise<void>` → `DELETE /notes/:id/shares/:token`
  - `getPublicShare(token): Promise<PublicShareView>` → `GET /public/shares/:token` (via the same `apiRequest` helper — works unauthenticated since it just omits the bearer header)
- New hooks in `apps/web/src/lib/notesQueries.ts`:
  - `sharesKeys.list(noteId)`, `useShareLinksQuery(noteId)`
  - `useCreateShareLinkMutation(noteId)` — invalidates `sharesKeys.list(noteId)` on success
  - `useRevokeShareLinkMutation(noteId)` — invalidates `sharesKeys.list(noteId)` on success (idempotent 204 either way)
  - `usePublicShareQuery(token)` — no auth dependency; `enabled: token.length > 0`
- Existing 401-retry logic in `apiClient.ts` is untouched; the public endpoint never returns 401, only 410/429, so it's unaffected by the refresh-retry branch.

## Ticket-Specific UX Decisions
- **DOMPurify on the public share body (mandatory, AGENTS.md §11 / apps/web/CLAUDE.md):** a new `sanitizeNoteBody` function in `apps/web/src/lib/sanitize.ts` converts `PublicShareView.body` TipTap JSON to HTML via `generateHTML(body, [StarterKit.configure({ link: false })])` (already available from the installed `@tiptap/core@3.27.4` — no new dependency) and runs it through `DOMPurify.sanitize` with an explicit tag allowlist (`p, h1-h6, strong, em, s, ul, ol, li, blockquote, pre, code, br, hr`) and `ALLOWED_ATTR: []`, mirroring the existing `sanitizeHeadline` pattern. `PublicSharePage` is the only caller of `dangerouslySetInnerHTML` introduced by this ticket, and it always receives this function's output — never the raw `body` or raw `generateHTML` output directly.
- **Expiry input (resolved with user):** a plain days-count number input (1-30), not a datetime picker. Left blank, no `expiresAt` is sent and the server's 7-day default applies. Client-side validation mirrors the 1-30 range so the button disables/shows an inline error rather than round-tripping a guaranteed `400 VALIDATION_FAILED`.
- **Multiple active links (resolved with user):** the "Create link" action is always available regardless of existing active links — no frontend-only single-link restriction. The list view is the mechanism for reviewing/cleaning up old links, matching FR-SHARE-4's "review sharing history" framing.
- **Revoke confirmation (apps/web/CLAUDE.md §5):** Revoke is destructive/irreversible and gets its own confirmation modal (`RevokeShareLinkModal`) with a focused Cancel button by default and a red destructive Confirm button — same treatment as `DeleteNoteModal`.
- **Copy-to-clipboard:** `navigator.clipboard.writeText(shareUrl)` with a `sonner` success toast ("Link copied") on resolve and an error toast on rejection — new strings added to `uiCopy.ts` alongside the existing confirm-modal copy.
- **Public page has no `AppShell` chrome:** `PublicSharePage` renders its own minimal centered layout (`min-h-screen flex items-center justify-center`, per apps/web/CLAUDE.md §3) rather than reusing the authenticated app's header/nav.
- **410 vs loading vs success states:** `PublicSharePage` distinguishes `isPending` (skeleton), `isError` with code `GONE_LINK_INVALID` (the "link no longer valid" message via `getErrorMessage`), and success (rendered content) — matching the three-state pattern already used in `NoteEditorPage` for `noteQuery`.

## Scenarios
1. Owner opens the Share icon on an existing note → `ShareModal` opens, showing an empty list and the create form.
2. Owner submits create with no days entered → `POST /notes/:id/shares` with no body → new link appears at the top of the list, `expiresAt` ~7 days out, `viewCount: 0`.
3. Owner submits create with `days = 14` → `expiresAt` sent as `now + 14 days` (ISO) → link created, valid 14 days.
4. Owner enters `days = 45` → client-side validation blocks submission before any request is sent.
5. Owner clicks Copy on an active link → `navigator.clipboard.writeText` called with `shareUrl` → success toast shown.
6. Owner clicks Revoke on an active link → confirmation modal appears; Cancel sends no request; Confirm calls `DELETE /notes/:id/shares/:token` → list refetches, that link now shows `revokedAt` and no Revoke button.
7. Owner creates a second link while a first is still active → both appear independently; both are individually copyable/revocable.
8. External visitor opens a valid `/shares/:token` link → title + sanitized body render read-only, with the current `viewCount`.
9. External visitor opens a link whose token doesn't exist, is revoked, is expired, or whose parent note is soft-deleted → `410 GONE_LINK_INVALID` → "link no longer valid" message, no note content ever rendered.
10. A note body crafted to smuggle disallowed HTML through `generateHTML` is opened via a public link → `sanitizeNoteBody`'s DOMPurify pass strips anything outside the allowlist before it reaches `dangerouslySetInnerHTML`.
11. Owner views the share list for a note with zero share links → empty-state text, no crash on an empty array.
12. A non-owner 404 scenario is not reachable from the frontend (no UI surface lets a user open another user's `ShareModal`) — out of scope for this spec.

## Dependencies
- AB-1008 (Sharing Architecture, backend) — merged/archived. Supplies the endpoints and shared types this ticket consumes unchanged.
- AB-1010 (Auth Frontend) — merged/archived. `NoteEditorPage`'s auth-gated route and `apiClient.ts`'s token handling are reused as-is.
- AB-1012 (Note Editor Frontend) — merged/archived. `NoteEditorPage.tsx`, `DeleteNoteModal.tsx`, and `Dialog.tsx` are the components this ticket extends/mirrors.
- AB-1016 (E2E Testing) depends on this ticket for the Share/Revoke steps of the core journey.

## Open Questions
None — scope, expiry input style, and the multiple-active-links policy were resolved with the user before drafting; see Ticket-Specific UX Decisions.
