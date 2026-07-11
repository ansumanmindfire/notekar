---
ticket: AB-1001
type: INFRA
status: APPROVED
---

# AB-1001: Technical Foundation & Tooling Setup

## Overview

Establishes the technical foundation for the Note Taking Application before any feature work begins: a pnpm monorepo (`apps/api`, `apps/web`, `packages/shared`), a Dockerized local PostgreSQL 16 instance (dev + test databases), TypeScript-strict tooling across all packages, the shared lint/format/git-hook/commit-convention setup, environment variable handling with fail-fast validation, dependency version pinning policy, root documentation, and the OpenSpec + Claude Code AI workflow scaffolding (`.claude/agents`, `.claude/commands`, Context7 MCP). No feature/business logic is implemented in this ticket — it is pure infrastructure.

## Goals

- Single pnpm workspace containing `apps/api`, `apps/web`, `packages/shared`, each running TypeScript in strict mode with `any` prohibited (implicit and explicit).
- `packages/shared` scaffolded as the single source of truth for Zod schemas, shared TS types, and constants (empty/minimal exports for now — populated starting AB-1002).
- Local PostgreSQL 16 provisioned via Docker Compose, pinned to an exact patch tag, with a healthcheck so dependent commands never race a not-yet-ready container.
- Two logical databases (`notes_dev`, `notes_test`) provisioned automatically via a Docker init script on first container startup.
- Root-shared ESLint (flat config) + Prettier config used by every package — zero lint warnings permitted.
- Husky pre-commit hook running typecheck + lint (`--max-warnings 0`) + test suite; commitlint enforcing conventional commits with mandatory `AB#xxxx` reference on `feat`/`fix` (not required on `chore`/`docs`).
- Vitest configured at the workspace root with per-package overrides for `apps/api` and `apps/web`; Playwright configured under `apps/web/e2e` with one passing baseline smoke test.
- `.env.example` committed listing every required variable with a placeholder; real `.env` gitignored; app fails fast at startup if a required variable is missing.
- Every `package.json` in every package pins dependencies to exact versions (no `^`, `~`, `@latest`).
- Root `README.md` documenting the full setup sequence: install → db up → env config → migrate → dev → test.
- OpenSpec initialized at repo root (`changes/`, `archive/` present — `specs/` created on first archive).
- `.claude/agents/reviewer` (read-only) and a test-writer/tester agent restricted to test paths confirmed present and correctly scoped; `.claude/commands/` confirmed present for `/start /spec /plan /tasks /implement /review /pr`.
- `.claude/settings.json` extended with a Context7 MCP server entry (unauthenticated free tier) so library API usage can be verified against live docs during implementation.

## Non-Goals

- No route/controller/service/business logic of any kind — that begins at AB-1002 (Core User & Auth Models).
- No Continuous Integration pipeline — explicitly out of scope for the whole project (FRS §1.2, §11). Quality gates are local-only (Husky + manual `/review`/`/pr`).
- No DB-inspection UI (Adminer/pgAdmin) in `docker-compose.yml`.
- No CI-hosted database container.
- No Context7 API key wiring in this ticket — the unauthenticated/free tier is configured now; an authenticated key can be added later by setting an env var, without a spec change.
- No production deployment configuration (Dockerfiles for prod, hosting, CD) — local dev only.

## FRs Covered

| FR | Coverage |
|---|---|
| FR-INFRA-1 | pnpm workspace w/ 3 packages, TS strict everywhere, `any` prohibited, `packages/shared` as single source of truth |
| FR-INFRA-2 | Docker Compose Postgres 16, pinned exact patch, healthcheck, `notes_dev`/`notes_test` split, persistent volume + full-reset command |
| FR-INFRA-3 | Vitest root config w/ per-package overrides; Playwright baseline smoke test under `apps/web/e2e` |
| FR-INFRA-4 | Husky pre-commit (typecheck+lint+test) blocks bad commits; commitlint enforces conventional commits + `AB#` on feat/fix |
| FR-INFRA-5 | Root-shared ESLint (flat config) + Prettier, zero-warning gate applied to every package |
| FR-INFRA-6 | `.env.example` committed, real `.env` gitignored, fail-fast startup validation on missing required vars |
| FR-INFRA-7 | Every dependency in every `package.json` exact-pinned |
| FR-INFRA-8 | Root `README.md` documents the complete fresh-clone-to-working-dev-env sequence |
| FR-INFRA-9 | OpenSpec scaffolding, `.claude/agents` (reviewer read-only, tester test-path-only), `.claude/commands`, Context7 MCP in `.claude/settings.json` |

