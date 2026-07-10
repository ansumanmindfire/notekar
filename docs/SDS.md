# Software Design Specification

## Note Taking Application

**Version:** 1.0 | **Status:** Drafted | **Date:** July 2026
**Companion to:** `FRS.md`

This document defines the technical design, architecture, and implementation details for the Note Taking Application. It details exactly *how* the system will satisfy the business requirements defined in `FRS.md`.

---

## 1. Architecture Overview

```
pnpm monorepo
├── apps/
│   ├── api/            Express 5 + TS backend
│   └── web/             React 19 + Vite frontend
├── packages/
│   └── shared/          Zod schemas, TS types, constants — single source of truth
├── docs/                FRS.md, SDS.md, decisions/
├── openspec/             specs/, changes/, archive/, project.md
├── docker-compose.yml    Local PostgreSQL 16 provisioning (see §2)
└── .claude/              commands/, agents/, settings.json
```

**Backend layering:** `routes/` → `controllers/` → `services/` → Prisma. No layer skips.

```
apps/api/src/
  routes/       notes.router.ts, tags.router.ts, search.router.ts, shares.router.ts, versions.router.ts, auth/
  controllers/  notes.controller.ts, tags.controller.ts, search.controller.ts, shares.controller.ts, versions.controller.ts
  services/     notes.service.ts, tags.service.ts, search.service.ts, shares.service.ts, versions.service.ts, auth.service.ts
  middleware/   auth.ts, cors.ts, helmet.ts, bodyLimit.ts, errorHandler.ts, rateLimit.ts
  lib/          prisma.ts, jwt.ts, cookie.ts, cron.ts
  jobs/         purgeVersions.ts, purgeNotes.ts
```

**Frontend structure:**

```
apps/web/src/
  routes/       /login, /register, /forgot-password, /notes, /notes/:id, /notes/new, /notes/trash, /search
  components/   NoteCard, NoteEditor, TagChip, ShareModal, VersionDrawer, TrashList, ...
  stores/       authStore, notesViewStore, editorStatusStore, draftStore
  lib/          apiClient.ts (fetch wrapper, attaches accessToken + refresh-on-401), errorMessages.ts
  e2e/          journey.spec.ts (Playwright)
```

---

## 2. Local Database Provisioning (Docker)

Every developer runs PostgreSQL locally via Docker Compose — nobody installs Postgres natively. This keeps the "clone repo, everything works" promise from the team workflow doc actually true.

### 2.1 `docker-compose.yml` (repo root)

- Single service: `postgres`, image pinned to an **exact patch version** — e.g. `postgres:16.4` — never `postgres:16` or `postgres:latest`.
  > ⚠️ At the time AB-1001 is actually implemented, verify the current stable 16.x patch release and use that exact tag — do not carry forward a stale version number from this document without checking.
- Port mapping: host `5432` → container `5432` (adjustable via `.env` if 5432 is already in use locally).
- Named volume (`pgdata`) for data persistence across `docker compose down` — data is only wiped by an explicit `docker compose down -v`.
- `environment`: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` — values must exactly match the `DATABASE_URL` in `.env.example` (see §15), or first-run setup silently fails.
- `healthcheck`: `pg_isready`, so commands that depend on the database (`prisma migrate dev`, `pnpm dev`, `pnpm test`) never race against a container that hasn't finished starting.

### 2.2 Dev vs. Test Databases

Two logical databases run inside the same container:
- `notes_dev` — used by the running application during local development, pointed to by `DATABASE_URL`.
- `notes_test` — used exclusively by Supertest integration tests, pointed to by a separate `TEST_DATABASE_URL`. This isolation exists specifically so integration tests (see §14) can freely create, mutate, and truncate data without ever touching a developer's working dev data.

Both databases are created automatically on first container startup via an init script, or provisioned via `prisma migrate dev` / `prisma migrate deploy` run twice, once per connection string.

### 2.3 Root `package.json` Scripts

```
db:up      → docker compose up -d
db:down    → docker compose down
db:reset   → docker compose down -v && docker compose up -d && prisma migrate dev
```

### 2.4 Documented Startup Sequence

`pnpm db:up` → wait for the healthcheck to report healthy → `pnpm --filter api exec prisma migrate dev` → `pnpm dev`. This exact sequence is documented in the root `README.md` per FR-INFRA-8.

### 2.5 Explicitly Out of Scope

- No Adminer, pgAdmin, or other DB-inspection UI is included in `docker-compose.yml` — kept minimal. Developers who want one can add it locally without it being part of the shared project config.
- No CI-hosted database (e.g. a GitHub Actions `services:` Postgres container) is configured, since CI itself is out of scope for this project (see FRS §11, Non-Functional Requirements).

---

## 3. Database Schema (Prisma)

```prisma
// apps/api/prisma/schema.prisma
// Rationale: API owns migrations and the Prisma client. Generated types +
// Zod schemas are re-exported from packages/shared via a thin wrapper.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id            String    @id @default(cuid())
  email         String    @unique
  passwordHash  String
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  refreshTokens RefreshToken[]
  otps          PasswordResetOtp[]
  notes         Note[]
  tags          Tag[]
}

