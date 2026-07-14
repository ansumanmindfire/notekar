---
ticket: AB-1016
type: E2E
status: APPROVED
---

# AB-1016: Core User Journey E2E Test

## Overview
Builds the single Playwright spec (`apps/web/e2e/journey.spec.ts`) that drives the complete core user journey from FR-E2E-1 — register → login → create/autosave/tag/share/revoke/restore-version/delete/restore-from-trash → logout — through a real browser against a real running API and a real (disposable) Postgres database. No mocking: this ticket's entire value is proving the already-built frontend (AB-1010–AB-1015) and backend (AB-1002–AB-1009) work together end-to-end.

This is an **E2E ticket type**, which the `/spec` skill's ticket-type table does not define a section template for (only INFRA/BACKEND/FRONTEND are enumerated). The template used here is a custom adaptation — swapping FRONTEND's "Pages/Components" for "Journey Steps" and adding "Test Environment & Setup" and "Test Data & Isolation" sections specific to what an E2E ticket actually needs decided. Flag on review if a different shape is preferred.

Two environment decisions were resolved with the user before drafting (see Test Environment & Setup): the journey runs against `notes_test` (not `notes_dev`), and registration/login rate limits are bypassed via a test-only env-gated flag rather than relying on unique-email-per-run alone.

## Goals
- One Playwright spec, `apps/web/e2e/journey.spec.ts`, exercising the full FR-E2E-1 journey as a single serial test (using `test.step()` for each named step so failures point at the exact step).
- A dedicated, isolated local environment for the journey to run against:
  - New root `.env.e2e` (gitignored) + committed `.env.e2e.example`, pointing the API's `DATABASE_URL` at `notes_test` and the web app's `VITE_API_URL` at a dedicated e2e API port.
  - New `GET /health` endpoint on the API (unauthenticated, unrated-limited) so Playwright's `webServer` has something to poll for readiness.
  - New `dev:e2e` scripts in `apps/api` and `apps/web`, both loading `.env.e2e`.
  - `apps/web/playwright.config.ts` updated to a two-entry `webServer` array (API + web), both bound to ports distinct from the ordinary `pnpm dev` stack (see Test Environment & Setup for why).
  - A test-only rate-limit bypass: `createRateLimiter` gains a `skip` check on `process.env.E2E_DISABLE_RATE_LIMIT === 'true'`, set only in `.env.e2e`.
- A generated-per-run unique test user (unique email) so the suite is safely re-runnable without hitting `USER_EXISTS`.

## Non-Goals
- No changes to `packages/shared`, to any business logic in `apps/api/src/services/**`, or to any frontend component's behavior — this ticket only adds test infrastructure and the test itself.
- No CI wiring — CI is explicitly out of scope for this project (FRS §1.2, §11).
- No coverage of secondary/error-path journeys (e.g. failed login, expired share link, OTP flow) — those are already covered by each feature ticket's own component/integration tests. This journey is the one documented FR-E2E-1 happy path only.
- No visiting the public share link page (`/shares/:token`) as an unauthenticated second context — FR-E2E-1's step list is "Share Note → Revoke Share," not "visit public link"; that page's behavior is already covered by AB-1008/AB-1014's own tests.
- No automated teardown/truncation of `notes_test` after the run — see Test Data & Isolation.
- No change to `smoke.spec.ts`'s assertions — only its now-stale comment (see Ticket-Specific Decisions).

