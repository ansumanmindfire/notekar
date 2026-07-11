---
ticket: AB-1001
type: INFRA
status: APPROVED
---

# AB-1001: Tasks

Scenario references use the row order of `spec.md`'s **Scenarios** table (S1 = first row, S2 = second, …), quoted short for clarity since the table has no literal IDs.

## Phase 0 — Root Workspace Skeleton

- [x] **T1** [PARALLEL] Create `pnpm-workspace.yaml` (`apps/*`, `packages/*`) — 5min — Scenario: S1 "fresh clone, `pnpm install`" — Files: `pnpm-workspace.yaml`
- [x] **T2** [PARALLEL] Create root `package.json` (`engines.node`, `packageManager` pin, `db:up`/`db:down`/`db:reset`/`dev`/`build`/`lint`/`test`/`typecheck` scripts, no deps yet) — 15min — Scenario: S1, S13 "every `package.json` exact-pinned" — Files: `package.json`
- [x] **T3** [PARALLEL] Create `.nvmrc` with exact Node patch — 5min — Scenario: S1 — Files: `.nvmrc`
- [x] **T4** [PARALLEL] Create `tsconfig.base.json` (strict, `noImplicitAny`, etc.) — 10min — Scenario: S1 — Files: `tsconfig.base.json`
- [x] **T5** [PARALLEL] Extend `.gitignore` (`node_modules/`, `dist/`, `build/`, `.env`, `coverage/`, `playwright-report/`, `test-results/`) — 5min — Scenario: S12 "`.env` copied and filled in, fresh clone" — Files: `.gitignore`

## Phase 1 — Docker / Local Database

- [x] **T6** Create `docker-compose.yml` (`postgres:16.14`, `pgdata` volume, `pg_isready` healthcheck, port mapping) — 15min — Scenario: S3 "`pnpm db:up` run", S4 "`pnpm db:reset` run" — Files: `docker-compose.yml`
- [x] **T7** Create `docker/init-db.sh` (creates `notes_test`; `notes_dev` covered by `POSTGRES_DB`) — 10min — Scenario: S3 — Files: `docker/init-db.sh`
- [x] **T8** Create `.env.example` (every var from SDS §15 + commented `CONTEXT7_API_KEY`) — 15min — Scenario: S12, S12b "missing required env var" — Files: `.env.example`
- [x] **T9** Checkpoint: `pnpm db:up`, wait for healthy, verify `notes_dev` + `notes_test` both reachable via `psql`/connection string — 10min — Scenario: S3 — Files: none (verification only)

## Phase 2 — Lint / Format / Commit Tooling

- [x] **T10** [PARALLEL] Create `eslint.config.js` (flat config, TS + React + Node rule sets) — 25min — Scenario: S11 "`pnpm lint` run from root" — Files: `eslint.config.js`
- [x] **T11** [PARALLEL] Create `.prettierrc` — 5min — Scenario: S11 — Files: `.prettierrc`
- [x] **T12** [PARALLEL] Create `commitlint.config.js` (`@commitlint/config-conventional` + custom `AB#\d+` rule scoped to `feat`/`fix`) — 15min — Scenario: S8 "`feat` message lacking `AB#`", S10 "`chore`/`docs`, no ticket ref, succeeds" — Files: `commitlint.config.js`
- [x] **T13** Create `.husky/pre-commit` (hand-authored, husky v9 plain-script format) with `pnpm typecheck && pnpm lint --max-warnings 0 && pnpm test --run` — 15min — Scenario: S7 "commit attempted with a lint error present" — Files: `.husky/pre-commit` — NOTE: executable bit doesn't persist via `chmod` on this Windows/git-bash environment; needs `git update-index --chmod=+x` at T59 with explicit permission.

## Phase 3 — `packages/shared`

