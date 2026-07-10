# AGENTS.md

Single source of truth and primary context file for all AI agents working on this repository. Full detail lives in `docs/FRS.md` (business requirements) and `docs/SDS.md` (technical design) — this file is the condensed operating manual.

## 1. Project Overview

A Note Taking Application supporting full note CRUD with soft delete/restore/trash, tags, full-text search with highlighting, public share links with expiry/revoke/view-counts, and version history with restore and auto-purge. It includes a complete frontend for all of the above plus one end-to-end user journey (register → login → create/tag/share/version/delete/restore → logout).

## 2. Repository Structure

```text
pnpm monorepo/
├── apps/
│   ├── api/                   # Express 5 + TS backend
│   │   └── src/
│   │       ├── routes/        # Express routers (wiring only)
│   │       ├── controllers/   # Request/response validation
│   │       ├── services/      # Business logic + Prisma calls
│   │       ├── middleware/    # auth, cors, rateLimit, errorHandler
│   │       ├── lib/           # prisma singleton, jwt utils
│   │       └── jobs/          # purge cron jobs
│   └── web/                   # React 19 + Vite frontend
│       ├── src/
│       │   ├── routes/        # Route-level pages (/login, /notes)
│       │   ├── components/    # NoteCard, NoteEditor, ShareModal
│       │   ├── stores/        # Zustand (authStore, notesViewStore)
│       │   └── lib/           # apiClient.ts (intercepts 401s)
│       └── e2e/               # Playwright journey tests
├── packages/
│   └── shared/                # Single Source of Truth
│       └── src/
│           ├── schemas.ts     # Zod validation schemas
│           ├── types.ts       # Shared TS interfaces (e.g., Page<T>)
│           └── errorCodes.ts  # Centralized error code registry
├── docs/                      # FRS.md, SDS.md, decisions/
├── openspec/                  # specs/, changes/, archive/, project.md
├── docker-compose.yml         # Local Postgres 16 provisioning
└── .claude/                   # agents/ (reviewer), commands/ (/spec)
```

## 3. Tech Stack

- **Backend:** Node.js 22, Express 5, TypeScript (strict), Prisma ORM
- **Frontend:** React 19, Vite, Zustand, TanStack Query
- **Database:** PostgreSQL 16 (exact patch pin, e.g. `postgres:16.4` — never `:latest` or unpinned major/minor), via Docker Compose
- **Auth/crypto:** JWT (HS256, `jsonwebtoken`), `bcrypt` (12 rounds)
- **Rich text:** TipTap (JSON document storage), DOMPurify for sanitized rendering
- **Logging:** `pino` + `pino-http`, structured JSON, sensitive keys redacted
- **Testing:** Vitest (unit + integration via Supertest), Playwright (E2E), Testing Library (frontend components)
- **Tooling:** pnpm workspaces, ESLint + Prettier (root-shared config), Husky + commitlint
- **Dependency policy:** every `package.json` dependency pinned to an exact version — no `^`, `~`, `@latest`

## 4. Key Commands

```
pnpm install                                   # install all workspace packages
pnpm db:up                                     # docker compose up -d (Postgres 16)
pnpm db:down                                   # docker compose down
pnpm db:reset                                  # down -v && up -d && prisma migrate dev (full wipe + remigrate)
pnpm --filter api exec prisma migrate dev      # run/create migrations (dev)
pnpm dev                                       # start API + web dev servers
```

**Mandatory quality gates** (must all pass before commit/PR — enforced locally via Husky pre-commit, no CI in this project):
```
pnpm build
pnpm lint --max-warnings 0
pnpm test
```

## 5. Architecture Patterns

Backend strictly layers as `routes/` → `controllers/` → `services/` → Prisma. **Layer skipping is forbidden** — routes never call services directly, controllers never touch Prisma directly. Middleware (`auth`, `cors`, `helmet`, `bodyLimit`, `errorHandler`, `rateLimit`) registers in a fixed order in `app.ts`: security headers → CORS → body parsing → cookie parsing → rate limiting → routes → error handler (last). Scheduled jobs (`purgeVersions.ts`, `purgeNotes.ts`) live in `lib/jobs` and run via cron, independent of the request path.

## 6. Coding Standards

- TypeScript strict mode everywhere; `any` is prohibited (implicit or explicit).
- Conventional commits; `feat`/`fix` commits **must** reference a ticket as `AB#xxxx`. `chore`/`docs` commits do not require a ticket ref.
- Deletions are soft deletes via a `deletedAt` timestamp column — never physical row deletion from application code. The only physical deletions in the system are the two scheduled purge jobs (versions >90 days, notes >30 days past `deletedAt`).
- Zero lint warnings permitted anywhere in the codebase.
- ≥80% automated test coverage required on new code.

## 7. Auth Approach

