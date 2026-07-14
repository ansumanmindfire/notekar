---
ticket: AB-1016
status: APPROVED
---

# AB-1016: Core User Journey E2E Test — Plan

## Reuse Check (packages/shared)
`packages/shared/src/` currently exports only `index.ts`, `schemas.ts`, `types.ts`, `errorCodes.ts` (confirmed via directory listing — no code-review-graph MCP tools are available in this session, so this is a direct-read fallback per CLAUDE.md's "fall back to Grep/Glob/Read only when the graph doesn't cover what you need"). Nothing in this ticket needs a new shared type, schema, or constant: the journey drives existing UI against existing endpoints. Confirms spec.md's Non-Goals — no `packages/shared` changes.

## Files to Create
| File | Purpose |
|---|---|
| `apps/web/e2e/journey.spec.ts` | The core journey test itself — one serial `test()` with 11 `test.step()` blocks (10 named FR-E2E-1 steps + the step-7 setup edit) |
| `.env.e2e.example` (repo root) | Committed template for the gitignored `.env.e2e`, mirroring the existing `.env.example` pattern (FR-INFRA-6) |

## Files to Modify
| File | Change |
|---|---|
| `apps/api/src/middleware/rateLimit.ts` | Add `skip: () => process.env.E2E_DISABLE_RATE_LIMIT === 'true'` to the options passed into `rateLimit(...)` inside `createRateLimiter`, before the `...options` spread (so a caller-supplied `skip` in `options` would still win — none currently pass one) |
| `apps/api/src/routes/index.ts` | Add `router.get('/health', ...)` before `router.use('/auth', ...)`, returning `200 { status: 'ok' }`, no auth/rate-limit middleware |
| `apps/api/package.json` | Add `"dev:e2e": "dotenv -e ../../.env.e2e -- tsx watch src/server.ts"` |
| `apps/web/package.json` | Add `"dev:e2e": "vite --mode e2e --port 5174"` |
| `apps/web/playwright.config.ts` | Replace the single `webServer` object with a two-entry array (API `dev:e2e` on 3002 with `url: 'http://localhost:3002/health'`, web `dev:e2e` on 5174); update `use.baseURL` to `http://localhost:5174` |
| `apps/web/e2e/smoke.spec.ts` | Update the comment block only (lines 3–15) — it currently asserts "no API server running" as the reason `/auth/refresh` resolves unauthenticated; once the shared config always boots the e2e API, the comment must instead explain that a fresh context's missing refresh cookie produces a `401` (not a network error) and still resolves `'unauthenticated'`. **No assertion lines change.** |
| `.gitignore` | Add `.env.e2e` under the existing `# Environment` block (the current `.env.*.local` glob does not match `.env.e2e`) |

## Prisma Schema Changes
None. No new migration, no model changes. `notes_test` already receives every migration via the existing dual-database workflow (SDS §2.2/§18) — this ticket only points a new, e2e-only API process at that already-migrated database via `.env.e2e`'s `DATABASE_URL`. No soft-delete/CASCADE concerns since nothing in the schema changes.

## New Packages
None. `@playwright/test` (`apps/web`), `dotenv-cli`/`dotenv` (`apps/api`), and `express-rate-limit` are already present at pinned versions and are all this ticket needs.

## Dependencies on Prior Tickets
- AB-1002, AB-1004, AB-1006, AB-1008, AB-1009 (backend, archived) — endpoints exercised, unchanged.
- AB-1010, AB-1011, AB-1012, AB-1014, AB-1015 (frontend, archived) — routes/components driven, unchanged.
- AB-1001 (project setup, archived) — `notes_test`/Docker provisioning and the `.env`/`.env.example` convention this ticket's `.env.e2e`/`.env.e2e.example` mirrors.
- All prerequisite tickets are already merged/archived — no blocking work outstanding before implementation can start.

## Risk Areas
1. **`reuseExistingServer` masking the wrong stack.** Already addressed in spec.md via dedicated ports (5174/3002) instead of reusing 5173/3001 — flagged here as the single highest-risk design point in this ticket, since getting it wrong silently runs the journey against `notes_dev` with real rate limits and no visible failure. Verify during implementation by running the suite once with `pnpm dev` + `pnpm db:up` already running in another terminal, confirming the journey's requests land on port 3002/5174, not 3001/5173.
2. **Rate-limit `skip` regressing existing integration tests.** `apps/api/src/routes/auth.integration.test.ts` and `public.integration.test.ts` already assert real `429 RATE_LIMITED` behavior (confirmed present via search). Since `E2E_DISABLE_RATE_LIMIT` is never set when running `pnpm test` (Vitest loads `TEST_DATABASE_URL` directly, not `.env.e2e`), `skip()` evaluates to `false` there and those tests are unaffected — but this must be explicitly re-verified by running `pnpm --filter api test` after the `rateLimit.ts` change, not assumed.
3. **Debounced autosave timing.** The 2000ms `DEBOUNCE_MS` (`useAutosave.ts`) plus network round-trip means every "wait for autosave" point in `journey.spec.ts` needs a real assertion to wait on (URL change, DOM update) rather than a fixed `page.waitForTimeout(2000)`, which would be flaky under CI-like load. Use Playwright's auto-waiting assertions (`expect(page).toHaveURL(...)`, `expect(locator).toBeVisible()`) exclusively.
4. **Version-list selection ambiguity.** After the step-7 edit, `VersionHistoryModal`'s list has exactly one row (created at the Tag Note step) at the time Restore Version runs — the plan relies on this being unambiguous. If a future ticket changes tagging to no longer snapshot a version, this journey would break with zero rows to select; low likelihood (that behavior is a deliberate, tested part of AB-1009's transaction), but worth a one-line assertion in the test that the list has exactly one entry before selecting it, so a future regression here fails loudly and specifically rather than with a confusing "element not found."
5. **Purge cron jobs starting under `dev:e2e`.** `server.ts` schedules `purgeNotes`/`purgeVersions` cron jobs whenever `NODE_ENV !== 'test'`; `.env.e2e` sets `NODE_ENV=development`, so both jobs get scheduled (harmlessly, given `PURGE_CRON_SCHEDULE`'s default `0 3 * * *` daily schedule) for the lifetime of the spawned process. No code change needed — noted only so it isn't mistaken for a leak during review.

## Test Strategy
This ticket's deliverable *is* its own test — there is no separate unit-test layer to add, per spec.md's Non-Goals (no business-logic changes). Scenario-to-artifact mapping:

| spec.md Scenario | Covered by |
|---|---|
| 1 (full journey, steps 1–11, ends at `/login`) | `journey.spec.ts`'s single `test()`, all `test.step()` blocks passing in sequence |
| 2 (tag chip visible after Tag Note) | Assertion inside the Tag Note `test.step()` |
| 3 (body reverts + tag survives after Restore Version) | Assertions inside the Restore Version `test.step()` |
| 4 (share link shows revoked state) | Assertion inside the Revoke Share `test.step()` |
| 5 (note absent from `/notes`, present in `/notes/trash` after delete) | Assertions inside the Delete Note `test.step()` |
| 6 (note present in `/notes`, absent from `/notes/trash` after restore) | Assertions inside the Restore from Trash `test.step()` |
| 7 (suite re-runnable twice within an hour) | Manual verification during implementation: run `pnpm --filter web exec playwright test journey` twice in a row locally before marking the ticket done; not itself an automated assertion (a second full journey run as part of CI/pre-commit is out of scope — no CI in this project) |
| 8 (fail-fast with no `.env.e2e`) | Manual verification during implementation: temporarily rename `.env.e2e`, run the Playwright command, confirm the API process exits via `EnvValidationError` rather than the test suite hanging/timing out |

Regression check (not a new test, but must stay green): `pnpm --filter api test` (Vitest/Supertest, including `auth.integration.test.ts` and `public.integration.test.ts`'s existing rate-limit assertions) after the `rateLimit.ts` change, and the full `pnpm build && pnpm lint --max-warnings 0 && pnpm test` gate before commit, per AGENTS.md §4/CLAUDE.md Quality Gates.

## Open Questions
None — all environment and design decisions were resolved in spec.md before this plan was drafted.