- [x] **T14** Create `packages/shared/package.json` (`zod` exact-pinned, plus `typescript` devDep for the typecheck script) — 10min — Scenario: S13 — Files: `packages/shared/package.json`
- [x] **T15** [PARALLEL] Create `packages/shared/tsconfig.json` (extends base, declaration output) — 5min — Files: `packages/shared/tsconfig.json`
- [x] **T16** [PARALLEL] Create `packages/shared/src/types.ts` (`Page<T>`, `ApiError`) — 10min — Scenario: S2 "type/schema needed in both frontend and backend" — Files: `packages/shared/src/types.ts`
- [x] **T17** [PARALLEL] Create `packages/shared/src/schemas.ts` (empty placeholder) — 5min — Scenario: S2 — Files: `packages/shared/src/schemas.ts`
- [x] **T18** [PARALLEL] Create `packages/shared/src/errorCodes.ts` (empty registry shape) — 5min — Scenario: S2 — Files: `packages/shared/src/errorCodes.ts`
- [x] **T18b** (unscoped addition, reviewer-flagged, accepted) Create `packages/shared/src/index.ts` barrel — 5min — Files: `packages/shared/src/index.ts`

## Phase 4 — `apps/api` Scaffold

- [x] **T19** Create `apps/api/package.json` (exact-pinned: `express@5.2.1`, `typescript@6.0.3`, `prisma`/`@prisma/client@7.8.0`, `zod@4.4.3`, `pino`, `pino-http`, `cors`, `cookie-parser`, `helmet`, `express-rate-limit`, `tsx`, `@types/*`, `vitest`, `supertest`) — 20min — Scenario: S13 — Files: `apps/api/package.json`
- [x] **T20** [PARALLEL] Create `apps/api/tsconfig.json` (extends base) — 5min — Files: `apps/api/tsconfig.json`
- [x] **T21** [PARALLEL] Create `apps/api/prisma/schema.prisma` (`datasource`/`generator` only, zero models) — 10min — Scenario: S3 (dual-DB target for future migrations) — Files: `apps/api/prisma/schema.prisma`
- [x] **T22** Create `apps/api/src/lib/env.ts` (Zod-validated `process.env`, fail-fast via thrown `EnvValidationError`) — 20min — Scenario: S12b "required env var missing → crash immediately" — Files: `apps/api/src/lib/env.ts`
- [x] **T22b** (unscoped addition, needed by errorHandler.ts) Create `apps/api/src/lib/AppError.ts` — 10min — Files: `apps/api/src/lib/AppError.ts` — fixed post-review: `fields` typed `string[] | undefined` (not optional) to satisfy `exactOptionalPropertyTypes`
- [x] **T23** [TESTER] Create `apps/api/src/lib/env.test.ts` — 15min — Scenario: S12b — Files: `apps/api/src/lib/env.test.ts`
- [x] **T23b** [TESTER, unscoped] Create `apps/api/src/lib/AppError.test.ts`, `apps/api/src/middleware/errorHandler.test.ts` — Files: both
- [x] **T24** [PARALLEL] Create `apps/api/src/lib/prisma.ts` (Prisma client singleton) — 10min — Files: `apps/api/src/lib/prisma.ts`
- [x] **T25** [PARALLEL] Create `apps/api/src/lib/logger.ts` (`pino` singleton, redaction paths) — 10min — Files: `apps/api/src/lib/logger.ts`
- [x] **T26** [PARALLEL] Create `apps/api/src/middleware/cors.ts` (origin allowlist from `WEB_ORIGIN`) — 10min — Files: `apps/api/src/middleware/cors.ts`
- [x] **T27** [PARALLEL] Create `apps/api/src/middleware/helmet.ts` (CSP config) — 10min — Files: `apps/api/src/middleware/helmet.ts` — fixed post-review: explicit `frameguard`/`hsts` instead of implicit defaults
- [x] **T28** [PARALLEL] Create `apps/api/src/middleware/bodyLimit.ts` (`1mb`/`10kb` limiters) — 10min — Files: `apps/api/src/middleware/bodyLimit.ts`
- [x] **T29** [PARALLEL] Create `apps/api/src/middleware/rateLimit.ts` (generic `createRateLimiter` factory, unwired) — 10min — Files: `apps/api/src/middleware/rateLimit.ts` — still unwired, carried forward to AB-1002+ per plan
- [x] **T30** [PARALLEL] Create `apps/api/src/middleware/errorHandler.ts` (`AppError`/`ZodError`/Prisma `P2002`/`P2025`/500 fallback) — 20min — Files: `apps/api/src/middleware/errorHandler.ts` — fixed post-review: conditional spread for optional `fields`
- [x] **T31** [PARALLEL] Create `apps/api/src/routes/index.ts` (empty router, 404 JSON `ApiError`) — 10min — Files: `apps/api/src/routes/index.ts`
- [x] **T32** Create `apps/api/src/app.ts` (wires T24–T31 in SDS §5 fixed order) — 20min — depends on T22, T24–T31 — Scenario: S1 — Files: `apps/api/src/app.ts` — fixed post-review: now also wires `pino-http` request logging
- [x] **T33** Create `apps/api/src/server.ts` (`loadEnv()` then `app.listen`) — 10min — depends on T32 — Files: `apps/api/src/server.ts`
- [x] **T34** [PARALLEL] Add `.gitkeep` to `apps/api/src/controllers/`, `apps/api/src/services/`, `apps/api/src/jobs/` — 5min — Files: 3× `.gitkeep`
- [x] **T35** [PARALLEL] Create `apps/api/vitest.config.ts` (node env) — 10min — Files: `apps/api/vitest.config.ts`