- **Access token:** JWT, HS256, signed with `JWT_SECRET` (≥32 chars). Payload is only `{ sub: userId, iat, exp }`. TTL **15 minutes**. Kept **in-memory only** on the frontend (Zustand `authStore`) — never persisted to `localStorage`.
- **Refresh token:** Opaque 64-char string, stored **hashed (SHA-256)** in the `RefreshToken` table. TTL **7 days**. Delivered via `httpOnly`, `SameSite=Strict`, `Secure` (non-dev) cookie scoped to `Path: /auth`. Frontend never reads it directly.
- **Rotation & reuse detection:** each refresh rotates the token within a `familyId`. Reuse of an already-rotated (revoked) token instantly revokes the entire token family for that lineage.
- **Logout:** idempotently revokes only the current device's refresh token; other devices remain logged in.
- **OTP (forgot password):** 6-digit code, bcrypt-hashed at rest, valid 15 minutes, max 5 verification attempts before invalidation. Password reset revokes **all** active refresh tokens for the user across all devices. Both existing and unknown emails receive an identical generic success response (anti-enumeration).

## 8. API Design Conventions

- **Pagination envelope**, used by every list endpoint:
  ```ts
  type Page<T> = { items: T[]; page: number; pageSize: number; totalItems: number; totalPages: number };
  ```
- **Error shape**, used by every error response:
  ```ts
  type ApiError = { code: string; message: string; fields?: string[] };
  ```
  Codes are centralized in `packages/shared/src/errorCodes.ts` (e.g. `VALIDATION_FAILED`, `AUTH_INVALID_CREDENTIALS`, `NOTE_NOT_FOUND`, `GONE_LINK_INVALID`, `RATE_LIMITED`).
- **No URL-prefix API versioning** (no `/v1/`) in this release — breaking changes are caught at compile time via the shared Zod schema package between frontend and backend instead. Revisit only if public third-party API access is later required.

## 9. DB Schema Summary

Core Prisma models: `User`, `RefreshToken`, `PasswordResetOtp`, `Note`, `Tag`, `NoteTag` (join table), `ShareLink`, `NoteVersion`.

- `Note.body` is TipTap JSON; `Note.bodyText` is a plain-text extraction kept in sync via Prisma middleware, feeding search.
- **Search is a raw SQL addition Prisma cannot model natively**: a generated `tsvector` column (`searchVector`) computed from `title` + `bodyText`, backed by a GIN index, added via a `--create-only` raw SQL migration. Query path uses `plainto_tsquery` + `ts_headline`.
- Tag name uniqueness (case-insensitive, per-user) is likewise a raw SQL functional unique index: `CREATE UNIQUE INDEX ... ON "Tag" (userId, lower(name))`.
- `NoteVersion` intentionally stores only `title`/`body`, never `tagIds` — tags are current-state metadata and are unaffected by version restore.
- Migrations must never add `CASCADE DELETE` that would bypass the application-layer soft-delete rule for `Note`.

## 10. Testing Approach

- **Dual-database setup:** `notes_dev` (via `DATABASE_URL`) is for the running dev app; `notes_test` (via `TEST_DATABASE_URL`) is used exclusively by Supertest integration tests, which truncate it between test files. Integration tests never touch dev data, and every migration is applied to both databases identically.
- **Unit tests** (Vitest): Prisma client mocked; pure business logic, validators, service-layer logic.
- **Integration tests** (Vitest + Supertest, `apps/api/**/*.test.ts`): run against the real `notes_test` database — used specifically where only real Postgres behavior proves correctness (atomic view-count increments, `tsvector`/GIN search, case-insensitive tag unique index, transactional version snapshot/restore).
- **Frontend component tests** (Vitest + Testing Library, `apps/web/**/*.test.tsx`).
- **E2E** (Playwright, `apps/web/e2e/*.spec.ts`) — at least one baseline smoke test, plus the full core-journey test for AB-1016.
- **Coverage gate:** ≥80% on all new code, enforced locally via the Husky pre-commit hook (no CI enforcement exists in this project).

## 11. Do NOT Do

- Do **not** duplicate types or Zod schemas between `apps/api` and `apps/web` — import from `packages/shared` only.
- Do **not** store the access token in `localStorage` (or any persistent client storage) — in-memory only.
- Do **not** write raw SQL for basic CRUD — use Prisma. Raw SQL is reserved for the two documented exceptions Prisma's DSL can't express (`tsvector` generated column, case-insensitive tag unique index) and the atomic view-count increment.
- Do **not** render any note/user-generated rich-text content (editor, search highlights, public share view, version preview) without passing it through DOMPurify first — never let `dangerouslySetInnerHTML` receive unsanitized content.
- Do **not** physically delete `Note` or `NoteVersion` rows from application code — only the two scheduled purge jobs perform physical deletes.
- Do **not** use unpinned or range dependency versions, or `postgres:latest`/unpinned Postgres tags.
- Do **not** skip backend layers (route calling a service directly, controller touching Prisma directly).

## 12. Shared Packages

`packages/shared` is the contract source of truth between `apps/api` and `apps/web`: it holds all Zod validation schemas, the TypeScript types derived from them (including `Page<T>` and `ApiError`), and shared constants such as the error code registry (`errorCodes.ts`) and the fixed tag color palette. Because both frontend and backend import from this single package instead of maintaining parallel definitions, contract drift between client and server becomes a compile-time TypeScript error rather than a runtime bug — this is also the stated reason the project forgoes URL-based API versioning (§8).

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
