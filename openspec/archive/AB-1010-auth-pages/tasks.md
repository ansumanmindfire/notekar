---
ticket: AB-1010
status: APPROVED
---

# AB-1010: Auth Frontend — Tasks

Plan: `openspec/changes/AB-1010-auth-pages/plan.md` (status: APPROVED)

Each task is scoped to one file (or one paired impl/test file) and is independently testable/runnable once its listed dependencies are done. `[PARALLEL]` tasks have no file or ordering dependency on their sibling `[PARALLEL]` tasks at that point in the sequence.

## 1. Foundations

- [x] **1.1** Add `@tanstack/react-router` as an exact-pinned dependency. Verify the current stable release via Context7/npm before pinning (AGENTS.md §3 — no `^`/`~`; SDS §2.1 "don't carry forward a stale version" caveat applies). `[PARALLEL]` — 10 min
  Files: `apps/web/package.json`
  Scenarios: none directly (infrastructure for all)

- [x] **1.2** Implement `errorMessages.ts` — maps every `ApiError.code` this ticket can receive (`VALIDATION_FAILED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_INVALID`, `AUTH_REFRESH_INVALID`, `USER_EXISTS`, `AUTH_OTP_INVALID`, `RATE_LIMITED`) to user-facing copy. `[PARALLEL]` — 20 min
  Files: `apps/web/src/lib/errorMessages.ts`
  Scenarios: supports 3, 6, 7, 16

- [x] **1.3** Test `errorMessages.ts` — one assertion per mapped code, plus an "unknown code falls back to a generic message" case. — 15 min
  Files: `apps/web/src/lib/errorMessages.test.ts`
  Depends on: 1.2

- [x] **1.4** Implement `authStore.ts` — Zustand store (no `persist` middleware) with `accessToken`, `user`, `status`, and `login`/`register`/`logout`/`bootstrap`/`setSession`/`clearSession`. `login`/`bootstrap` call `apiClient` directly is deferred — for this task, stub the network calls behind an injectable/mockable boundary so `apiClient.ts` (1.6) can be implemented next without a circular dependency. `[PARALLEL]` — 30 min
  Files: `apps/web/src/stores/authStore.ts`
  Scenarios: supports 5, 10, 11, 17