## Phase 5 — `apps/web` Scaffold

- [x] **T36** Create `apps/web/package.json` (exact-pinned: `react`/`react-dom@19.2.7`, `vite@8.1.0`, `@vitejs/plugin-react`, `zustand`, `@tanstack/react-query@5.101.2`, `typescript@6.0.3`, `vitest`, `@testing-library/react`, `@playwright/test`) — 15min — Scenario: S13 — Files: `apps/web/package.json`
- [x] **T37** [PARALLEL] Create `apps/web/tsconfig.json` (extends base, DOM lib) — 5min — Files: `apps/web/tsconfig.json`
- [x] **T38** [PARALLEL] Create `apps/web/vite.config.ts` (React plugin, dev port) — 10min — Files: `apps/web/vite.config.ts`
- [x] **T39** [PARALLEL] Create `apps/web/index.html` — 5min — Files: `apps/web/index.html`
- [x] **T40** Create `apps/web/src/App.tsx` (placeholder "NoteApp" heading) — 10min — Scenario: S6 "Playwright smoke test passes" — Files: `apps/web/src/App.tsx`
- [x] **T41** Create `apps/web/src/main.tsx` (mounts `App`) — 5min — depends on T40 — Files: `apps/web/src/main.tsx`
- [x] **T42** [PARALLEL] Add `.gitkeep` to `apps/web/src/routes/`, `components/`, `stores/`, `lib/` — 5min — Files: 4× `.gitkeep`
- [x] **T42b** (unscoped addition) Create `apps/web/vitest.setup.ts` — 5min — Files: `apps/web/vitest.setup.ts`
- [x] **T43** [PARALLEL] Create `apps/web/vitest.config.ts` (jsdom env, Testing Library setup) — 10min — Files: `apps/web/vitest.config.ts`
- [x] **T44** Create `apps/web/e2e/playwright.config.ts` (`webServer` auto-starts `pnpm dev`) — 15min — Scenario: S6 — Files: `apps/web/e2e/playwright.config.ts`
- [x] **T45** [TESTER] Create `apps/web/e2e/smoke.spec.ts` (visits `/`, asserts placeholder heading) — 15min — depends on T40, T44 — Scenario: S6 — Files: `apps/web/e2e/smoke.spec.ts`

## Phase 6 — Root Test Wiring

- [x] **T46** Create `vitest.workspace.ts` (references `apps/api` + `apps/web` projects, plus a root-scoped 3rd project for `scripts/**` discovered post-review) — 10min — depends on T35, T43 — Scenario: S5 "`pnpm test` executes across all packages w/o config errors" — Files: `vitest.workspace.ts`
- [x] **T47** [TESTER] Create `scripts/check-pinned-deps.test.ts` (asserts no `^`/`~`/`latest` in any workspace `package.json`, allows `workspace:*`) — 20min — Scenario: S13 — Files: `scripts/check-pinned-deps.test.ts`

## Phase 7 — Docs & AI Workflow Scaffolding

