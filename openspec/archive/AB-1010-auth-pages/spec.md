---
ticket: AB-1010
type: FRONTEND
status: APPROVED
---

# AB-1010: Auth Frontend

## Overview

Implements the frontend authentication surface for the Note Taking Application: register, login, forgot-password/reset-password (two-step, single page), the `authStore` (in-memory access token + session status), the `apiClient.ts` fetch wrapper (attaches bearer token, transparently refreshes on `401`, restores session on hard reload), and a minimal protected `/notes` placeholder so the login → authenticated-view → logout loop is fully navigable end-to-end. This ticket also introduces client-side routing (none exists yet in `apps/web`) and establishes the session-bootstrap and route-guard patterns every later frontend ticket (AB-1011–AB-1015) builds on.

Depends on AB-1002 (Core User & Auth Models) and AB-1003 (Forgot Password Flow), both merged — this ticket only consumes their API contracts and `packages/shared` schemas/types, never re-deriving them.

## Goals

- Add `@tanstack/react-router` (exact pinned version per AGENTS.md §3 — no `^`/`~`; verify the current stable release at implementation time, same pattern SDS §2.1 uses for the Postgres image tag) as the routing library, wired via a code-based route tree (not file-based — too few routes at this stage to justify it).
- Routes: `/login`, `/register`, `/forgot-password` (two internal steps, one route), `/notes` (protected placeholder).
- `authStore` (Zustand): holds `accessToken` (in-memory only, never `localStorage`/`sessionStorage`), `user: AuthUser | null`, and `status: 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated'`, plus actions `login`, `register`, `logout`, `bootstrap`.
- `apiClient.ts`: a `fetch` wrapper that
  - attaches `Authorization: Bearer <accessToken>` from `authStore` to every request against protected routes,
  - sends `credentials: 'include'` so the `httpOnly` refresh cookie travels with `/auth/*` calls,
  - on a `401` from any non-auth request, calls `POST /auth/refresh` once, updates `authStore.accessToken` on success and retries the original request exactly once; on refresh failure, clears the session and surfaces the failure so the caller's route guard redirects to `/login`.
