---
ticket: AB-1001
type: INFRA
status: APPROVED
---

# AB-1001: Technical Plan

## Graph/Reuse Check

`code-review-graph` MCP tools were not connected in this session (no matching deferred tools). Fell back to `Glob` on `apps/**` and `packages/**` — both empty. This is a greenfield scaffold; there is nothing in `packages/shared/src` to reuse yet. Re-run `get_architecture_overview` at the start of AB-1002 once real code exists.

## Files to Create

### Root

| File | Purpose |
|---|---|
| `pnpm-workspace.yaml` | `packages: ["apps/*", "packages/*"]` |
| `package.json` | `engines.node`, `packageManager` (pnpm, Corepack-pinned), root scripts (`db:up`, `db:down`, `db:reset`, `dev`, `build`, `lint`, `test`, `typecheck`) |
| `tsconfig.base.json` | Shared strict compiler options, extended by every package |
| `eslint.config.js` | Flat config, root-shared, TS + React + Node rule sets |
| `.prettierrc` | Shared formatting rules |
| `commitlint.config.js` | `@commitlint/config-conventional` + custom rule requiring `AB#\d+` in `feat`/`fix` subjects only |
| `.husky/pre-commit` | `pnpm typecheck && pnpm lint --max-warnings 0 && pnpm test --run` |
| `vitest.workspace.ts` | References `apps/api` (node env) + `apps/web` (jsdom env) projects |
| `.nvmrc` | Exact Node patch pin |
| `.env.example` | Every var from SDS §15 + commented `CONTEXT7_API_KEY` placeholder |
| `.gitignore` | Extended: `node_modules/`, `dist/`, `build/`, `.env`, `coverage/`, `playwright-report/`, `test-results/` (existing `code-review-graph` entry preserved) |
| `docker-compose.yml` | `postgres:16.14` service, `pgdata` volume, `pg_isready` healthcheck, mounts `docker/init-db.sh` |
| `docker/init-db.sh` | Creates `notes_test` on first init (`notes_dev` covered by `POSTGRES_DB`) |
| `README.md` | Full setup sequence per FR-INFRA-8 |

### `apps/api`

| File | Purpose |
|---|---|
| `package.json` | Exact-pinned deps (see below) |
| `tsconfig.json` | Extends root base, `outDir`/`rootDir` for `src` |
| `vitest.config.ts` | Node environment, references `TEST_DATABASE_URL` for integration tier (used starting AB-1002; no tests reference it yet) |
| `prisma/schema.prisma` | `datasource`/`generator` blocks only — **no models**. Models begin AB-1002 per ticket dependency map. |
| `src/app.ts` | Express instance; wires the fixed middleware order from SDS §5: helmet → cors → body parsing → cookie parsing → rate-limit factory (unapplied) → routes (mounts an empty router returning 404 for everything) → error handler. No feature routes. |
| `src/server.ts` | Calls `loadEnv()`, then `app.listen(PORT)`; used by `pnpm dev` |
| `src/lib/env.ts` | Zod schema validating `process.env` (`DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN`, etc.); throws and `process.exit(1)` with a clear message on missing/invalid required vars — satisfies FR-INFRA-6 fail-fast requirement |
| `src/lib/prisma.ts` | Prisma client singleton (generates against the empty schema; unused until AB-1002 adds models) |
| `src/lib/logger.ts` | `pino` singleton with `password`/`token`/`otp`/`authorization`/`cookie` redaction paths configured now (SDS §16), even though nothing logs sensitive data yet |
| `src/middleware/cors.ts` | Explicit origin allowlist from `WEB_ORIGIN`, `credentials: true` |
| `src/middleware/helmet.ts` | Helmet + CSP (`script-src`/`style-src`/`img-src` `'self'`, `style-src` `'unsafe-inline'` for future TipTap styles) |
| `src/middleware/bodyLimit.ts` | Exports two configured `express.json()` limiters (`1mb` for future `/notes`, `10kb` default) — not yet route-scoped since no routes exist |
| `src/middleware/rateLimit.ts` | Generic `createRateLimiter(opts)` factory (via `express-rate-limit`) — no route wiring yet; per-route limits (FRS §11 table) applied starting AB-1002 |
| `src/middleware/errorHandler.ts` | Global error handler: maps `AppError`, `ZodError`, Prisma `P2002`/`P2025`, falls back to `500 INTERNAL_ERROR`; registered last |
| `src/routes/index.ts` | Empty router (placeholder, returns 404 JSON `ApiError`) — real routers mount here starting AB-1002 |
| `src/controllers/`, `src/services/`, `src/jobs/` | Empty directories with `.gitkeep` — populated starting AB-1002/AB-1009 |

### `apps/web`