## Tooling Decisions

- **Dual-DB provisioning**: a SQL init script (`docker/init-db.sh` or `.sql`, mounted via Postgres's `/docker-entrypoint-initdb.d/`) creates both `notes_dev` and `notes_test` databases on first container startup — chosen over running `prisma migrate dev` twice, so `pnpm db:up` alone leaves both databases ready for migration.
- **Postgres pin**: `postgres:16.14` — verified as the current latest 16.x patch release (per postgresql.org release notes, released with the coordinated 18.4/17.10/16.14/15.18/14.23 update cycle) as of 2026-07-10.
- **Context7 MCP**: configured unauthenticated (free tier) in `.claude/settings.json`. An `CONTEXT7_API_KEY` placeholder is reserved in `.env.example` (commented, not required) so a key can be wired in later without a spec/schema change.
- **ESLint style**: flat config (`eslint.config.js`, ESLint 10) at the repo root, shared by every package via project references — no legacy `.eslintrc.*` anywhere. `parserOptions.projectService` was deliberately omitted (not just unset) — only non-type-aware `recommended` rules are used, and `projectService` would require every linted file (including root-level tooling configs) to belong to a tsconfig's `include`, which they don't.
- **Node/pnpm pinning**: Node pinned to `22.22.0` (relaxed from an initially-researched `22.23.1` after `pnpm install` reported the actual available runtime as `22.22.0` — pinned to match the real reproducible environment rather than an untested newer patch) via root `package.json` `engines` field and a root `.nvmrc`; pnpm pinned via `packageManager` field in root `package.json` (Corepack-managed, no floating pnpm version).
- **Prisma version — downgraded from 7 to 6.19.3 during implementation**: Prisma 7 removed `datasource { url = env(...) }` support in `schema.prisma` entirely and requires a driver-adapter (`@prisma/adapter-pg`) for both CLI and runtime `PrismaClient` construction — a pattern SDS §3/§9/§18 and this spec's original "Prisma@7.8.0" pin did not anticipate. Downgraded to `prisma`/`@prisma/client@6.19.3` (the last version supporting the classic `datasource { url }` pattern) at the cheapest possible point — zero models existed yet. Revisit Prisma 7 adoption only as a deliberate, scoped decision in a later ticket, not as an incidental version bump.
- **Root `.env` loading — `dotenv-cli` added (not originally planned)**: neither the app runtime (`tsx watch`, no env-file loading) nor Prisma CLI (which only auto-loads `.env` from its own project directory, `apps/api/`, never the monorepo root) actually read the repo-root `.env`. Added `dotenv-cli@11.0.0` to `apps/api`, wrapping the `dev` script and a new `prisma:migrate` script with `dotenv -e ../../.env --`. Root `db:reset` and `AGENTS.md` §4 updated to call `pnpm --filter api run prisma:migrate` instead of invoking `prisma migrate dev` directly.
- **Vitest topology — `test.projects` in a root `vitest.config.ts`, not `vitest.workspace.ts`**: Vitest 4 removed the standalone workspace-file mechanism entirely (deprecated since 3.2, removed in 4.0 — confirmed via `--workspace` being an unrecognized CLI flag in v4.1.10). The originally-planned `vitest.workspace.ts` is replaced by a root `vitest.config.ts` with `test: { projects: ['apps/api/vitest.config.ts', 'apps/web/vitest.config.ts', { test: { name: 'root', include: ['scripts/**/*.test.ts'] } }] }`. `apps/web/vitest.config.ts` additionally hardened with an explicit `exclude: [...configDefaults.exclude, '**/e2e/**']` so Playwright spec files are never collected by Vitest.
- **Playwright config location — `apps/web/playwright.config.ts`, not `apps/web/e2e/playwright.config.ts`**: Playwright's auto-discovery only looks for its config at the package root; a config nested in `e2e/` is silently ignored, causing `baseURL` and all other settings to never apply. Moved to the conventional root location with `testDir: './e2e'`.
- **TypeScript declaration emission — removed from `tsconfig.base.json`**: `declaration`/`declarationMap: true` caused TS2883 errors in `apps/api` (inferred types transitively referencing un-imported types become unnameable in emitted `.d.ts`). Removed both flags — nothing in this monorepo needs emitted declarations: `packages/shared` is consumed via its `exports` map pointing directly at `.ts` source (read directly under `moduleResolution: "Bundler"`), and `apps/api`/`apps/web` are leaf applications never imported by anything else.

## File Layout

```text
NoteApp/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── routes/            (empty scaffold, populated AB-1002+)
│   │   │   ├── controllers/       (empty scaffold)
│   │   │   ├── services/          (empty scaffold)
│   │   │   ├── middleware/        (empty scaffold)
│   │   │   ├── lib/               (empty scaffold)
│   │   │   └── jobs/              (empty scaffold)
│   │   ├── prisma/                (schema.prisma placeholder — models added AB-1002+)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   └── web/
│       ├── src/
│       │   ├── routes/            (empty scaffold)
│       │   ├── components/        (empty scaffold)
│       │   ├── stores/            (empty scaffold)
│       │   └── lib/               (empty scaffold)
│       ├── e2e/
│       │   └── smoke.spec.ts      (baseline Playwright smoke test — passes against `pnpm dev`)
│       ├── package.json
│       ├── playwright.config.ts   (package root — Playwright's own auto-discovery location, not e2e/)
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── vitest.config.ts
│       └── vitest.setup.ts
├── packages/
│   └── shared/
│       ├── src/
│       │   ├── schemas.ts         (empty export placeholder)
│       │   ├── types.ts           (empty export placeholder, incl. Page<T> stub)
│       │   └── errorCodes.ts      (empty export placeholder)
│       ├── package.json
│       └── tsconfig.json
├── docker/
│   └── init-db.sh                 (creates notes_dev + notes_test on first container start)
├── docs/                          (existing: FRS.md, SDS.md)
├── openspec/
│   ├── project.md
│   ├── changes/
│   │   └── AB-1001-project-setup/
│   └── archive/
├── .claude/                       (existing: agents/, commands/, settings.json — extended, not recreated)
├── .husky/
│   └── pre-commit
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json                  (root: scripts, engines, packageManager)
├── tsconfig.base.json
├── eslint.config.js
├── .prettierrc
├── commitlint.config.js
├── vitest.config.ts               (root — Vitest 4 test.projects array; replaces the Vitest-3-era vitest.workspace.ts)
├── .nvmrc
├── .env.example
├── .gitignore                    (extended: node_modules, dist, .env, coverage, etc.)
└── README.md
```

## Configuration Files

| File | Purpose |
|---|---|
| `docker-compose.yml` | Single `postgres:16.14` service, port `5432:5432` (overridable via `.env`), named volume `pgdata`, `pg_isready` healthcheck, env vars matching `.env.example`, mounts `docker/init-db.sh`. |
| `docker/init-db.sh` | Runs on first container init; creates `notes_test` database (the default `POSTGRES_DB` covers `notes_dev`). |
| `pnpm-workspace.yaml` | Declares `apps/*` and `packages/*` as workspace packages. |
| Root `package.json` | `engines.node` pinned exact, `packageManager` pinned exact (pnpm via Corepack), scripts: `db:up`, `db:down`, `db:reset`, `dev`, `build`, `lint`, `test`. |
| `tsconfig.base.json` | Shared strict compiler options (`strict: true`, `noImplicitAny: true`, etc.) extended by each package's `tsconfig.json`. |
| `eslint.config.js` | Root flat config; TypeScript + React (web) + Node (api) rule sets; zero-warning enforced via `--max-warnings 0` in the lint script, not baked into the config itself. |
| `.prettierrc` | Shared formatting rules referenced by ESLint's Prettier integration. |
| `.husky/pre-commit` | Runs `pnpm typecheck && pnpm lint --max-warnings 0 && pnpm test --run`. |
| `commitlint.config.js` | Conventional-commits base config plus a custom rule requiring `AB#\d+` in the subject/body for `feat`/`fix` types only. |
| `vitest.config.ts` (root) | Vitest 4 `test.projects` array: `apps/api/vitest.config.ts` (node env, Prisma-mocked unit tests), `apps/web/vitest.config.ts` (jsdom env, Testing Library), and an inline `scripts/**/*.test.ts` project. |
| `apps/web/playwright.config.ts` | Points at the local dev server (`webServer` auto-starts `pnpm dev`); `testDir: './e2e'`; includes the one baseline smoke spec. |
| `.env.example` | Every var from SDS §15 (`DATABASE_URL`, `TEST_DATABASE_URL`, `JWT_SECRET`, `WEB_ORIGIN`, `NODE_ENV`, `PORT`, `BCRYPT_ROUNDS`, `PURGE_CRON_SCHEDULE`, `POSTGRES_USER`/`POSTGRES_PASSWORD`/`POSTGRES_DB`) plus a commented-out `CONTEXT7_API_KEY` placeholder. |
| `.gitignore` | Extended (on top of existing `code-review-graph` entry) with `node_modules/`, `dist/`, `.env`, `coverage/`, `.turbo/` (if used), editor artifacts. |
| `.claude/settings.json` | Existing hooks preserved; `mcpServers` (or equivalent Claude Code MCP config block) extended with an unauthenticated Context7 entry. |
| `README.md` | Documents: `pnpm install` → `pnpm db:up` (wait for healthy) → copy `.env.example` to `.env` → `pnpm --filter api exec prisma migrate dev` → `pnpm dev` → `pnpm test`. |

## Scenarios

| Scenario | Expected Outcome |
|---|---|
| Fresh clone, `pnpm install` run | All three packages install without error |
| A type/schema needed in both frontend and backend | Imported from `packages/shared`, never redefined locally |
| `pnpm db:up` run | Postgres container starts, reports healthy, both `notes_dev` and `notes_test` exist and are reachable |
| `pnpm db:reset` run | All data wiped, container recreated, migrations reapplied from scratch |
| `pnpm test` run (integration tier) | Connects only to `notes_test` via `TEST_DATABASE_URL`, never `notes_dev` |
| Fresh clone, `pnpm test` run | Test runner executes across all packages with no configuration errors |
| Fresh clone, Playwright smoke test run against running dev server | Smoke test passes |
| Commit attempted with a lint error present | Commit blocked by Husky pre-commit |
| Commit attempted with `feat` message lacking an `AB#` reference | Commit blocked by commitlint |
| Commit attempted with valid `chore`/`docs` message, no ticket ref | Commit succeeds |
| `pnpm lint` run from root | Runs against every package; any warning fails the command |
| `.env` copied from `.env.example` and filled in, fresh clone | Application starts successfully |
| A required env variable is missing at startup | Application exits immediately with a clear startup error, not a later runtime failure |
| Any `package.json` inspected | Every dependency has an exact, non-range version string |
| New developer follows `README.md` from fresh clone, no other guidance | Reaches a fully working local dev environment |
| `/start` run in a fresh clone | Confirms context loaded, ready for a ticket |
| `reviewer` agent invoked | Cannot write/edit any file; read + report only |
| A library API used during later implementation tickets | Verified against Context7 live docs rather than training-data assumptions |

## Dependencies

None. Per FRS §13 (Ticket Dependency Map), AB-1001 has no prerequisite ticket — it is the root of the dependency graph; every other ticket depends on it either directly or transitively.

## Open Questions

None outstanding. All four decisions raised during spec drafting have been resolved and are recorded under **Tooling Decisions**:
1. Dual-DB provisioning → Docker init script.
2. Context7 MCP → unauthenticated free tier now, key upgrade path reserved.
3. ESLint style → flat config.
4. Postgres pin → `16.14` (verified 2026-07-10).