model RefreshToken {
  id         String    @id @default(cuid())
  userId     String
  token      String    @unique   // opaque 64-char, stored hashed (sha256) at rest
  expiresAt  DateTime
  revokedAt  DateTime?
  familyId   String              // groups rotated tokens; reuse revokes whole family
  createdAt  DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([familyId])
}

model PasswordResetOtp {
  id            String    @id @default(cuid())
  userId        String
  otpHash       String              // bcrypt hash of the 6-digit code, not plaintext
  expiresAt     DateTime
  attemptsLeft  Int       @default(5)
  invalidated   Boolean   @default(false)
  createdAt     DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
}

model Note {
  id          String    @id @default(cuid())
  userId      String
  title       String
  body        Json                // TipTap JSON document
  bodyText    String    @default("") // plain-text extraction, kept in sync via Prisma middleware
  version     Int       @default(1)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  deletedAt   DateTime?

  user     User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  tags     NoteTag[]
  versions NoteVersion[]
  shares   ShareLink[]

  @@index([userId, deletedAt])
  @@index([userId, createdAt])
  @@index([userId, updatedAt])
}

// tsvector column + GIN index added via raw SQL migration (Prisma doesn't model tsvector natively):
//   ALTER TABLE "Note" ADD COLUMN "searchVector" tsvector
//     GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || coalesce("bodyText",''))) STORED;
//   CREATE INDEX note_search_idx ON "Note" USING GIN ("searchVector");

model Tag {
  id     String @id @default(cuid())
  userId String
  name   String
  color  String              // one of a fixed preset palette (e.g. "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "pink" | "gray"), validated at app layer against an enum — not a free hex input

  user  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  notes NoteTag[]

  @@index([userId])
}
// Case-insensitive uniqueness added via raw SQL migration:
//   CREATE UNIQUE INDEX tag_user_name_ci_idx ON "Tag" (userId, lower(name));
// Note: NoteVersion intentionally does NOT store tagIds — see §10 for rationale.

model NoteTag {
  noteId String
  tagId  String

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@id([noteId, tagId])
  @@index([tagId])
}

model ShareLink {
  id         String    @id @default(cuid())
  noteId     String
  token      String    @unique   // 32-char URL-safe
  expiresAt  DateTime
  revokedAt  DateTime?
  viewCount  Int       @default(0)
  createdAt  DateTime  @default(now())

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId])
}