- [x] **T48** Create root `README.md` (install → db:up → env → migrate → dev → test sequence) — 25min — Scenario: S14 "new developer follows README from fresh clone" — Files: `README.md`
- [x] **T48b** [TESTER, unscoped] Create `scripts/check-readme-commands.test.ts` (README command table vs real package.json scripts) — Files: `scripts/check-readme-commands.test.ts`
- [x] **T49** Update `.claude/settings.json` — add unauthenticated Context7 MCP entry, preserve existing hooks — 10min — Scenario: S17 "library API verified via Context7" — Files: `.claude/settings.json`
- [x] **T50** [PARALLEL] Verify `.claude/agents/reviewer.md` tool list excludes `Write`/`Edit`/`Bash` — 5min — Scenario: S16 "`reviewer` agent invoked, cannot write/edit" — Files: none (read-only check) — confirmed present
- [x] **T51** [PARALLEL] Verify `.claude/agents/test-writer.md` is scoped to test file paths only — 5min — Files: none (read-only check) — confirmed scoped via prose (soft, not structural — accepted WARN)
- [x] **T52** [PARALLEL] Verify all seven `.claude/commands/*.md` (`start`, `spec`, `plan`, `tasks`, `implement`, `review`, `pr`) are present — 5min — Files: none (read-only check) — confirmed present

## Phase 8 — Install & End-to-End Verification

- [x] **T53** Run `pnpm install` at root — verify all three packages install without error — 10min — depends on all `package.json` tasks (T2, T14, T19, T36) — Scenario: S1 — Files: none — required approving pnpm's build-script gate (esbuild/prisma/@prisma engines+client) and relaxing the Node version pin to match the real environment (22.22.0)
- [x] **T54** Run `pnpm --filter api run prisma:migrate` (no-op, zero models) — verify it completes cleanly — 10min — depends on T21, T9 — Scenario: S4 — Files: none (no migration generated, zero models) — required downgrading Prisma 7→6.19.3 and adding dotenv-cli for root .env loading (see review-log.md for full rationale)
- [x] **T55** Run `pnpm dev` — verify API boots (no crash) and web dev server serves the placeholder page at `/` — 10min — depends on T33, T41 — Scenario: S1 — Files: none
- [x] **T56** Run `pnpm lint --max-warnings 0` from root — verify zero warnings across all packages — 10min — depends on T10–T12, T19, T36 — Scenario: S11 — Files: none — required 3 eslint.config.js fixes (no-undef off, argsIgnorePattern, remove unneeded projectService)
- [x] **T57** Run `pnpm test --coverage` from root — verify all suites pass — 10min — depends on T46, T47, T23 — Scenario: S5, S12b, S13 — Files: none — required migrating vitest.workspace.ts (removed in Vitest 4) to a root vitest.config.ts with test.projects, plus 2 test-file fixes (tester agent). Result: 5 files, 42 tests, 100% coverage.
- [x] **T58** Run Playwright smoke test (`pnpm --filter web exec playwright test`) — verify it passes against the running dev server — 10min — depends on T45, T55 — Scenario: S6 — Files: none — required moving playwright.config.ts from apps/web/e2e/ to apps/web/ (Playwright's actual auto-discovery location). Result: 1 passed.
- [x] **T59** Manual verification: introduce a temporary lint error, attempt commit, confirm Husky pre-commit blocks it, then revert the temporary error — 15min — depends on T13, T56 — Scenario: S7 — Files: none — **SKIPPED per explicit user choice** (git-touching step deferred; also still needs the .husky/pre-commit executable-bit fix from Phase 2)
- [x] **T60** Manual verification: attempt a `feat` commit message with no `AB#` reference, confirm commitlint blocks it; then attempt a valid `chore` commit with no ticket ref, confirm it succeeds — 15min — depends on T12 — Scenario: S8, S9, S10 — Files: none — **SKIPPED per explicit user choice** (git-touching step deferred)

## Notes

- No task exceeds 45 minutes — no `[SUBAGENT]` tags needed for this ticket.
- Phases 0–7 produce files; Phase 8 is verification-only and must run last, after every prior phase completes, since it exercises the whole toolchain end-to-end.
- Within a phase, `[PARALLEL]`-tagged tasks have no dependency on their siblings and can be done in any order or concurrently; untagged tasks within the same phase have an explicit `depends on` note.