- Session bootstrap on app mount: a root-level effect calls `POST /auth/refresh` once (relying solely on the cookie, no stored access token) to silently restore a session after a hard reload, before any route renders, avoiding a flash of the login page for an already-authenticated user.
- Route guards: `/notes` requires `status === 'authenticated'` (else redirect to `/login`); `/login`, `/register`, and `/forgot-password` redirect an already-authenticated user to `/notes`.
- `LoginForm`: email + password, submits `POST /auth/login`, on success stores `{ accessToken, user }` and navigates to `/notes`. On `401 AUTH_INVALID_CREDENTIALS`, shows one generic error (FR-AUTH-2 — never distinguishes bad password from unknown email). On `429 RATE_LIMITED`, shows a "too many attempts" message.
- `RegisterForm`: email + password (+ client-only "confirm password" field, validated locally, never sent to the API), submits `POST /auth/register`. Because that endpoint returns only `{ id, email, createdAt }` with no session (per the already-shipped AB-1002 contract), on `201` the form immediately chains a `POST /auth/login` with the same credentials to satisfy FR-AUTH-1 ("user is logged in") and navigates to `/notes` on success. If the chained login unexpectedly fails, the user is routed to `/login` with an "Account created — please sign in" notice rather than surfacing a raw error. On `409 USER_EXISTS`, shows a duplicate-email error.
- `ForgotPasswordForm`: single page, two-step internal state (`request` → `verify`), no separate route.
  - Step `request`: email field, submits `POST /auth/forgot-password`. Always advances to `verify` and shows the identical generic message on success, regardless of whether the email was registered (FR-AUTH-5 anti-enumeration — the UI must not branch on response content beyond the network call succeeding).
  - Step `verify`: OTP (6-digit) + new password (+ confirm), submits `POST /auth/reset-password`. On `204`, redirects to `/login` with a "Password updated — please sign in" notice. On `401 AUTH_OTP_INVALID`, shows one generic error (wrong code, expired, exhausted, and unknown-email all render identically, matching the backend's anti-enumeration design — FR-AUTH-6).
- `/notes` placeholder page: shows a welcome message with the logged-in user's email and a "Log out" button calling `authStore.logout()` (→ `POST /auth/logout`, clears session regardless of response, navigates to `/login`). Wholesale replaced by AB-1011.
- Every submit button shows a loading/disabled state while its request is in flight (FR-UI-1).
- Client-side validation reuses `packages/shared` Zod schemas (`registerSchema`, `loginSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `passwordSchema`) via `safeParse` on submit — no new form library (e.g. `react-hook-form`) introduced for four small forms.
- `errorMessages.ts`: maps `ApiError.code` (from `packages/shared/src/errorCodes.ts`) to user-facing copy for every code these flows can receive (`VALIDATION_FAILED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_INVALID`, `AUTH_REFRESH_INVALID`, `USER_EXISTS`, `AUTH_OTP_INVALID`, `RATE_LIMITED`).

## Non-Goals

- No `/notes` list, editor, tags, search, sharing, or version-history UI — those are AB-1011 through AB-1015; the `/notes` route here is a throwaway placeholder.
- No app shell, header, or navigation chrome beyond the placeholder's own logout button — a real shell arrives with AB-1011/AB-1012.
- No backend changes — AB-1002/AB-1003 contracts are treated as fixed; the register→login chaining workaround lives entirely in the frontend.
- No DOMPurify/rich-text sanitization work: none of this ticket's pages render any note/user-generated rich-text content (forms only render their own controlled inputs and static copy), so the AGENTS.md §11 DOMPurify rule does not apply here. The first ticket that must apply it is AB-1012 (Note Editor).
- No "remember me" / persistent login beyond the 7-day refresh-cookie TTL already defined in AB-1002 — no new persistence mechanism is introduced.
- No CI wiring — out of scope project-wide (FRS §11).

## FRs Covered

| FR | Coverage |
|---|---|
| FR-AUTH-1 | User Registration (frontend) — form + validation, register→login chaining to leave the user logged in |
| FR-AUTH-2 | User Login (frontend) — form, identical generic error on bad credentials/unknown email |
| FR-AUTH-3 | Session Management (frontend) — silent bootstrap refresh on load, transparent 401→refresh→retry in `apiClient.ts` |
| FR-AUTH-4 | Logout (frontend) — logout action/button on current device only |
| FR-AUTH-5 | Forgot Password (frontend) — request step, identical generic response regardless of email existence |
| FR-AUTH-6 | Password Reset (frontend) — verify step, generic error covering all OTP failure modes |
| FR-UI-1 (partial) | Loading/disabled-button feedback on all four forms |

## Pages / Components

```
apps/web/src/
  routes/
    router.tsx          createRouter() + code-based route tree, exported RouterProvider setup
    root.tsx             root route: renders <Outlet/>, runs session bootstrap before children render
    login.tsx             route def + guard (redirect to /notes if authenticated)
    register.tsx          route def + guard
    forgot-password.tsx   route def + guard
    notes.tsx             protected placeholder route + guard (redirect to /login if not authenticated)
  components/
    LoginForm.tsx
    RegisterForm.tsx
    ForgotPasswordForm.tsx
  stores/
    authStore.ts
  lib/
    apiClient.ts
    errorMessages.ts
```

- `App.tsx` is replaced with the `RouterProvider` mount (current placeholder `<h1>NoteApp</h1>` is removed).
- Route guards are implemented via TanStack Router's `beforeLoad` (redirect via `throw redirect({ to: ... })`), reading `authStore.getState()` directly — not a wrapper `<ProtectedRoute>` component, since TanStack Router's guard mechanism runs before the component tree renders.

## State Management

- `authStore` (Zustand, no `persist` middleware — deliberately not persisted per AGENTS.md §7/§11: access token is in-memory only, never `localStorage`, `sessionStorage`, or cookies the frontend itself sets).
  - State: `{ accessToken: string | null; user: AuthUser | null; status: 'idle' | 'authenticating' | 'authenticated' | 'unauthenticated' }`.
  - Actions: `login(email, password)`, `register(email, password)` (chains to `login` internally per Goals), `logout()`, `bootstrap()` (calls `/auth/refresh` once on app start), `setSession({ accessToken, user })`, `clearSession()`.
  - `status` starts `'idle'` until `bootstrap()` resolves (either `'authenticated'` or `'unauthenticated'`); routes render a lightweight loading state while `status === 'idle'`.
- The refresh token itself is never held in frontend state — it lives only in the `httpOnly` cookie the browser manages automatically (SDS §12).
- TanStack Query is available in `package.json` but is not required for these four mutation-only forms (no cached/paginated server data here); introducing it would be a premature abstraction for this ticket. AB-1011+ will use it for note lists.

## API Integration

`apiClient.ts` wraps `fetch` against the endpoints defined in AB-1002/AB-1003's `spec.md` (§API Contract), using shared types from `packages/shared/src/types.ts` (`AuthUser`, `RegisterResponse`, `LoginResponse`, `RefreshResponse`, `ForgotPasswordResponse`, `ApiError`):

- `POST /auth/register` → `RegisterResponse` on `201`.
- `POST /auth/login` → `LoginResponse` on `200`, sets `refreshToken` cookie server-side (browser handles it automatically via `credentials: 'include'`).
- `POST /auth/refresh` → `RefreshResponse` on `200`; used both by the bootstrap-on-load flow and the 401-retry interceptor.
- `POST /auth/logout` → `204`; called with the current `accessToken` still attached, since logout must identify which session to revoke.
- `POST /auth/forgot-password` → `ForgotPasswordResponse` on `200`.
- `POST /auth/reset-password` → `204`.

**401 interception (`FR-AUTH-3`):** any call other than `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password` that returns `401` triggers exactly one `POST /auth/refresh` attempt; on success the original request is retried once with the new token; on failure `authStore.clearSession()` runs and the error propagates so the calling route's guard sends the user to `/login`. This is written generically now because every future authenticated request (AB-1011+) reuses this same wrapper.

Non-2xx responses are parsed as `ApiError` and passed through `errorMessages.ts` before being shown to the user; `fields[]` (present on `VALIDATION_FAILED`) maps validation errors back to individual form fields where applicable.

## Ticket-Specific UX Decisions

- **Routing library — TanStack Router, not React Router**: per user decision, chosen for type-safe route definitions and consistency with TanStack Query already in the stack. Exact version pinned at implementation time (AGENTS.md §3 forbids ranges).
- **Register chains to login**: resolves the FRS (FR-AUTH-1) vs. already-shipped AB-1002 API contract mismatch entirely on the frontend — see Goals. This is called out explicitly because it's a deliberate compensating decision, not an oversight.
- **Forgot-password is one route, two steps**: avoids a throwaway `/reset-password` route not listed in SDS §1's route table, while still giving the OTP-entry step its own clearly distinct UI state.
- **DOMPurify — not applicable to this ticket**: no `dangerouslySetInnerHTML` and no rendering of note/user-generated content occurs on any of these four pages; all rendered text is either static copy or values the user themselves typed into a controlled input in the same render (see Non-Goals).
- **No new form library**: plain controlled inputs + `zod.safeParse` on submit, reusing schemas already defined in `packages/shared`, rather than adding `react-hook-form`/`@hookform/resolvers` for four small forms.
- **Session bootstrap runs once at root, not per-route**: prevents a redundant `/auth/refresh` call per navigation; `status` is checked (not re-fetched) by each route's `beforeLoad` guard.

## Scenarios

1. **Register with valid, matching email/password/confirm-password** → `201` from `/auth/register`, immediately followed by a successful chained `/auth/login`, user lands on `/notes` authenticated.
2. **Register with mismatched password/confirm-password** → blocked client-side before any request is sent; inline field error shown.
3. **Register with an email that already exists** → `409 USER_EXISTS` surfaced as a duplicate-email error; no chained login attempted.
4. **Register succeeds but the chained login unexpectedly fails** (e.g. edge-case rate limit) → user redirected to `/login` with an "Account created — please sign in" notice, not a raw error.
5. **Login with correct credentials** → `200`, `accessToken`/`user` stored in `authStore`, navigate to `/notes`.
6. **Login with wrong password** and **login with unknown email** → both render the identical generic invalid-credentials message.
7. **Login beyond rate limit** → generic rate-limited message shown.
8. **Authenticated user manually navigates to `/login` or `/register`** → redirected to `/notes` by the route guard.
9. **Unauthenticated user manually navigates to `/notes`** → redirected to `/login` by the route guard.
10. **Hard reload while a valid refresh cookie exists** → bootstrap silently restores the session (no visible login flash); user remains on `/notes`.
11. **Hard reload with no/expired refresh cookie** → bootstrap resolves `status: 'unauthenticated'`; user sees `/login`.
12. **An authenticated request returns 401 mid-session** (e.g. access token expired) → `apiClient` transparently refreshes and retries once, succeeding invisibly to the user.
13. **Refresh itself fails during the 401-retry path** (revoked/expired refresh token) → session is cleared and the user is redirected to `/login`.
14. **Forgot-password request step, for a registered email and for an unregistered email** → both show the identical generic message and both advance to the `verify` step (UI never branches on which case occurred).
15. **Reset-password verify step with correct OTP and valid new password** → `204`, redirect to `/login` with a "please sign in" notice.
16. **Reset-password verify step with wrong/expired/exhausted OTP, or for an email that was never registered** → all render the identical generic OTP-invalid message.
17. **Logout from the `/notes` placeholder** → `authStore` cleared regardless of the `/auth/logout` response outcome, user redirected to `/login`.
18. **Every form's submit button** → disabled and shows a loading indicator while its request is in flight; re-enabled on error.

## Dependencies

- AB-1002 (Core User & Auth Models) — merged; provides `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` and the `packages/shared` auth schemas/types this ticket consumes as-is.
- AB-1003 (Forgot Password Flow) — merged; provides `/auth/forgot-password`, `/auth/reset-password` and their shared schemas/types.
- New runtime dependency: `@tanstack/react-router` (exact pinned version, added to `apps/web/package.json`).
- No dependency on AB-1004+ (notes/tags/search/share/version) — the `/notes` route here is a placeholder only.

## Open Questions

None — routing library, the forgot-password two-step-vs-two-route question, the post-login placeholder-landing question, the logout-UI-location question, and the register/login contract-mismatch question were all resolved with the user before drafting; see Ticket-Specific UX Decisions and Goals.