model NoteVersion {
  id       String   @id @default(cuid())
  noteId   String
  version  Int
  title    String
  body     Json
  savedAt  DateTime @default(now())

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId, version])
  @@index([savedAt])   // supports FR-VER-3 purge job
}
```

---

## 4. API Contracts Summary

All endpoints under `/notes`, `/tags`, `/search`, `/notes/:id/shares`, `/notes/:id/versions` require `Authorization: Bearer <accessToken>`.

### Common Envelopes
**Pagination Response:**
```ts
type Page<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};
```
**Standard Error Response:**
```ts
type ApiError = {
  code: string;       // e.g. "AUTH_INVALID_CREDENTIALS"
  message: string;
  fields?: string[];  // present for VALIDATION_FAILED
};
```

### Endpoints
- `POST /auth/register`: `{ email, password }` → `201 { id, email, createdAt }`. Password validated 8–72 chars.
- `POST /auth/login`: `{ email, password }` → `200 { accessToken, user }`. Sets `refreshToken` httpOnly cookie.
- `POST /auth/refresh`: expects cookie → `200 { accessToken }`. Rotates refresh cookie. Rate-limited 20/min/IP.
- `POST /auth/logout`: expects valid token → `204`. Clears refresh token. Rate-limited 20/min/IP.
- `POST /auth/forgot-password`: `{ email }` → `200 { message }`. Logs OTP to console.
- `POST /auth/reset-password`: `{ email, otp, newPassword }` → `204`.
- `POST /notes`: `{ title, body, tagIds? }` → `201 { id, title, body, tagIds, createdAt, updatedAt, version: 1 }`
- `GET /notes/:id`: → `200 Note`. Returns 404 if not found or soft-deleted.
- `PATCH /notes/:id`: → `200 Note`. Snapshots version before update.
- `DELETE /notes/:id`: → `204`. Sets `deletedAt` (soft delete).
- `GET /notes`: `?page=1&pageSize=10&sort=createdAt:desc&tagIds=t1,t2` → `200 Page<Note>`. When multiple `tagIds` are given, matching uses **AND semantics** — a note must carry every listed tag to be included (per FR-NOTE-6).
- `GET /notes/trash`: `?page=1&pageSize=10` → `200 Page<Note>`. Returns only the current user's soft-deleted notes, newest-deleted first.
- `POST /notes/:id/restore`: → `200 Note`. Clears `deletedAt`; 404 if note doesn't exist, isn't owned by the requester, or was already purged.
- `POST /tags`: `{ name, color }` → `201 Tag`.
- `PATCH /tags/:id`: `{ name, color }` → `200 Tag`.
- `DELETE /tags/:id`: → `204`. Cascades to NoteTag.
- `GET /tags`: `?page=1&pageSize=20` → `200 Page<{ id, name, color, noteCount }>`. Uses single SQL query to prevent N+1.
- `GET /search`: `?q=<query>&page=1&pageSize=10` → `200 Page<{ note, headline }>`. Uses Postgres `plainto_tsquery` and `ts_headline`.
- `POST /notes/:id/shares`: `{ expiresAt? }` → `201 { token, shareUrl, expiresAt, viewCount }`. If `expiresAt` is omitted, defaults to 7 days from creation. Accepted range is 1–30 days from creation; a value outside that range is rejected with `400 VALIDATION_FAILED` (per FR-SHARE-1).
- `DELETE /notes/:id/shares/:token`: → `204`. Revokes link.
- `GET /public/shares/:token`: (Unauthenticated) → `200 { title, body, viewCount, sharedAt }`. Atomically increments view count.
- `GET /notes/:id/shares`: → `200 [{ id, token, shareUrl, expiresAt, revokedAt, viewCount, createdAt }]`.
- `GET /notes/:id/versions`: → `200 [{ id, version, savedAt, title }]` (no body). Includes soft-deleted notes.
- `GET /notes/:id/versions/:versionId`: → `200 NoteVersion` (includes body).
- `POST /notes/:id/versions/:versionId/restore`: → `200 Note`. Snapshots current state before restoring; does not modify the note's current tag associations (see §10).

---

## 5. Security & Middleware Architecture

**Middleware Registration Order (`apps/api/src/app.ts`):**

1. **Security Headers (Helmet & CSP)**
   - Content-Security-Policy restricts `script-src`, `style-src`, and `img-src` to `'self'`. `style-src` allows `'unsafe-inline'` for TipTap styles.
   - Sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` (in prod).
2. **CORS**
   - Explicit origin allowlist using `process.env.WEB_ORIGIN`. No wildcards.
   - `credentials: true` required for cross-origin cookie transport.
