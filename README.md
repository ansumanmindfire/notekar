# NoteApp

A note-taking application with full CRUD, soft delete/trash, tags, full-text search, public share links, and version history.

## Stack

- **Backend:** Node.js 22, Express 5, TypeScript (strict), Prisma ORM
- **Frontend:** React 19, Vite, Zustand, TanStack Query
- **Database:** PostgreSQL 16, via Docker Compose
- **Monorepo:** pnpm workspaces (`apps/api`, `apps/web`, `packages/shared`)

## Prerequisites

- Node.js `22.22.0` (see `.nvmrc`) — no other version is supported
- pnpm, via [Corepack](https://nodejs.org/api/corepack.html) (`corepack enable` if you haven't already — the exact version is pinned via `packageManager` in `package.json`)
- Docker Desktop (or an equivalent Docker Engine + Compose install) — no native PostgreSQL install is required or supported

## Setup

1. **Install dependencies**

   ```sh
   pnpm install
   ```

2. **Start the local database**

   ```sh
   pnpm db:up
   ```

   This starts a single `postgres:16.14` container via Docker Compose, provisioning both `notes_dev` (the app's dev database) and `notes_test` (used exclusively by integration tests). Wait for the container to report healthy before continuing — `docker compose ps` should show `(healthy)`.

3. **Configure environment variables**

   ```sh
   cp .env.example .env
   ```

   Fill in `.env` with real values — at minimum, replace `JWT_SECRET` with a random string of at least 32 characters. The `POSTGRES_*` values must match whatever you use for `DATABASE_URL`/`TEST_DATABASE_URL` (the defaults in `.env.example` already agree with each other).

4. **Run database migrations**

   ```sh
   pnpm --filter api run prisma:migrate
   ```

   (Wraps `prisma migrate dev` with `dotenv-cli` so it reads the root `.env` — Prisma's own env-file auto-detection only looks in its own project directory, not the monorepo root.)

5. **Start the dev servers**

   ```sh
   pnpm dev
   ```

   This starts both the API (`apps/api`, default port `3001`) and the web app (`apps/web`, default port `5173`) in parallel.

6. **Run tests**

   ```sh
   pnpm test
   ```

   Runs the full Vitest suite (unit tests across `apps/api`/`apps/web`, plus the root-level dependency-pinning check). For the Playwright end-to-end suite:

   ```sh
   pnpm --filter web exec playwright test
   ```

## Everyday Commands

| Command | Description |
|---|---|
| `pnpm dev` | Start API + web dev servers |
| `pnpm build` | Build all packages |
| `pnpm lint --max-warnings 0` | Lint the entire workspace with zero warnings enforced (the same gate Husky's pre-commit hook runs) |
| `pnpm typecheck` | Type-check every package |
| `pnpm test` | Run the Vitest suite |
| `pnpm db:up` | Start the local Postgres container |
| `pnpm db:down` | Stop the local Postgres container (data persists) |
| `pnpm db:reset` | Wipe all local data, recreate the container, and re-run migrations |

## Testing Notes

- **Unit tests** (`apps/api`, `apps/web`): Vitest, Prisma mocked where relevant. Run via `pnpm test`.
- **Integration tests** (`apps/api/**/*.test.ts` that hit a real database): connect to `notes_test` via `TEST_DATABASE_URL`, never `notes_dev`. The test database is truncated between test files.
- **E2E** (`apps/web/e2e/*.spec.ts`): Playwright, run against a real dev server.
- There is no CI pipeline in this project — all quality gates (typecheck, lint, test) run locally via a Husky pre-commit hook.

## Project Structure

See `AGENTS.md` for the full repository layout, architecture patterns, and coding standards. `docs/FRS.md` and `docs/SDS.md` contain the business requirements and technical design respectively.
