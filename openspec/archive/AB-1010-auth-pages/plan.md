---
ticket: AB-1010
status: APPROVED
---

# AB-1010: Auth Frontend — Plan

Spec: `openspec/changes/AB-1010-auth-pages/spec.md` (status: APPROVED)

## Graph Lookup Findings (Reuse Check)

- `get_architecture_overview` shows the knowledge graph currently only covers `apps/api` (11 communities, all backend: `routes-note`, `controllers-no`, `services-note`, `lib-when`, `middleware-error`, `jobs-notes`, migration SQL). `apps/web` has no indexed community yet — confirms it's still an unbuilt scaffold, consistent with the `.gitkeep`-only directories found during `/spec`.
- `file_summary` on `packages/shared/src/schemas.ts` (142 lines) and `packages/shared/src/types.ts` (103 lines) confirms every schema/type this ticket needs already exists and requires **zero changes**: `registerSchema`, `loginSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `passwordSchema` (schemas.ts) and `AuthUser`, `RegisterResponse`, `LoginResponse`, `RefreshResponse`, `ForgotPasswordResponse`, `ApiError` (types.ts). Nothing in this ticket duplicates or re-derives these — all imported from `shared`.

## Files to Create

```
apps/web/src/lib/apiClient.ts              fetch wrapper: bearer attach, 401→refresh→retry, credentials:'include'
apps/web/src/lib/errorMessages.ts          ApiError.code -> user-facing copy map
apps/web/src/stores/authStore.ts           Zustand store: accessToken/user/status + login/register/logout/bootstrap
apps/web/src/components/LoginForm.tsx
apps/web/src/components/RegisterForm.tsx
apps/web/src/components/ForgotPasswordForm.tsx
apps/web/src/routes/router.tsx             createRouter() + code-based route tree, exported RouterProvider
apps/web/src/routes/root.tsx                root route: runs authStore.bootstrap() before rendering <Outlet/>
apps/web/src/routes/login.tsx                route def, beforeLoad guard (authenticated -> redirect /notes)
apps/web/src/routes/register.tsx             route def, same guard
apps/web/src/routes/forgot-password.tsx      route def, same guard
apps/web/src/routes/notes.tsx                protected placeholder route, beforeLoad guard (unauthenticated -> redirect /login)
```

Test files (co-located, matching `include: ['src/**/*.test.{ts,tsx}']` in `vitest.config.ts`):

```
apps/web/src/lib/apiClient.test.ts
apps/web/src/lib/errorMessages.test.ts
apps/web/src/stores/authStore.test.ts
apps/web/src/components/LoginForm.test.tsx
apps/web/src/components/RegisterForm.test.tsx
apps/web/src/components/ForgotPasswordForm.test.tsx
apps/web/src/routes/router.test.tsx           guard-redirect behavior (authenticated/unauthenticated x each route)
```

## Files to Modify

- `apps/web/src/App.tsx` — becomes a thin `export function App() { return <RouterProvider router={router} />; }`; removes the placeholder `<h1>NoteApp</h1>`. `apps/web/src/main.tsx` is unchanged (still renders `<App />`).
- `apps/web/package.json` — add `@tanstack/react-router` dependency (see New Packages).
- `apps/web/e2e/smoke.spec.ts` — **must change**: it currently asserts an `h1` "NoteApp" heading at `/`, which disappears once `App.tsx` is replaced by the router. Root `/` will redirect via the same guard logic used elsewhere (unauthenticated → `/login`), so the updated smoke test asserts the login page's heading/form renders at `/` instead. This keeps the AB-1001 baseline-smoke intent (dev server boots, serves a real page) intact under the new routing.

## Prisma Schema Changes

None. This is a pure frontend ticket — no `apps/api/prisma/schema.prisma` changes, no migrations. (No soft-delete concerns apply; nothing here touches `Note`/`NoteVersion`.)

## New Packages

| Package | Target | Notes |
|---|---|---|
| `@tanstack/react-router` | `apps/web/package.json` (`dependencies`) | Exact pinned version, no `^`/`~` (AGENTS.md §3). **Verify the current stable release via Context7/npm at implementation time** before pinning (same "don't carry forward a stale version" caveat SDS §2.1 applies to the Postgres tag) — working assumption for this plan is the `1.12x` line, matching the existing `@tanstack/react-query@5.101.2` install already in the workspace. No `@tanstack/router-plugin`/`router-devtools` needed — routes are code-based, not file-generated. |

No other new dependencies: no `react-hook-form` (plain controlled inputs + `zod.safeParse`, per spec's Ticket-Specific UX Decisions), no new HTTP client (native `fetch`).

## Dependencies on Prior Tickets

- **AB-1002** (merged, `openspec/archive/AB-1002-auth-core`) — `/auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout` contracts consumed as-is; no backend changes.
- **AB-1003** (merged, `openspec/archive/AB-1003-auth-password-reset`) — `/auth/forgot-password`, `/auth/reset-password` contracts consumed as-is.
- **AB-1001** — provides the `apps/web` scaffold, `vitest.config.ts`/`vitest.setup.ts`, Playwright baseline, and the `shared` workspace link already in `package.json`.
- Nothing here blocks or is blocked by AB-1004+ (backend note/tag/search/share/version tickets run independently of this frontend ticket).

## Risk Areas

1. **TanStack Router API surface unfamiliarity** — code-based route-tree construction (`createRootRoute`, `createRoute`, `createRouter`) and `beforeLoad` redirect semantics (`throw redirect({ to })`) must be checked against current library docs (Context7 MCP, per AB-1001 FR-INFRA-9's mandatory tooling rule) rather than assumed from training data, since router libraries change API shape across majors.
2. **Root path (`/`) behavior change breaks the existing AB-1001 baseline smoke test** — must be a deliberate, reviewed change to `smoke.spec.ts` (see Files to Modify), not an accidental regression. Flag in code review.
3. **Session-bootstrap race** — `root.tsx` must `await` `authStore.bootstrap()` (or gate rendering on `status !== 'idle'`) before any child route's `beforeLoad` guard runs; otherwise a guard could read a stale `'idle'` status and redirect an actually-authenticated user to `/login` on hard reload.
4. **401-retry infinite loop** — `apiClient.ts`'s interceptor must exclude the `/auth/refresh` call itself (and `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password`) from triggering its own refresh-retry, or a persistently-401ing refresh call could recurse.
5. **Accidental token persistence** — Zustand's `persist` middleware is a common copy-paste default; must confirm `authStore.ts` does **not** use it (AGENTS.md §7/§11 hard requirement: access token in-memory only). Explicit check during code review.
6. **Register→login chaining doubles rate-limit consumption** — one "Register" click now costs both a registration-rate-limit hit (3/hr/IP) and a login-rate-limit hit (5/min/IP); acceptable per FRS limits but worth a comment in `RegisterForm.tsx` so it isn't "optimized away" later without re-reading the spec's reasoning.
7. **Local CORS/cookie integration** — `apiClient.ts` requires `credentials: 'include'`; relies on the already-implemented backend CORS allowlist (`WEB_ORIGIN`) and cookie `Path: /auth` scoping from AB-1002. No backend change needed, but worth one manual end-to-end check (`pnpm dev`, real browser) since Vitest/jsdom won't catch a CORS misconfiguration.

## Test Strategy

| Spec Scenario(s) | Test File | Coverage |
|---|---|---|
| 1–4 (register, mismatch, duplicate email, chained-login failure) | `RegisterForm.test.tsx` | Form validation, `409 USER_EXISTS` handling, register→login chaining success/failure paths (mocked `apiClient`) |
| 5–7 (login success, generic invalid-credentials, rate-limited) | `LoginForm.test.tsx` | Submit flow, identical error copy for wrong-password vs. unknown-email, `429` copy |
| 8–9 (authenticated redirected off `/login`/`/register`; unauthenticated redirected off `/notes`) | `router.test.tsx` | `beforeLoad` guards exercised via a test router instance with seeded `authStore` state |
| 10–11 (bootstrap restores session / resolves unauthenticated) | `authStore.test.ts` | `bootstrap()` unit tests against mocked `/auth/refresh` responses (success and failure) |
| 12–13 (401→refresh→retry success; refresh failure clears session) | `apiClient.test.ts` | Mocked global `fetch`: first call 401, refresh call 200, retry succeeds; and refresh-call-fails → session cleared, error propagated |
| 14–16 (forgot-password request/verify steps, generic messaging both branches) | `ForgotPasswordForm.test.tsx` | Two-step state transition, identical UI on registered/unregistered email, `AUTH_OTP_INVALID` generic error |
| 17 (logout clears session regardless of response) | `authStore.test.ts` + `notes.tsx` placeholder covered via `router.test.tsx` or a small `NotesPlaceholder.test.tsx` if the placeholder grows non-trivial logic | `logout()` unit test with a mocked failing `/auth/logout` call still clears local state |
| 18 (loading/disabled button states) | `LoginForm.test.tsx`, `RegisterForm.test.tsx`, `ForgotPasswordForm.test.tsx` | Assert `disabled` attribute + loading indicator while a mocked request is pending (unresolved promise) |
| `errorMessages.ts` code→copy mapping completeness | `errorMessages.test.ts` | One assertion per error code listed in spec's Goals (`VALIDATION_FAILED`, `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_INVALID`, `AUTH_REFRESH_INVALID`, `USER_EXISTS`, `AUTH_OTP_INVALID`, `RATE_LIMITED`) |

- All new tests are Vitest + Testing Library component/unit tests (`apps/web/**/*.test.{ts,tsx}`), matching AGENTS.md §10 — no Supertest/integration DB involved (no backend changes).
- No new Playwright spec beyond the required `smoke.spec.ts` update — the full authenticated E2E journey belongs to AB-1016 per the FRS traceability matrix; adding a parallel ad-hoc auth E2E test here would duplicate that ticket's scope.
- Coverage gate: ≥80% on all new files, enforced via the existing Husky pre-commit hook — no separate configuration needed.
- Quality gates before commit: `pnpm build`, `pnpm lint --max-warnings 0`, `pnpm test` (per CLAUDE.md, all three must be green; proceed without asking per CLAUDE.md's permission model).

## Open Questions

None — all ambiguities were resolved during `/spec` (routing library, forgot-password UX shape, placeholder landing page, logout UI location, register/login contract chaining).
