---
ticket: AB-1016
status: APPROVED
---

# AB-1016: Core User Journey E2E Test — Tasks

Ordered so each task is independently testable per its own "Verify" line. Tasks 1–6 touch disjoint files and carry no runtime dependency on each other, so they're tagged `[PARALLEL]`; tasks 7 onward each depend on prior tasks landing first (noted per task) and run in sequence.

- [x] **1. [PARALLEL] Gitignore the e2e env file** — 2 min
  Add `.env.e2e` under the existing `# Environment` block in `.gitignore` (the current `.env.*.local` glob doesn't match it).
  Files: `.gitignore`
  Satisfies: enables Scenario 8 (no real secret ever risks being committed alongside the new env file).
  Verify: `git check-ignore .env.e2e` reports it as ignored.

- [x] **2. [PARALLEL] Add `.env.e2e.example` template** — 5 min
  Commit the template at repo root with `DATABASE_URL` (→ `notes_test`), `JWT_SECRET`, `WEB_ORIGIN=http://localhost:5174`, `VITE_API_URL=http://localhost:3002`, `NODE_ENV=development`, `PORT=3002`, `BCRYPT_ROUNDS=12`, `E2E_DISABLE_RATE_LIMIT=true` — exact contents per spec.md's Test Environment & Setup.
  Files: `.env.e2e.example`
  Satisfies: enables Scenario 8 (missing/misconfigured `.env.e2e` fail-fast check needs a known-good template to diff against).
  Verify: file exists at repo root; every key from spec.md's block is present with a placeholder or correct fixed value.

- [x] **3. [PARALLEL] Rate-limit bypass flag** — 8 min
  In `apps/api/src/middleware/rateLimit.ts`, add `skip: () => process.env.E2E_DISABLE_RATE_LIMIT === 'true'` to the object passed to `rateLimit(...)`, placed before the `...options` spread so a future caller-supplied `skip` still wins.
  Files: `apps/api/src/middleware/rateLimit.ts`
  Satisfies: Scenario 7 (repeat runs don't trip real rate limits).
  Verify: `pnpm --filter api test` stays green — specifically `auth.integration.test.ts` and `public.integration.test.ts`'s existing `429`/`RATE_LIMITED` assertions, proving `skip()` is `false` (and thus a no-op) whenever `E2E_DISABLE_RATE_LIMIT` isn't set, as in the normal Vitest/Supertest run.

- [x] **4. [PARALLEL] `GET /health` endpoint** — 10 min
  In `apps/api/src/routes/index.ts`, add `router.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }))` mounted before `/auth`, with no auth or rate-limit middleware.
  Files: `apps/api/src/routes/index.ts`
  Satisfies: enables Scenario 1 (Playwright's `webServer` readiness probe) and Scenario 8.
  Verify: `pnpm --filter api run dev` (existing dev env), then `curl -i http://localhost:3001/health` returns `200` with `{"status":"ok"}`.

- [x] **5. [PARALLEL] API `dev:e2e` script** — 5 min
  Add `"dev:e2e": "dotenv -e ../../.env.e2e -- tsx watch src/server.ts"` to `apps/api/package.json`, mirroring the existing `dev` script's pattern.
  Files: `apps/api/package.json`
  Satisfies: enables Scenario 1.
  Verify: after copying `.env.e2e.example` → `.env.e2e` locally, `pnpm --filter api run dev:e2e` boots and logs `API listening on port 3002`; `curl http://localhost:3002/health` succeeds (depends on Task 4).

- [x] **6. [PARALLEL] Web `dev:e2e` script** — 5 min
  Add `"dev:e2e": "vite --mode e2e --port 5174"` to `apps/web/package.json`.
  Files: `apps/web/package.json`
  Satisfies: enables Scenario 1.
  Verify: `pnpm --filter web run dev:e2e` serves on `http://localhost:5174`; the page's network calls target `http://localhost:3002` (confirms Vite picked up `.env.e2e`'s `VITE_API_URL` via `--mode e2e`).

- [x] **7. Update `playwright.config.ts` webServer array** — 15 min
  Depends on: Tasks 4, 5, 6.
  Replace the single `webServer` object with the two-entry array (API on 3002 with `url: 'http://localhost:3002/health'`, web on 5174) and update `use.baseURL` to `http://localhost:5174`, per spec.md's Test Environment & Setup block.
  Files: `apps/web/playwright.config.ts`
  Satisfies: enables Scenario 1; is the mechanism proven by Scenario 7's re-run check.
  Verify: run the existing `pnpm --filter web exec playwright test smoke` — it should still pass, and Playwright's own startup logs should show it launching processes on 3002 and 5174 (not 3001/5173), confirming the dedicated-port design from spec.md's "Why distinct ports" decision actually takes effect.

- [x] **8. Fix `smoke.spec.ts`'s stale comment** — 5 min
  Depends on: Task 7.
  Update the comment block (current lines 3–15) to describe the new reality: a fresh context still has no refresh cookie, so `/auth/refresh` now gets a real `401` from the always-running e2e API (not a network error), and still resolves to `'unauthenticated'`. No assertion lines change.
  Files: `apps/web/e2e/smoke.spec.ts`
  Satisfies: no scenario directly — documentation accuracy only, called out in plan.md's Files to Modify.
  Verify: re-run `pnpm --filter web exec playwright test smoke` — still green, since only the comment changed; `pnpm lint --max-warnings 0` stays clean.

- [x] **9. [SUBAGENT] Write `journey.spec.ts`** — 90 min
  Depends on: Tasks 1–8 (needs the full dual-server e2e environment working end to end before it can be authored/iterated against a real backend).
  Implement the single serial `test()` with `test.step()` blocks for: Register(+Login), Create Note, Autosave wait, Tag Note, Share Note, Revoke Share, the step-7 body-edit setup, Restore Version, Delete Note, Restore from Trash, Logout — per spec.md's Journey Steps section exactly (selectors, UI copy, and ordering as documented there). Use a `` `e2e-${Date.now()}@noteapp.test` `` -style unique email per run. Use only auto-waiting Playwright assertions (`expect(page).toHaveURL(...)`, `expect(locator).toBeVisible()`), never a fixed `waitForTimeout` for the autosave debounce (plan.md Risk Area 3). Add an explicit assertion that the version list has exactly one row before selecting it in the Restore Version step (plan.md Risk Area 4).
  Files: `apps/web/e2e/journey.spec.ts`
  Satisfies: Scenarios 1, 2, 3, 4, 5, 6.
  Verify: `pnpm --filter web exec playwright test journey` passes in full, with each `test.step()` visible and green in the report.

- [x] **10. Re-run verification (Scenario 7)** — 10 min
  Depends on: Task 9.
  Run `pnpm --filter web exec playwright test journey` twice in immediate succession; confirm both runs pass with no `USER_EXISTS`/`AUTH_INVALID_CREDENTIALS`/`RATE_LIMITED` failures.
  Files: none (verification only).
  Satisfies: Scenario 7.
  Verify: two consecutive green runs, logged in the PR description per plan.md's Test Strategy (this is a manual check, not itself an automated assertion — no CI exists in this project to re-run it later).

- [x] **11. Fail-fast verification (Scenario 8)** — 5 min
  Depends on: Task 9.
  Temporarily rename the local `.env.e2e` aside, run `pnpm --filter web exec playwright test journey`, confirm the spawned API process exits immediately via `EnvValidationError` (visible in the Playwright webServer output) rather than the suite hanging or timing out; restore `.env.e2e` afterward.
  Files: none (verification only; local `.env.e2e` is gitignored/untracked).
  Satisfies: Scenario 8.
  Verify: API process log shows the `EnvValidationError` message and a non-zero exit, and Playwright surfaces a clear webServer-failed-to-start error rather than a bare timeout.

- [x] **12. Full regression + quality gates** — 15 min
  Depends on: Tasks 1–11.
  Run `pnpm --filter api test` (confirms Risk Area 2 — existing rate-limit integration tests still pass), then the full `pnpm build && pnpm lint --max-warnings 0 && pnpm test` gate per AGENTS.md §4 / CLAUDE.md Quality Gates, before this ticket is considered done.
  Files: none (verification only).
  Satisfies: regression coverage for all scenarios; required gate before commit.
  Verify: all three commands exit 0 with no errors/warnings.