| File | Purpose |
|---|---|
| `package.json` | Exact-pinned deps |
| `tsconfig.json` | Extends root base, DOM lib |
| `vite.config.ts` | React plugin, dev server port |
| `vitest.config.ts` | jsdom environment, Testing Library setup file |
| `index.html` | Vite entry HTML |
| `src/main.tsx` | React root mount |
| `src/App.tsx` | Renders a placeholder "NoteApp" landing page — just enough for the Playwright smoke test to assert against |
| `src/routes/`, `src/components/`, `src/stores/`, `src/lib/` | Empty directories with `.gitkeep` — populated starting AB-1010 |
| `e2e/playwright.config.ts` | Points at local dev server (`webServer` config auto-starts `pnpm dev` for CI-less local runs) |
| `e2e/smoke.spec.ts` | Baseline smoke test: visits `/`, asserts the placeholder heading renders |

### `packages/shared`

| File | Purpose |
|---|---|
| `package.json` | Exact-pinned deps (`zod` only) |
| `tsconfig.json` | Extends root base, declaration output |
| `src/schemas.ts` | Empty export placeholder (`export {}`) — populated starting AB-1002 |
| `src/types.ts` | `Page<T>` and `ApiError` types defined now (per AGENTS.md §8/§12 — these are cross-cutting envelope types with no feature dependency, safe to define in this ticket) |
| `src/errorCodes.ts` | Empty error code registry object populated incrementally — safe to stub the type shape now, add codes starting AB-1002 |

### `.claude`

| File | Change |
|---|---|
| `.claude/settings.json` | Add unauthenticated Context7 MCP server entry to existing `mcpServers`/hooks config — existing hooks preserved, not replaced |
| `.claude/agents/reviewer.md`, `.claude/agents/test-writer.md` | Confirm read-only / test-path-only tool scoping matches FR-INFRA-9 (already present — verify only, no edit expected) |
| `.claude/commands/*.md` | Confirm all seven commands present (already present — verify only) |

## Prisma Schema Changes