3. **Body Parsing & Size Limits**
   - `app.use('/api/notes', express.json({ limit: '1mb' }))` to handle large TipTap JSON documents.
   - `app.use(express.json({ limit: '10kb' }))` for all other routes to prevent DoS.
4. **Cookie Parsing**
   - Refresh-token cookies use `httpOnly: true`, `SameSite: Strict`, `Secure: process.env.NODE_ENV !== 'development'`, `Path: /auth`.
5. **Rate Limiting (Per Route)**
   - See §17 Performance & Limits.
6. **Routes**
7. **Error Handler**

### XSS Sanitization
- Every render of note body content (editor, search highlights, public share view, version preview) MUST pass through DOMPurify configured to allow only safe TipTap-rendered HTML tags.
- `dangerouslySetInnerHTML` MUST NEVER receive unsanitized content.

---

## 6. Error Handling Strategy

Errors flow upward through the architecture and are caught by the Global Error Handler registered last.
- `AppError` → Returns its specific `code` and `statusCode`.
- `ZodError` → Returns `400 VALIDATION_FAILED` with extracted `fields[]`.
- `Prisma P2002` (Unique constraint) → Maps to `409` (e.g., `USER_EXISTS`, `TAG_NAME_DUPLICATE`).
- `Prisma P2025` (Not found) → Maps to `404`.
- All other errors → Return `500 INTERNAL_ERROR`. Stack traces are logged server-side and never leaked to the client.

### Error Code Registry (`packages/shared/src/errorCodes.ts`)

| Code | HTTP | Cause |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Zod validation failure |
| `AUTH_INVALID_CREDENTIALS` | 401 | Incorrect email or password |
| `AUTH_TOKEN_INVALID` | 401 | Missing or invalid access token |
| `AUTH_REFRESH_INVALID` | 401 | Missing, expired, or revoked refresh token |
| `AUTH_OTP_INVALID` | 401 | Incorrect or expired OTP |
| `USER_EXISTS` | 409 | Email already registered |
| `NOTE_NOT_FOUND` | 404 | Note missing, unowned, or soft-deleted (also used when restore target no longer exists) |
| `TAG_NOT_FOUND` | 404 | Tag missing or unowned |
| `TAG_NAME_DUPLICATE` | 409 | Duplicate tag name (case-insensitive) |
| `INVALID_TAG` | 422 | Attempted to use unowned tag |
| `SHARE_NOT_FOUND` | 404 | Share link missing |
| `GONE_LINK_INVALID` | 410 | Share link revoked, expired, or note deleted |
| `VERSION_NOT_FOUND` | 404 | Note version missing |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

## 7. API Versioning Strategy

This application does **not** implement URL-based API versioning (e.g., `/v1/`) in the initial release. Breakages are caught at compile time by the shared Zod schema package between frontend and backend. If public API access is later required, URL-prefix versioning will be adopted.

---

## 8. Auth Flow & Cryptography

- **Passwords:** Hashed using `bcrypt` with `12` rounds. Input length validated at 8–72 characters at the application layer before hashing — 72 chars is bcrypt's own hard input limit, so this cap prevents silent truncation rather than being an arbitrary choice.
- **Access Tokens:** Signed via HS256 JWT using `JWT_SECRET` (env variable ≥ 32 chars). TTL: 15 minutes. Contains only `{ sub: userId, iat, exp }`.
- **Refresh Tokens:** Opaque 64-character strings. Stored hashed (SHA-256) in the database. TTL: 7 days.
- **OTP Generation:** 6-digit string, hashed with `bcrypt` in the database, valid for 15 minutes. 5 verification attempts allowed.
- **Stolen Token Detection:** When a rotated (old) refresh token is used, the system detects it via `revokedAt IS NOT NULL` and instantly revokes all tokens sharing the same `familyId`, terminating the session lineage.
- **Logout:** Idempotently revokes the specific refresh token.
- **Password Reset:** Revokes *all* active refresh tokens for the user upon successful reset.

---

## 9. Search Implementation

1. `Note.body` (TipTap JSON) is flattened to plain text (`bodyText`) via a Prisma middleware on every create/update.
2. Postgres generated column `searchVector` (`tsvector`) is computed automatically from `title` + `bodyText`, backed by a GIN index.
3. Query path uses `plainto_tsquery('english', :q)` against `searchVector` and `ts_headline` to wrap matched snippets in `<mark>` tags.