- [x] **1.5** Test `authStore.ts` — `bootstrap()` restoring session on success / resolving `'unauthenticated'` on failure; `logout()` clearing local state even when the network call fails; no `persist` middleware present (risk area #5). — 30 min
  Files: `apps/web/src/stores/authStore.test.ts`
  Depends on: 1.4
  Scenarios: 10, 11, 17

## 2. API Client

- [x] **2.1** Implement `apiClient.ts` — fetch wrapper: attaches `Authorization: Bearer <accessToken>` from `authStore`, `credentials: 'include'`, parses non-2xx as `ApiError`. Excludes `/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/forgot-password`, `/auth/reset-password` from its own 401-retry logic (risk area #4). — 35 min
  Files: `apps/web/src/lib/apiClient.ts`
  Depends on: 1.4
  Scenarios: supports 12, 13

- [x] **2.2** Test `apiClient.ts` — mocked global `fetch`: (a) 401 on a protected call → refresh succeeds → original request retried once and succeeds; (b) 401 → refresh itself fails → session cleared, error propagates; (c) `/auth/refresh` call itself never re-triggers the interceptor. — 35 min
  Files: `apps/web/src/lib/apiClient.test.ts`
  Depends on: 2.1
  Scenarios: 12, 13

- [x] **2.3** Wire `authStore.login`/`register`/`logout`/`bootstrap` to call through `apiClient.ts` (resolves the stub from 1.4). — 20 min
  Files: `apps/web/src/stores/authStore.ts`, `apps/web/src/stores/authStore.test.ts`
  Depends on: 2.1, 1.4, 1.5

## 3. Forms

- [x] **3.1** Implement `LoginForm.tsx` — email/password fields, `loginSchema.safeParse` client validation, calls `authStore.login`, generic error copy on `401`/`429`, loading/disabled submit button. `[PARALLEL]` — 30 min
  Files: `apps/web/src/components/LoginForm.tsx`
  Depends on: 2.3, 1.2
  Scenarios: 5, 6, 7, 18

- [x] **3.2** Test `LoginForm.tsx` — valid submit success path, wrong-password and unknown-email render identical copy, rate-limited copy, submit button disabled/loading while in flight. — 25 min
  Files: `apps/web/src/components/LoginForm.test.tsx`
  Depends on: 3.1

- [x] **3.3** Implement `RegisterForm.tsx` — email/password/confirm-password (client-only) fields, `registerSchema.safeParse`, on `201` chains `authStore.login` with the same credentials, `409` duplicate-email copy, chained-login-failure fallback (redirect to `/login` with a notice). Include the risk-area-#6 comment on doubled rate-limit consumption. `[PARALLEL]` — 35 min
  Files: `apps/web/src/components/RegisterForm.tsx`
  Depends on: 2.3, 1.2
  Scenarios: 1, 2, 3, 4, 18

- [x] **3.4** Test `RegisterForm.tsx` — successful register+chained-login, client-side confirm-password mismatch blocks submission, duplicate-email `409`, chained-login failure fallback path, loading/disabled button. — 30 min
  Files: `apps/web/src/components/RegisterForm.test.tsx`
  Depends on: 3.3

- [x] **3.5** Implement `ForgotPasswordForm.tsx` — two-step internal state (`request` → `verify`); request step posts email, always advances with the generic message; verify step posts OTP + new password (+confirm), generic error on any `AUTH_OTP_INVALID` cause, success redirects to `/login` with a notice. `[PARALLEL]` — 35 min
  Files: `apps/web/src/components/ForgotPasswordForm.tsx`
  Depends on: 2.1, 1.2
  Scenarios: 14, 15, 16, 18

- [x] **3.6** Test `ForgotPasswordForm.tsx` — request step identical UI for registered/unregistered email, verify step success redirect, verify step generic error across OTP failure causes, loading/disabled buttons on both steps. — 30 min
  Files: `apps/web/src/components/ForgotPasswordForm.test.tsx`
  Depends on: 3.5

## 4. Routing

- [x] **4.1** Implement `router.tsx` + `root.tsx` — code-based route tree scaffold (`createRootRoute`/`createRouter`), root route awaits `authStore.bootstrap()` (or gates on `status !== 'idle'`) before rendering `<Outlet/>` (risk area #3). — 30 min
  Files: `apps/web/src/routes/router.tsx`, `apps/web/src/routes/root.tsx`
  Depends on: 1.4 (bootstrap), 1.1 (package installed)
  Scenarios: supports 10, 11

- [x] **4.2** Implement `login.tsx` route — mounts `LoginForm`, `beforeLoad` guard redirects to `/notes` if `status === 'authenticated'`. `[PARALLEL]` — 15 min
  Files: `apps/web/src/routes/login.tsx`
  Depends on: 4.1, 3.1
  Scenarios: 8

- [x] **4.3** Implement `register.tsx` route — mounts `RegisterForm`, same guard as 4.2. `[PARALLEL]` — 15 min
  Files: `apps/web/src/routes/register.tsx`
  Depends on: 4.1, 3.3
  Scenarios: 8

- [x] **4.4** Implement `forgot-password.tsx` route — mounts `ForgotPasswordForm`, same guard as 4.2. `[PARALLEL]` — 15 min
  Files: `apps/web/src/routes/forgot-password.tsx`
  Depends on: 4.1, 3.5
  Scenarios: 8

- [x] **4.5** Implement `notes.tsx` route — protected placeholder: welcome message with `user.email`, "Log out" button wired to `authStore.logout()` then navigate to `/login`; `beforeLoad` guard redirects to `/login` if not `'authenticated'`. `[PARALLEL]` — 25 min
  Files: `apps/web/src/routes/notes.tsx`
  Depends on: 4.1, 2.3
  Scenarios: 9, 17

- [x] **4.6** Test `router.tsx` route guards — for each of `/login`, `/register`, `/forgot-password`, `/notes`, seed `authStore` state and assert the correct redirect (or no redirect) via a test router instance. — 40 min
  Files: `apps/web/src/routes/router.test.tsx`
  Depends on: 4.2, 4.3, 4.4, 4.5
  Scenarios: 8, 9

## 5. Assembly & Baseline

- [x] **5.1** Modify `App.tsx` to mount `<RouterProvider router={router} />`, removing the AB-1001 placeholder `<h1>NoteApp</h1>`. `main.tsx` unchanged. — 10 min
  Files: `apps/web/src/App.tsx`
  Depends on: 4.1

- [x] **5.2** Update `smoke.spec.ts` — root `/` now redirects (unauthenticated → `/login`); assert the login page's heading/form renders instead of the removed "NoteApp" heading (risk area #2 — deliberate, reviewed change, not a silent regression). — 15 min
  Files: `apps/web/e2e/smoke.spec.ts`
  Depends on: 5.1, 4.2

- [x] **5.3** Manual end-to-end check against a real running stack (`pnpm dev`): register → (chained login) → `/notes` placeholder → logout → login → forgot-password (request + verify) → back to login. Confirms CORS/cookie behavior (risk area #7) that jsdom-based unit tests cannot verify. — 20 min
  Depends on: all of the above
  Scenarios: 1–17 (integration confirmation, not a replacement for the unit tests above)

- [x] **5.4** Run quality gates: `pnpm build` (0 errors), `pnpm lint --max-warnings 0`, `pnpm test` (all green). Confirm ≥80% coverage on all new files per the Husky pre-commit gate. — 15 min
  Depends on: all of the above

## Open Questions

None.