## FRs Covered
| FR | Coverage |
|---|---|
| FR-E2E-1 | The full journey test itself: register → login → create note → autosave → tag → share → revoke → restore version → delete → restore from trash → logout, all in one uninterrupted run |
| FR-AUTH-1 / FR-AUTH-2 | Register step (which, per AB-1010's `RegisterForm`, chains a login call with the same credentials in one submit) exercises both real endpoints |
| FR-NOTE-1 / FR-UI-2 | Create Note + Autosave steps hit real `POST /notes` via the debounced autosave path |
| FR-UI-3 | Tag Note step creates a brand-new tag on the fly via `TagCombobox` |
| FR-SHARE-1 / FR-SHARE-2 | Share Note + Revoke Share steps hit real `POST /notes/:id/shares` and `DELETE /notes/:id/shares/:token` |
| FR-VER-2 | Restore Version step hits real `POST /notes/:id/versions/:versionId/restore`, asserting the note's body visibly reverts |
| FR-NOTE-4 / FR-NOTE-8 | Delete Note + Restore from Trash steps hit real soft-delete and restore endpoints |
| FR-AUTH-4 | Logout step revokes the session and redirects to `/login` |

## Test Environment & Setup

**Decision (resolved with user): the e2e API process points at `notes_test`, not `notes_dev`.** A dedicated root `.env.e2e` file is added (gitignored, mirroring the existing `.env`/`.env.example` split per FR-INFRA-6), with a committed `.env.e2e.example` template:
```
DATABASE_URL=postgresql://noteapp:changeme@localhost:5432/notes_test
JWT_SECRET=replace-with-a-random-string-at-least-32-characters-long
WEB_ORIGIN=http://localhost:5174
VITE_API_URL=http://localhost:3002
NODE_ENV=development
PORT=3002
BCRYPT_ROUNDS=12
E2E_DISABLE_RATE_LIMIT=true
```

**Decision (resolved with user): rate limiting is bypassed via an env flag, not worked around.** `apps/api/src/middleware/rateLimit.ts`'s `createRateLimiter` gets one addition:
```ts
export function createRateLimiter(options: Partial<Options>) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    handler: rateLimitHandler,
    skip: () => process.env.E2E_DISABLE_RATE_LIMIT === 'true',
    ...options,
  });
}
```
This is inert everywhere else: `E2E_DISABLE_RATE_LIMIT` is never set in `.env`/`.env.example`, so `pnpm dev`, `pnpm test` (Supertest), and any real deployment are unaffected. It is not added to `apps/api/src/lib/env.ts`'s Zod schema — it's read directly off `process.env`, no validation needed for a boolean test-only flag.

**Why distinct ports (5174/3002) instead of reusing 5173/3001:** `apps/web/playwright.config.ts` currently sets `reuseExistingServer: !process.env.CI`, which is `true` locally. If the e2e `webServer` entries targeted the same ports as an ordinary `pnpm dev` session, Playwright would silently attach to whatever a developer already has running — which would be the real `notes_dev` API with real rate limits and none of this ticket's env wiring, defeating both decisions above without any visible error. Binding the e2e stack to its own ports means `reuseExistingServer` only ever reuses a *previous e2e run's own* leftover process (the desired fast-iteration case), never the developer's regular dev stack.

**Changes required:**
1. `apps/api/src/routes/index.ts`: add `router.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }))`, mounted before `/auth`, unauthenticated and unrated-limited — Playwright's `webServer.url` readiness probe needs an endpoint to poll.
2. `apps/api/package.json`: add `"dev:e2e": "dotenv -e ../../.env.e2e -- tsx watch src/server.ts"` (mirrors the existing `dev` script's `dotenv -e ../../.env` pattern).
3. `apps/web/package.json`: add `"dev:e2e": "vite --mode e2e --port 5174"`. Vite's `envDir: '../../'` (already set in `apps/web/vite.config.ts`) means `--mode e2e` picks up the root `.env.e2e`'s `VITE_API_URL` automatically via Vite's built-in `.env.[mode]` loading — no dotenv-cli needed on the web side.
4. `apps/web/playwright.config.ts`:
   ```ts
   webServer: [
     {
       command: 'pnpm --filter api run dev:e2e',
       cwd: '../..',
       url: 'http://localhost:3002/health',
       reuseExistingServer: !process.env.CI,
     },
     {
       command: 'pnpm --filter web run dev:e2e',
       cwd: '.',
       url: 'http://localhost:5174',
       reuseExistingServer: !process.env.CI,
     },
   ],
   use: { baseURL: 'http://localhost:5174' },
   ```
5. `.env.e2e.example` committed at repo root; `.env.e2e` added to `.gitignore` alongside the existing `.env` entry.
6. Migrations: no new migration needed — `notes_test` already receives every migration per the existing dual-database workflow (SDS §2.2/§18); this ticket only points a new API process at that already-migrated database.

## Journey Steps
Concrete mapping of FR-E2E-1's step list onto this codebase's actual routes/components (all via `page.getBy...` role/label queries, no CSS selectors):

1. **Register** — navigate to `/register`, fill `#register-email` / `#register-password` / `#register-confirm-password` with a per-run-unique email (see Test Data & Isolation) and a password meeting FR-AUTH-1's complexity rule (e.g. `E2eJourney!23`), submit. `RegisterForm` chains `register()` then `login()` internally with the same credentials (AB-1010 decision) — assert the end state is `/notes` (both Register and Login are exercised by this one submit).
2. **Create Note** — click "New Note" (`/notes/new`), type a title into the title input and body text into the TipTap editor (`.prose-editor` content-editable region).
3. **Autosave** — wait for the URL to become `/notes/$noteId` (fired by `onCreated` after the debounced `POST /notes` succeeds) as the primary completion signal, since the "All changes saved" pill (`AutosaveStatusPill`) auto-hides after 2s (`SAVED_AUTO_HIDE_MS`) and is a flaky thing to assert on directly; optionally assert the pill text appears at all beforehand.
4. **Tag Note** — type a new tag name into the `TagCombobox` input and press Enter; assert the tag chip renders attached. This fires an immediate `PATCH /notes/:id` (not the debounced autosave path), which also snapshots a `NoteVersion` of the pre-tag state (see Ticket-Specific Decisions).
5. **Share Note** — click the "Share note" icon button, submit the `ShareModal`'s create-link form (leave days blank for the 7-day default), assert a share link row appears.
6. **Revoke Share** — click "Revoke" on that link, confirm in `RevokeShareLinkModal`, assert the link's row flips to its revoked (struck-through, no Copy/Revoke buttons) state.
7. **(setup step, not itself an FR-E2E-1 line item)** — append a short suffix to the note body and wait for the next autosave cycle to complete. Needed so "Restore Version" reverts a real content difference rather than a no-op (see Ticket-Specific Decisions).
8. **Restore Version** — click the "Version history" icon button, select the (only) version row in `VersionHistoryModal`, click "Restore this version," confirm in `RestoreVersionConfirmModal`, assert the editor body now shows the pre-edit text (reverted) and the tag chip from step 4 is still attached (FR-VER-2's tag-unaffected guarantee).
9. **Delete Note** — click the "Delete note" icon button, confirm in `DeleteNoteModal`, assert redirect to `/notes` with the note no longer listed.
10. **Restore from Trash** — click "Trash" in the `AppShell` nav, click the note's row (opens `TrashPreviewModal`), click "Restore," confirm in `RestoreConfirmModal`, assert the modal closes; navigate to `/notes` and assert the note is listed again.
11. **Logout** — click "Log out" in `AppShell`, assert redirect to `/login`.

## Test Data & Isolation
- **Unique user per run:** email generated as `` `e2e-${Date.now()}@noteapp.test` `` (or equivalent), so re-running the suite never hits `USER_EXISTS` regardless of what's already in `notes_test`.
- **No shared state across test files:** this ticket adds exactly one spec file; `fullyParallel: true` (already set) is fine since `journey.spec.ts` and `smoke.spec.ts` never touch each other's data.
- **Single serial test:** the journey is one `test('completes the full core user journey', async ({ page }) => { ... })` using `test.step(...)` per Journey Steps item above, not eleven independent `test()` blocks — each step depends on the previous step's state (same note, same page/browser context), so independent tests would require re-deriving all prior state anyway.
- **No automated cleanup:** the created user/note/tag/version/share rows are left in `notes_test` after the run. This is consistent with `notes_test` already being a disposable database the developer can wipe via `pnpm db:reset` if it grows large; adding cleanup logic here would be scope beyond what FR-E2E-1 asks for.
- **Rate limits:** bypassed entirely for this environment via `E2E_DISABLE_RATE_LIMIT` (see Test Environment & Setup) — the suite can be re-run as many times as needed without tripping FRS §11's real limits.

## Ticket-Specific Decisions
- **Backend target — `notes_test`, not `notes_dev` (resolved with user):** keeps the journey from ever writing to a developer's real local data, at the cost of needing its own API process/env/port. See Test Environment & Setup.
- **Rate-limit bypass via env flag, not backend-scope creep (resolved with user):** the alternative (relying solely on a unique email to dodge `USER_EXISTS`) doesn't address the login rate limit (5/min/IP) also being consumed by the Register step's internal login-chain, nor repeated manual re-runs during test authoring/debugging. The `skip` addition to `createRateLimiter` is the minimal-footprint way to disable limiting only when explicitly flagged.
- **Distinct e2e ports (5174/3002), not reusing 5173/3001:** see the "Why distinct ports" callout in Test Environment & Setup — reusing the ordinary dev ports would let Playwright's `reuseExistingServer` silently defeat both decisions above.
- **Extra body edit before Restore Version:** tagging an existing note (step 4) already triggers a `NoteVersion` snapshot via the shared `updateNote` transaction (SDS §10) — but since tagging never touches title/body, that snapshot's content is identical to what's already showing. Without a further content change, "Restore Version" would be mechanically exercised (transaction runs, new version created, `EditorBody` remounts) but produce zero visible difference, which is a weak assertion for an E2E test whose whole point is proving user-visible behavior. Adding one more small body edit (a `test.step` not itself named in FR-E2E-1's list) between Revoke Share and Restore Version gives the restore step a real, observable revert to assert on.
- **`smoke.spec.ts` comment now stale, needs a one-line fix:** its comment currently says the test "runs...with only the web dev server running (no API server), so the bootstrap's `/auth/refresh` call fails with a network error." Once the shared `playwright.config.ts` always boots the e2e API (webServer array), that's no longer true — a fresh browser context still has no refresh cookie, so `/auth/refresh` now gets a real `401` instead of a network error, and still resolves to `'unauthenticated'`, so the test's assertions (redirect to `/login`) are unaffected. Only the comment needs updating to describe the new reality; no test-logic change.
- **Single serial `test()` with `test.step()`, not eleven separate tests:** see Test Data & Isolation.

## Scenarios
1. A brand-new user completes every step in Journey Steps 1–11 in order, with no manual intervention, and ends logged out at `/login` — the full FR-E2E-1 acceptance row.
2. After the Tag Note step, the tag chip is visible and attached before any further step runs.
3. After the Restore Version step, the note's body text matches the pre-edit (step 7) content, and the tag from step 4 is still attached (proving FR-VER-2's tag-unaffected guarantee holds even inside this specific journey, not just in AB-1015's own unit-level tests).
4. After the Revoke Share step, the share link's row shows no Copy/Revoke buttons (revoked state) before Restore Version begins.
5. After the Delete Note step, navigating to `/notes` does not show the note; navigating to `/notes/trash` does show it.
6. After the Restore from Trash step, navigating to `/notes` shows the note again, and `/notes/trash` no longer does.
7. Re-running the full spec twice in a row within the same hour succeeds both times without hitting `AUTH_INVALID_CREDENTIALS`/`USER_EXISTS`/`RATE_LIMITED` — proving the unique-email + rate-limit-bypass combination actually works, not just in theory.
8. `pnpm --filter web exec playwright test` run with no `.env.e2e` present fails fast and legibly (missing `DATABASE_URL`/`JWT_SECRET` triggers the API's existing fail-fast `loadEnv` validation, per FR-INFRA-6) rather than the journey test hanging or timing out with an opaque error.

## Dependencies
- AB-1002 (Auth Core), AB-1004 (Notes Core), AB-1006 (Tags CRUD), AB-1008 (Sharing), AB-1009 (Version History) — merged/archived. Supply every backend endpoint this journey exercises, unchanged.
- AB-1010 (Auth Frontend), AB-1011 (Notes List, incl. Trash UI), AB-1012 (Note Editor), AB-1014 (Sharing Frontend), AB-1015 (Version History Frontend) — merged/archived. Supply every component/route this journey drives, unchanged.
- AB-1001 (Project Setup) — merged/archived. `docker-compose.yml`/`notes_test` provisioning and the root `.env`/`.env.example` pattern this ticket's `.env.e2e` mirrors.

## Open Questions
None — the two substantive environment questions (backend target: `notes_test`; rate-limit handling: env-gated bypass) were resolved with the user before drafting; see Test Environment & Setup and Ticket-Specific Decisions. The custom E2E section template (noted in Overview) is a process/formatting choice, not a content ambiguity, and can be adjusted on review without changing any decision above.