---

## 10. Version Atomicity & Restore Semantics

Both "save" and "restore" operations wrap the snapshot creation and mutation inside a single `prisma.$transaction`. Restore snapshots the *current* state as a new version before applying the selected historical version's content, ensuring no work is ever destructively overwritten.

**Tag scope of restore:** `NoteVersion` stores only `title` and `body` — it does **not** store `tagIds`. This is a confirmed design decision: a note's tag associations are treated as current-state metadata belonging to the `Note`/`NoteTag` tables, not as part of its historical content. Restoring an old version therefore only ever reverts title/body; the note's tags are untouched by any restore action, regardless of what tags were attached at the time that version was originally saved.

---

## 11. Sharing Atomicity

View-count increment is a single raw SQL statement to avoid read-then-write races under concurrent access:

```sql
UPDATE "ShareLink" sl
SET "viewCount" = sl."viewCount" + 1
FROM "Note" n
WHERE sl.token = $1
  AND sl."revokedAt" IS NULL
  AND sl."expiresAt" > now()
  AND sl."noteId" = n.id
  AND n."deletedAt" IS NULL
RETURNING sl.*;
```

If no row is returned, the service layer throws `410 GONE_LINK_INVALID`.

---

## 12. Frontend State Management

| Concern | Tool | Notes |
|---|---|---|
| Access token | Zustand `authStore` | In-memory only, never `localStorage` (security requirement) |
| Refresh token | httpOnly cookie | Frontend never reads it; browser sends automatically |
| Server data | TanStack Query | Query keys include page/sort/filter for cache invalidation |
| View preferences | Zustand `notesViewStore` | Persists across navigation |
| Editor status | Zustand `editorStatusStore` | Tracks Saving / Saved / Failed states. Autosave triggers 2 seconds after the last keystroke (debounced). On save failure, one automatic retry is attempted; if that also fails, the user is notified and the draft is preserved locally (per FR-UI-2). |
| Draft backup | Zustand `draftStore` | Keyed by noteId, cleared on successful save |

---

## 13. Monorepo & Tooling Setup

- **Monorepo Manager:** `pnpm workspaces`
- **Local Database:** Docker Compose, per §2 — no native Postgres installation required by any developer.
- **Linting & Formatting:** ESLint and Prettier shared across all packages.
- **Git Hooks:** `husky` configured to run `pnpm typecheck && pnpm lint --max-warnings 0 && pnpm test --run` on pre-commit.
- **Commit Standards:** `commitlint` enforces conventional commits (`feat`/`fix` must include `AB#` reference).
- **Package structure:** `apps/api` (Express), `apps/web` (React/Vite), `packages/shared` (Zod schemas).
- **Dependency Management:** All tool versions are explicitly pinned in `package.json`. No ranges (`^`, `~`).
- **OpenSpec:** Initialized at `/openspec` for managing ticket-specific decisions.
- **AI Workflow Scaffolding:** `.claude/commands/` (slash commands), `.claude/agents/` (`reviewer` — read-only; `tester` — test paths only), `.claude/settings.json` (Context7 MCP configured for live library-doc verification during implementation).
- **Continuous Integration:** Not configured. Explicitly out of scope for this project — see FRS §11.

---

## 14. Testing Strategy

Two-tier approach, matching the split between the dev and test databases in §2.2:

- **Unit tests** (`Vitest`): Prisma client is mocked. Used for pure business-logic functions, validators, and service-layer logic that doesn't depend on actual database behavior.
- **Integration tests** (`Vitest` + `Supertest`, `apps/api/**/*.test.ts`): Run against the **real** `notes_test` database via `TEST_DATABASE_URL` — never mocked. This tier exists specifically to verify behavior that only a real Postgres instance can confirm:
  - Atomic view-count increments (FR-SHARE-3) — verifies actual row-level locking under concurrent requests, which a mock cannot meaningfully simulate.
  - Full-text search correctness (FR-SEARCH-1/2) — verifies the `tsvector`/GIN index and `ts_headline` raw-SQL migration actually work, not just that a mock returns what it's told to.
  - Case-insensitive tag uniqueness (FR-TAG-1) — enforced by a Postgres functional unique index, not application code; only a real constraint violation proves this works.
  - Transactional atomicity of version snapshot + update, and of restore (§10) — the transaction itself is what's under test.
  - Test database is truncated between test files to keep runs isolated and repeatable.