None yet — `schema.prisma` is initialized with only `datasource db` (`postgresql`, `env("DATABASE_URL")`) and `generator client` (`prisma-client-js`) blocks. Zero models. No migration is generated in this ticket (nothing to migrate). The first real migration — `User`, `RefreshToken`, `PasswordResetOtp` — is created in AB-1002, and it is that migration which must respect the no-`CASCADE DELETE`-bypassing-soft-delete rule (not applicable yet since `Note` doesn't exist in this ticket).

`pnpm db:reset`'s `prisma migrate dev` step will simply produce a no-op / migrations-folder-with-no-models result at this stage — the scenario under test (FR-INFRA-2) is that the reset mechanism runs cleanly end-to-end, not that specific tables exist yet.

## New Packages (Exact Pinned Versions)

Verified via web search on 2026-07-10 (re-verify at implementation time regardless — pin whatever `npm view <pkg> version` reports then, these are current-as-of-drafting):

| Package | Version | Notes |
|---|---|---|
| `typescript` | `6.0.3` | **Not** `7.0.2` — see Risk Areas. Final JS-based release line, patch-only from here. |
| `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser` | `8.63.0` | Supports TS `>=4.8.4 <6.1.0`, i.e. covers `6.0.3` |
| `express` | `5.2.1` | TC-endorsed production release (shipped as 5.2 line, Dec 2025) |
| `react`, `react-dom` | `19.2.7` | |
| `vite` | `8.1.0` | Supports React 19 (manual React 19 setup, Vite doesn't scaffold it by default) |
| `@vitejs/plugin-react` | latest compatible with Vite 8 — verify exact patch at implementation | |
| `prisma`, `@prisma/client` | `7.8.0` | Major-version-7 (Rust-free) — verify migration CLI flags against v7 docs, not v5-era SDS examples |
| `zod` | `4.4.3` | v4 — breaking changes vs v3 API; `packages/shared/src/schemas.ts` must use v4 syntax from AB-1002 onward |
| `@tanstack/react-query` | `5.101.2` | |
| `@tiptap/core`, `@tiptap/react`, `@tiptap/starter-kit`, `@tiptap/pm` | `3.27.x` | Not installed in this ticket (no editor code yet) — version recorded here for AB-1012's use, since it was researched now |

Pin at implementation time via Context7/`npm view` (not individually researched — low breaking-change risk, no ecosystem-compatibility trap like TS7/zod4/prisma7):
`zustand`, `vitest`, `@vitest/coverage-v8`, `@playwright/test`, `@testing-library/react`, `@testing-library/jest-dom`, `supertest`, `husky`, `@commitlint/cli`, `@commitlint/config-conventional`, `eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `prettier`, `eslint-config-prettier`, `express-rate-limit`, `helmet`, `cors`, `cookie-parser`, `pino`, `pino-http`, `dotenv` (or Zod-only env parsing, no dotenv needed if using `process.env` directly with a `.env` loader built into Node 22/`tsx`), `tsx` (dev-time TS execution), `@types/node`, `@types/express`, `@types/cors`, `@types/cookie-parser`.

Not installed in this ticket (deferred to the ticket that needs them, keeping AB-1001 free of feature-adjacent deps): `bcrypt`, `jsonwebtoken`, `dompurify`, `@types/bcrypt`, `@types/jsonwebtoken`, `@types/dompurify`, TipTap packages (recorded above for later).

## Dependencies on Prior Tickets

None — AB-1001 is the root of the dependency graph (FRS §13).

## Risk Areas

1. **TypeScript 7.0 vs `typescript-eslint`**: TS 7.0.2 is the latest published version, but `typescript-eslint` only supports `<6.1.0` as of 2026-07-10 (confirmed via GitHub issue #12518/#12123). Installing TS7 would silently break the zero-lint-warning gate (FR-INFRA-5) or force a peer-dependency override. **Mitigation**: pin `typescript@6.0.3`, the final JS-based release. Revisit once `typescript-eslint` ships official TS7 support.
2. **Zod v4 breaking changes vs v3**: SDS/AGENTS examples don't pin a Zod major version. v4 changed error-map APIs and some schema method signatures vs v3. **Mitigation**: standardize on v4 syntax starting now; no v3-authored snippets should be copied verbatim from any v3-era reference material during AB-1002+.
3. **Prisma v7 (Rust-free) vs SDS's v5-era assumptions**: The SDS's raw-SQL migration guidance (`--create-only`) and `$transaction` usage are stable across Prisma majors, but CLI flags/output format for `prisma migrate dev` may differ under v7's new engine. **Mitigation**: verify exact CLI behavior against live Prisma 7 docs via Context7 when AB-1002 runs the first real migration, not by assuming v5/v6 behavior.
4. **Docker init script vs Postgres user privileges**: the init script must run as a role with `CREATEDB` privilege (the default `POSTGRES_USER` superuser does, but double-check if `POSTGRES_USER` is ever changed from a superuser default).
5. **Vite 8 + React 19 default scaffolding mismatch**: Vite's React template still defaults to React 18; the plan explicitly pins React 19 packages and `@vitejs/plugin-react` compatible with it rather than trusting `pnpm create vite` defaults.
6. **Context7 unauthenticated tier rate limits**: if implementation work in later tickets hits Context7 rate limits, an authenticated key can be added via the reserved `CONTEXT7_API_KEY` env var without any spec/plan change — flagged so nobody re-litigates this decision mid-ticket.

## Test Strategy

| Spec Scenario | Test |
|---|---|
| Fresh clone, `pnpm install` | Manual verification step in README; no automated test (would require a CI runner, out of scope) |
| Type/schema shared, not duplicated | ESLint rule (`no-restricted-imports` or import boundary check) forbidding `apps/*` from redefining anything exported by `packages/shared` — enforced at lint time, not a dedicated test file |
| `pnpm db:up` → healthy, both DBs exist | Manual verification (Docker healthcheck itself is the automated gate; no app-level test needed since no schema/tables exist yet) |
| `pnpm db:reset` | Manual verification — mechanism check only, no data to assert against yet |
| `pnpm test` (integration tier isolation) | N/A yet — no integration tests exist until AB-1002; `TEST_DATABASE_URL` wiring is present but unused |
| Fresh clone, `pnpm test` runs w/o config errors | `apps/web/e2e/smoke.spec.ts` (Playwright) + implicit pass of `vitest.workspace.ts` resolving both projects with zero test files (Vitest must not error on zero suites) |
| Playwright smoke test passes | `apps/web/e2e/smoke.spec.ts` — visits `/`, asserts placeholder heading text is visible |
| Commit blocked on lint error | Manual verification during implementation (intentionally introduce a lint error, confirm Husky blocks, then revert) — documented as a one-time verification step, not a persisted test |
| Commit blocked on missing `AB#` on `feat` | Same manual one-time verification for commitlint |
| `chore`/`docs` commit succeeds without ticket ref | Same manual one-time verification |
| `pnpm lint --max-warnings 0` fails on any warning | Implicit in the lint script config (`--max-warnings 0` flag) — no separate test file |
| Missing required env var → fail-fast | `apps/api/src/lib/env.test.ts` (Vitest unit test): mocks `process.env` missing `JWT_SECRET`, asserts `loadEnv()` throws/exits with a descriptive error before any server code runs |
| Every `package.json` dependency exact-pinned | `scripts/check-pinned-deps.test.ts` (Vitest unit test, root-level): reads every workspace `package.json`, asserts no dependency value starts with `^`, `~`, or equals `latest` |
| README enables fresh-clone success | Manual verification (a real "fresh clone" automated test isn't practical without CI, which is out of scope) |
| `/start` confirms context loaded | Already demonstrated in this session — no additional test artifact needed |
| `reviewer` agent is read-only | Manual verification: confirm `.claude/agents/reviewer.md` tool list excludes `Write`/`Edit`/`Bash` (already true — recheck, don't just trust the filename) |
| Library API verified via Context7 | Process check during future `/implement` runs, not a test file |