- **Frontend component tests** (`Vitest` + `Testing Library`, `apps/web/**/*.test.tsx`).
- **E2E** (`Playwright`, `apps/web/e2e/*.spec.ts`).
- **Coverage Gate:** ≥ 80% coverage on all new code, enforced locally via the Husky pre-commit hook (no CI enforcement — see §13).

---

## 15. Environment Configuration

Variables managed in `.env` (never committed). An `.env.example` must be kept updated.
Required variables without defaults will cause the application to crash on startup if missing.

| Variable | Required | Used By | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | Prisma (dev) | `postgresql://user:pass@localhost:5432/notes_dev` |
| `TEST_DATABASE_URL` | Yes (test runs only) | Prisma (Supertest integration tests) | `postgresql://user:pass@localhost:5432/notes_test` |
| `JWT_SECRET` | Yes | Auth (HS256) | `(random ≥32 chars)` |
| `WEB_ORIGIN` | Yes | CORS | `http://localhost:5173` |
| `NODE_ENV` | No | Server | `development` / `production` |
| `PORT` | No | Server | `3001` |
| `BCRYPT_ROUNDS` | No | Auth | `12` |
| `PURGE_CRON_SCHEDULE`| No | CRON | `0 3 * * *` |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Yes | Docker Compose | must match the values embedded in `DATABASE_URL` |

---

## 16. Logging Strategy

- **Implementation:** `pino` structured JSON logger singleton.
- **Request Logging:** `pino-http` middleware.
- **Security:** `password`, `token`, `otp`, `authorization`, and `cookie` keys are explicitly redacted. Passwords and active tokens are never logged.
- **OTP Exception:** For development purposes, generated OTPs are logged via `console.info` with an `[OTP]` prefix as real emails are not sent.

---

## 17. Performance & Limits

**Database**
- Prisma connection pooling managed via `DATABASE_URL`.
- Search query leverages GIN indexing.
- Tag counting leverages single-query aggregation (no N+1).

**API Rate Limiting**
- Registration: 3 requests / hour / IP
- Login: 5 requests / min / IP
- Token Refresh: 20 requests / min / IP
- Logout: 20 requests / min / IP
- Forgot Password: 3 requests / hour / Email
- Public Share Access: 60 requests / min / IP / Token

---

## 18. Data Migration Strategy

- **Prisma Migrations:** `npx prisma migrate dev` generates timestamped, forward-only SQL migrations.
- **Raw SQL Dependencies:** Features requiring capabilities beyond Prisma's DSL (such as `tsvector` generated columns for search and `case-insensitive` functional indexes for tags) are implemented via `--create-only` raw SQL migrations.
- **Soft Deletion Safety:** Migrations must never add `CASCADE DELETE` constraints that bypass the application-layer soft-delete rules for Notes.
- **Historical Data Purge:** Two independent scheduled Cron jobs perform the only physical deletions in the system:
  - `purgeVersions.ts` deletes `NoteVersion` rows older than 90 days (FR-VER-3).
  - `purgeNotes.ts` permanently deletes `Note` rows (and their cascading `NoteTag`, `NoteVersion`, `ShareLink` rows) where `deletedAt` is more than 30 days in the past — this is what makes a soft-deleted note actually unrestorable once its recovery window has elapsed (FR-NOTE-8). Both jobs run on the same daily schedule (`PURGE_CRON_SCHEDULE`), logging the count of rows purged by each.
- **Dual-Database Migrations:** Every migration is applied to both `notes_dev` (`DATABASE_URL`) and `notes_test` (`TEST_DATABASE_URL`) — same migration files, run twice against the two connection strings, per §2.2.