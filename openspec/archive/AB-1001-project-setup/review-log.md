# AB-1001: Review Log

Append-only log of tester + reviewer findings, one entry per task. Reviewer writes here only — no code edits.

Format per entry:

```
## T<n> — <task title>
**Tester:** [OK|FAIL] <summary, or link to test file>
**Reviewer:** [OK|WARN|FAIL|SEC] <finding, file:line>
**Triage:** <Case A/B/C decision + action taken>
```

---

## T1-T5 — Phase 0: Root workspace skeleton

**Tester:** [OK] No dedicated automated test warranted yet — the only relevant Test Strategy row (S13, pinned-deps check) is explicitly deferred to Phase 6 (T47) since it must read every workspace `package.json`, most of which don't exist yet. No test files written.

### pnpm-workspace.yaml
**Reviewer:** [OK] Scopes `apps/*` and `packages/*` exactly per AGENTS.md §2 monorepo layout — pnpm-workspace.yaml:1-3

### package.json (root)
**Reviewer:** [OK] `engines.node` = "22.23.1" — exact patch, no range — package.json:6
**Reviewer:** [WARN] `packageManager` = "pnpm@11.9.0" is exact-pinned correctly, but should be re-verified against the live npm registry at actual `pnpm install` time, not trusted from drafting-time web search — package.json:8
**Reviewer:** [OK] All 14 devDependencies are exact-pinned — no `^`, `~`, or `latest` found — package.json:19-34
**Reviewer:** [WARN] Scope drift: tasks.md T2 scoped root package.json as "no deps yet" (tooling deps deferred to Phase 2/6). The delivered file already includes the Phase 2/6 tooling devDependencies consolidated in T2 — package.json:19-34
**Reviewer:** [OK] Scripts match tasks.md T2 scope — package.json:9-18

### .nvmrc
**Reviewer:** [OK] Exact Node patch "22.23.1", consistent with package.json `engines.node` — .nvmrc:1

### tsconfig.base.json
**Reviewer:** [OK] `strict: true` + `noImplicitAny: true` present — tsconfig.base.json:3-4
**Reviewer:** [WARN] Explicit `any` enforcement (AGENTS.md §6/§11 prohibits both implicit and explicit `any`) depends entirely on the not-yet-created eslint.config.js's `@typescript-eslint/no-explicit-any` rule (Phase 2, T10) — tsconfig.base.json:3-19
**Reviewer:** [OK] No secrets/credentials present — tsconfig.base.json:1-21

### .gitignore
**Reviewer:** [OK] Contains all required ignore patterns per tasks.md T5 — .gitignore:5-19
**Reviewer:** [OK] Pre-existing code-review-graph entry preserved — .gitignore:1-2
**Reviewer:** [WARN] `.env.*.local` (line 13) does not glob-match a bare `.env.local` file (gitignore requires a non-empty middle segment) — a common Vite local-override filename could be accidentally committed — .gitignore:13
**Reviewer:** [OK] No secrets/credentials present in any of the 5 reviewed files — all files

### N/A checks
**Reviewer:** [OK] Layer-skipping check — not applicable at Phase 0; no application code exists yet

**Summary:** 10 [OK], 4 [WARN], 0 [FAIL], 0 [SEC]

**Triage:** Case B (WARN findings) for one item; the other three WARNs are accepted as informational/no-action:
- `packageManager` re-verify reminder → accepted, no action (already flagged as a general risk in plan.md; will be naturally re-verified at first `pnpm install`, T53).
- package.json scope drift (T2 tooling deps included early) → accepted as a deliberate consolidation, not a defect: scripts like `lint`/`test` in T2 are meaningless without their tools declared, so declaring them in the same commit as the scripts avoids a broken intermediate state. No revert.
- Explicit-`any` enforcement gap → accepted, no action; correctly closed by Phase 2 T10 (eslint.config.js), tracked there.
- `.env.*.local` gitignore glob gap → real, low-risk fix. See Fix Bundle in fix-bundles.md.
Task T1-T5 marked done after the fix bundle below is applied.

## T6-T9 — Phase 1: Docker / Local Database

**Tester:** [OK] `pnpm db:up` confirmed healthy by main Claude; both `notes_dev` and `notes_test` reachable (per task handoff, not re-run by tester agent).

### docker-compose.yml
**Reviewer:** [OK] Postgres image pinned to exact patch `postgres:16.14` — matches AGENTS.md §3, SDS §2.1 — docker-compose.yml:3
**Reviewer:** [OK] Healthcheck present: `pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}`, interval 5s / timeout 5s / retries 10 — docker-compose.yml:14-18
**Reviewer:** [OK] Named volume `pgdata`; only wiped by explicit `down -v` — docker-compose.yml:11-12,20-21
**Reviewer:** [OK] Port mapping `${POSTGRES_PORT:-5432}:5432`, overridable via `.env` — docker-compose.yml:9-10
**Reviewer:** [OK] `environment` block consistent with `.env.example` values and `DATABASE_URL` — docker-compose.yml:5-8, .env.example:2,24-26
**Reviewer:** [WARN] No fallback default for `POSTGRES_USER`/`POSTGRES_DB` (unlike `POSTGRES_PORT`) if `.env` doesn't exist yet on a truly fresh clone — docker-compose.yml:6-8

### docker/init-db.sh
**Reviewer:** [OK] Creates only `notes_test`; no conflict with `POSTGRES_DB`-created `notes_dev` — docker/init-db.sh:4-6
**Reviewer:** [OK] `set -euo pipefail` + `ON_ERROR_STOP=1` — docker/init-db.sh:2,4
**Reviewer:** [WARN] Executable bit unverifiable from reviewer's read-only session — spot-checked directly by main Claude: file is `-rwxr-xr-x` on disk. Postgres entrypoint also sources non-executable `.sh` files as a fallback either way. Resolved.

### .env.example
**Reviewer:** [OK] Every SDS §15 variable present and cross-checked — .env.example:1-27
**Reviewer:** [OK] `POSTGRES_PORT` additive convenience var, not a contradiction — .env.example:27
**Reviewer:** [OK] `CONTEXT7_API_KEY` present as commented, non-required placeholder — .env.example:29-30
**Reviewer:** [OK] Internal consistency verified (host/port/db names match across vars) — .env.example:2,5,24-26
**Reviewer:** [OK] No real secrets committed — .env.example:1-31

### .gitignore / real .env
**Reviewer:** [OK] `.gitignore` line covers root-level `.env` — confirmed via Glob — .gitignore
**Reviewer:** [WARN] Reviewer couldn't run `git status` (no Bash/git tool) — spot-checked directly by main Claude: `git status --short .env` returns nothing, confirming `.env` is untracked. Resolved.

### N/A checks
**Reviewer:** [OK] CASCADE DELETE / soft-delete-bypass — N/A, no Prisma schema/models exist yet
**Reviewer:** [OK] Layer-skipping, duplicated types/schemas, `any` usage, `dangerouslySetInnerHTML` — N/A, no application code exists in this phase

**Summary:** 11 [OK], 3 [WARN], 0 [FAIL], 0 [SEC]

**Triage:** Case B → all three WARNs informational/edge-case; two resolved via direct spot-check (executable bit confirmed 755, `.env` confirmed untracked), one accepted as-is (empty-`.env`-on-fresh-clone is expected/documented behavior, covered by the README's setup sequence in Phase 7). No fix bundle required. Task T6-T9 marked done.

## T10-T13 — Phase 2: Lint / Format / Commit Tooling

**Tester:** [OK] No automated test warranted — nothing executable yet (`node_modules` doesn't exist, `pnpm install` is T53/Phase 8); the only scenarios these files serve (S7-S10) are explicitly scoped in plan.md as manual one-time verification (T59/T60, Phase 8), consistent with no-CI-in-this-project (AGENTS.md §10).

### eslint.config.js
**Reviewer:** [OK] `@typescript-eslint/no-explicit-any: 'error'` present — closes the Phase 0 WARN about explicit-`any` enforcement — eslint.config.js:36
**Reviewer:** [OK] TS rules apply globally to `.ts`/`.tsx` across api/web/shared via shared `files` block — eslint.config.js:22-39
**Reviewer:** [OK] React/`react-hooks` rules scoped exclusively to `apps/web/**` — eslint.config.js:47-64
**Reviewer:** [OK] `ignores` block correctly excludes `dist/`, `build/`, `node_modules/`, `coverage/`, `playwright-report/`, `test-results/`, `.husky/` — eslint.config.js:11-19
**Reviewer:** [WARN] plan.md's Test Strategy ties Scenario S2 to a lint-time `no-restricted-imports`/import-boundary rule preventing `apps/*` from redefining `packages/shared` exports — no such rule exists yet.
**Reviewer:** [OK] No secrets — eslint.config.js:1-73

### .prettierrc
**Reviewer:** [OK] Standard shared formatting config, no secrets — .prettierrc:1-9

### commitlint.config.js
**Reviewer:** [OK] Custom `ab-ticket-reference` rule hand-traced against 3 examples, all correct (feat without AB# fails, feat with AB# passes, chore unconditionally exempt) — commitlint.config.js:1-31
**Reviewer:** [WARN] Rule checks header/body/footer, not "subject only" as plan.md's file-purpose phrasing states — spec.md's own wording ("subject/body") matches the code; doc inconsistency between spec.md and plan.md, not a code defect.
**Reviewer:** [OK] No secrets — commitlint.config.js:1-31

### .husky/pre-commit
**Reviewer:** [OK] Content matches spec.md/plan.md/AGENTS.md's Husky gate exactly — .husky/pre-commit:1
**Reviewer:** [WARN] Executable bit unverifiable from reviewer's read-only session. Spot-checked directly by main Claude: `chmod +x`/`chmod 755` do NOT persist on this Windows/NTFS+git-bash environment (`stat` still reports `644` after chmod) — a real, not merely unverifiable, gap. The reliable fix (`git update-index --chmod=+x` after staging) requires a `git add`/`git update-index` call, which CLAUDE.md requires explicit user permission for. Deferred to T59 (Phase 8 manual husky/commitlint verification), where the hook is actually exercised end-to-end and the fix (if needed) will be applied then with explicit permission at that point.

### package.json
**Reviewer:** [OK] `"type": "module"` required for the two new ESM config files; repo-wide glob confirms no other `.js`/`.cjs`/`.mjs` file exists that could break — package.json:5
**Reviewer:** [OK] `"prepare": "husky"` is the correct v9+ invocation — package.json:11
**Reviewer:** [OK] All new devDependencies exact-pinned — package.json:21-38
**Reviewer:** [OK] No secrets — package.json:1-40

### N/A checks
**Reviewer:** [OK] Layer-skipping, duplicated types in application code, `any` in application code, `dangerouslySetInnerHTML`, hard-delete — all N/A, no application code yet.

**Summary:** 15 [OK], 3 [WARN], 0 [FAIL], 0 [SEC]

**Triage:** Case B → all three WARNs accepted/deferred, no immediate fix bundle:
- Missing `packages/shared` import-boundary lint rule (S2) → accepted as deferred; enforcement for now comes from the mandatory reviewer check "verify packages/shared usage" baked into every subsequent phase's reviewer brief per the /implement command's CRITICAL NOTEAPP RULES, rather than a static ESLint rule. Will reconsider adding a concrete lint rule once `packages/shared` has real exports to protect (Phase 3+) if reviewer-based enforcement proves insufficient.
- commitlint doc-wording inconsistency (spec.md vs plan.md) → accepted, no code action; code matches spec.md (the more authoritative approved doc).
- `.husky/pre-commit` executable bit not persisting on this Windows environment → real gap, deferred to T59 where it will be fixed with explicit git permission at the point the hook is actually exercised.
Task T10-T13 marked done.

## T14-T18 — Phase 3: packages/shared Scaffold

**Tester:** [OK] No dedicated automated test warranted — the only Test Strategy row touching these files (S13, pinned-deps check) is deferred to T47 (Phase 6); `Page<T>`/`ApiError` are pure type declarations with no runtime behavior to unit-test yet.

### package.json (packages/shared)
**Reviewer:** [OK] `zod` pinned exact `4.4.3` — package.json:16
**Reviewer:** [OK] `typescript` pinned exact `6.0.3` — package.json:19
**Reviewer:** [WARN] T14 scoped this file as "`zod` exact-pinned only"; delivered file also adds `typescript` (needed for the `typecheck` script to function). Same pattern as the Phase 0 scope-drift, already accepted there as a defensible consolidation.
**Reviewer:** [WARN] `exports` map points directly at `.ts` source with bare-string values — theoretically compatible with `moduleResolution: "Bundler"` for both Vite and tsx, but can't be empirically confirmed until T53 (install)/T55 (dev boot). Also depends on T20/T37 not overriding `moduleResolution` away from `"Bundler"`.
**Reviewer:** [OK] `"private": true` on generically-named package, no registry collision risk — package.json:2-3
**Reviewer:** [OK] No secrets — package.json:1-21

### tsconfig.json (packages/shared)
**Reviewer:** [OK] Extends root base, rootDir/outDir/include correct — tsconfig.json:2-7

### src/types.ts
**Reviewer:** [OK] `Page<T>` fields match AGENTS.md §8 exactly — types.ts:1-7
**Reviewer:** [OK] `ApiError` fields match AGENTS.md §8 exactly, including `fields` optionality — types.ts:9-13
**Reviewer:** [OK] `interface` vs `type` keyword choice — not mandated, not flagged

### src/schemas.ts / src/errorCodes.ts
**Reviewer:** [OK] Genuine empty placeholders with deferral comments — no premature invention of AB-1002+ content

### src/index.ts (barrel — addition beyond literal T14-T18 file list)
**Reviewer:** [WARN] Scope addition beyond tasks.md's literal file list — flagged per precedent, not blocking
**Reviewer:** [OK] No conflict with the `exports` map — internal relative imports bypass it entirely
**Reviewer:** [WARN] Forward risk: `export *` from 3 modules could collide once schemas.ts/errorCodes.ts gain real exports at AB-1002 — non-issue today, noted for AB-1002 planning

### N/A checks
**Reviewer:** [OK] Layer-skipping, soft-delete, DOMPurify, `any` usage, secrets — all N/A/clean at this phase

**Summary:** 12 [OK], 4 [WARN], 0 [FAIL], 0 [SEC]

**Triage:** Case B → all four WARNs accepted/deferred, no fix bundle:
- `typescript` devDep scope drift → accepted, same rationale as Phase 0.
- `exports`/Bundler-resolution compatibility → sound reasoning, deferred to empirical confirmation at T53/T55; will re-check T20/T37 don't override `moduleResolution`.
- `index.ts` barrel as unscoped addition → accepted, deliberate ergonomics choice, no conflict.
- Future `export *` collision risk → accepted as forward-looking note for AB-1002.
Task T14-T18 marked done.

## T19-T35 — Phase 4: apps/api Scaffold

**Tester:** [OK] Wrote `apps/api/src/lib/env.test.ts` (T23 — required/optional vars, coercion, defaults, 6 failure cases, no global `process.env` mutation), `apps/api/src/lib/AppError.test.ts` (unscoped addition, pure class, trivially testable), `apps/api/src/middleware/errorHandler.test.ts` (unscoped addition — pure function, mocked Prisma/logger per AGENTS.md §10). Deliberately did not test `app.ts`/`server.ts` (wiring only, no logic — Phase 8/AB-1002+ territory), `cors.ts`/`helmet.ts`/`bodyLimit.ts`/`rateLimit.ts` (thin library wrappers, nothing of ours to verify), `routes/index.ts` (needs real Express dispatch, deferred to integration tests), `prisma.ts` (bare singleton).

### apps/api/package.json / tsconfig.json / prisma/schema.prisma
**Reviewer:** [OK] All deps/devDeps exact-pinned — package.json:12-36
**Reviewer:** [OK] `"shared": "workspace:*"` correctly declared — package.json:13
**Reviewer:** [OK] `"type": "module"` present (corrects an incorrect premise in the review brief) — package.json:5
**Reviewer:** [OK] Zero Prisma models, matching this ticket's scope — schema.prisma:1-8
**Reviewer:** [OK] tsconfig extends root base correctly — tsconfig.json:2-8

### src/lib/env.ts, prisma.ts, logger.ts
**Reviewer:** [OK] `loadEnv()` throws `EnvValidationError` rather than exiting itself; only `process.exit` call in `apps/api/src` is `server.ts:11` — matches the testability design intent
**Reviewer:** [OK] Required/optional vars match SDS §15 exactly; no `any`; no secrets
**Reviewer:** [OK] Logger redaction paths match SDS §16 exactly

### src/lib/AppError.ts (unscoped addition)
**Reviewer:** [FAIL→FIXED] `exactOptionalPropertyTypes` TS2412: `readonly fields?: string[]` couldn't accept the constructor's `string[] | undefined` param. **Fix applied**: changed to `readonly fields: string[] | undefined` (drops the `?`). Fix verified correct in follow-up pass (see below).

### src/middleware/cors.ts, helmet.ts, bodyLimit.ts, rateLimit.ts
**Reviewer:** [OK] cors.ts explicit origin + credentials, matches SDS §5.2
**Reviewer:** [SEC→FIXED] helmet.ts only configured CSP, relying on undocumented library defaults for `X-Frame-Options`/HSTS. **Fix applied**: explicit `frameguard: { action: 'deny' }` + `isProduction`-gated `hsts`. Fix verified correct in follow-up pass.
**Reviewer:** [OK] bodyLimit.ts limiters match SDS §5.3, correctly unscoped to routes yet
**Reviewer:** [OK] rateLimit.ts factory deliberately unwired per plan.md's documented T29 deferral (not an oversight)

### src/middleware/errorHandler.ts
**Reviewer:** [OK] Correctly imports `ApiError` from `shared/types`, not redefined — errorHandler.ts:4
**Reviewer:** [OK] `Prisma.PrismaClientKnownRequestError` class-based check used correctly
**Reviewer:** [OK] ZodError → 400 VALIDATION_FAILED with fields[], matches SDS §6
**Reviewer:** [WARN] Generic `CONFLICT`/`NOT_FOUND` placeholder codes not literally in SDS §6's registry — accepted, `errorCodes.ts` is still AB-1002+ scope
**Reviewer:** [FAIL→FIXED] Same TS2412 issue as AppError.ts, at the `AppError` branch's object literal. **Fix applied**: conditional spread `...(err.fields !== undefined && { fields: err.fields })` omits the key entirely instead of setting it to `undefined`. Fix verified correct in follow-up pass.

### src/routes/index.ts, app.ts, server.ts, vitest.config.ts, .gitkeeps
**Reviewer:** [OK] routes/index.ts imports ApiError correctly, no business logic (nothing to layer-skip)
**Reviewer:** [OK] app.ts middleware order matches SDS §5 exactly for everything that exists; rate-limit slot deliberately omitted
**Reviewer:** [OK] server.ts catches EnvValidationError specifically, exits; rethrows unexpected errors
**Reviewer:** [OK] vitest.config.ts node environment; .gitkeeps present in controllers/services/jobs
**Reviewer:** [WARN] pino-http declared as a dependency but not wired anywhere (SDS §16 calls for it). **Fix applied**: wired into app.ts via `pinoHttp({ logger })`. Fix verified correct in follow-up pass, with one new placement caveat (see below).
**Reviewer:** [WARN] Coverage gap: errorHandler.ts's branching/app.ts's wiring have no dedicated unit test at time of first review — resolved by the tester's concurrent errorHandler.test.ts/AppError.test.ts (app.ts/server.ts wiring remains untested by design, see Tester note above).
**Reviewer:** [WARN] Forward risk (accepted, out of scope): compiled dist output's extensionless relative imports would need real Node ESM extensions if ever run outside tsx/bundler-mode — no production run path exists in this ticket.

### N/A checks
**Reviewer:** [OK] `localStorage` — zero occurrences (N/A for backend, confirmed clean)
**Reviewer:** [OK] Physical row deletion / `deletedAt` — N/A, zero Prisma models

**Summary (first pass):** 27 [OK], 6 [WARN], 2 [FAIL], 1 [SEC]

**Triage:** Case B → constructed a 4-part fix bundle (AppError.ts type fix, errorHandler.ts conditional spread, helmet.ts hardening, pino-http wiring). User approved all 4. Applied. Follow-up verification pass below.

## T19-T35 Fix Verification — Phase 4 Follow-up

**Tester:** [OK] Confirmed the 3 concurrently-added test files (env.test.ts, AppError.test.ts, errorHandler.test.ts) all mock Prisma/logger appropriately, none touch a real DB.

**Reviewer:** [OK] Fix 1 (AppError.ts) genuinely resolves TS2412 — removing the `?` marker means `exactOptionalPropertyTypes` no longer restricts the assignment
**Reviewer:** [OK] Fix 2 (errorHandler.ts conditional spread) genuinely avoids an explicit `fields: undefined` key — narrowing inside the truthy branch, zero keys contributed by the falsy branch
**Reviewer:** [OK] Fix 3 (helmet.ts) type-checks cleanly, no `any`; HSTS correctly gated to production only
**Reviewer:** [OK] Fix 4 (app.ts) call site matches new helmet signature exactly; `Pick<Env, 'WEB_ORIGIN'|'NODE_ENV'>` widening consistent with `Env`'s inferred type; pino-http now wired
**Reviewer:** [OK] All 3 new tests use `toHaveBeenCalledWith`/`toEqual`-style matchers (never `toStrictEqual`), so the `{fields: undefined}` vs `{}` distinction the fix touches would not cause a false failure either way
**Reviewer:** [WARN] Real coverage gap: no test asserts the `res.json` body shape specifically for the AppError-with-undefined-fields case (closest test only checks `logger.error` wasn't called) — the omit-when-undefined behavior itself is unasserted in either direction
**Reviewer:** [WARN] pino-http sits after `cors`; since `cors` auto-terminates `OPTIONS` preflight requests before calling `next()`, those preflights go unlogged. Common/accepted tradeoff, not a regression, but a real (not hypothetical) gap given current ordering
**Reviewer:** [WARN] Carry-forward: `rateLimit.ts` still not wired into `app.ts` at all — AGENTS.md §5 lists rate limiting in the fixed middleware order. Consistent with plan.md's stated per-route deferral (rate limits apply to specific auth/share routes, not globally) — flagged for the ticket that adds those routes (AB-1002+) to confirm it actually gets wired, not silently dropped.

**Summary (follow-up):** 12 [OK], 3 [WARN], 0 [FAIL], 0 [SEC]

**Triage:** Case B → all 3 follow-up WARNs accepted as low-risk/informational/carried-forward, no further fix bundle:
- Coverage gap on the omit-when-undefined branch → accepted; will revisit if Phase 8's coverage report (T57) shows a real gap, rather than round-tripping a subagent for one assertion line now.
- pino-http/preflight logging gap → accepted as a standard, low-value-loss tradeoff.
- rateLimit.ts unwired → accepted, explicitly carried forward to the first ticket that adds real routes needing per-route limits (AB-1002+).
Task T19-T35 marked done.

## T36-T45 — Phase 5: apps/web Scaffold

**Tester:** [OK] Wrote `apps/web/e2e/smoke.spec.ts` (T45) using `page.getByRole('heading', { level: 1, name: 'NoteApp' })` + `toBeVisible()`, matching `App.tsx`'s actual markup and the config's `baseURL`. Deliberately skipped a separate `App.test.tsx` Testing Library unit test — `App.tsx` is static JSX with zero props/state/logic, so a unit test would duplicate the Playwright test's failure mode rather than add genuine coverage; plan.md's Test Strategy table assigns S6 to the Playwright spec only.

### apps/web/package.json
**Reviewer:** [OK] All deps/devDeps exact-pinned — package.json:12-31
**Reviewer:** [OK] `"shared": "workspace:*"` reasonable to declare now even though unused yet, mirrors the already-accepted apps/api precedent
**Reviewer:** [WARN] A few devDependencies (`jsdom`, `@testing-library/dom`, `@testing-library/jest-dom`, `@types/react`, `@types/react-dom`) weren't individually enumerated in plan.md's table — accepted as necessary, correctly-scoped additions, consistent with prior phases' scope-drift precedent

### apps/web/tsconfig.json
**Reviewer:** [OK] Extends root base correctly; `noEmit: true` does not conflict with inherited `declaration`/`declarationMap`/`sourceMap` — `noEmit` unconditionally suppresses all TS emit regardless of those flags, which is correct since Vite/esbuild does the real transpilation and `tsc --noEmit` is type-check-only

### apps/web/vite.config.ts + vitest.config.ts
**Reviewer:** [OK] Both use the same pinned `@vitejs/plugin-react@6.0.2` with default options — no JSX-transform divergence between dev/build and test runner

### apps/web/index.html, src/App.tsx, src/main.tsx
**Reviewer:** [OK] Entry script path correct relative to `apps/web` as Vite root
**Reviewer:** [OK] `App.tsx` static-only, zero `dangerouslySetInnerHTML`/`localStorage`/`any`
**Reviewer:** [OK] `main.tsx` null-guards `getElementById('root')` before mounting

### apps/web/vitest.setup.ts (unscoped addition)
**Reviewer:** [WARN] Not in tasks.md's literal file list — same accepted pattern as Phase 3/4's unscoped additions; minimal, necessary (registers jest-dom matchers referenced by vitest.config.ts)

### apps/web/e2e/playwright.config.ts
**Reviewer:** [OK] `webServer.cwd: '..'` correctly resolves to `apps/web` from `apps/web/e2e/`
**Reviewer:** [OK] `url`/`baseURL` both match vite.config.ts's port 5173

### apps/web/e2e/smoke.spec.ts
**Reviewer:** [FAIL→RESOLVED, race condition] Reviewer's Glob ran before the concurrently-running tester agent finished writing this file, and reported it missing. Spot-checked directly by main Claude after both agents completed: file exists at `apps/web/e2e/smoke.spec.ts`, content matches the tester's reported output exactly, `testDir: '.'` in playwright.config.ts will discover it correctly. Not a real defect — a genuine race between two concurrently-dispatched background agents, not a gap in the work itself.

### .gitkeep placeholders
**Reviewer:** [OK] All 4 present (routes/, components/, stores/, lib/)

### N/A / cross-cutting checks
**Reviewer:** [OK] Zero `localStorage`, zero `dangerouslySetInnerHTML`, zero `any` anywhere in apps/web
**Reviewer:** [OK] No secrets/credentials in any file
**Reviewer:** [OK] No premature packages/shared duplication — App.tsx/main.tsx make no API calls yet, correctly deferred

**Summary:** 12 [OK], 2 [WARN], 1 [FAIL→resolved as false positive], 0 [SEC]

**Triage:** Case B for the 2 WARNs (accepted, no action, consistent scope-drift precedent). The 1 FAIL was a stale read caused by concurrent-agent timing, not a real gap — resolved by direct spot-check confirming the file exists and is correct. No fix bundle required. Task T36-T45 marked done.

## T46-T47 — Phase 6: Root Test Wiring

**Tester:** [OK] Wrote `scripts/check-pinned-deps.test.ts` (T47), reading all 4 workspace package.json files, allowing `workspace:*` as the sole exception, flagging `^`/`~`/`*`/`latest`. Independently identified a real wiring gap and flagged it clearly rather than silently leaving it broken: `vitest.workspace.ts`'s original `['apps/api', 'apps/web']` array means a root-level `scripts/` test would never be discovered (both sub-configs scope `include` to their own `src/**`).

### vitest.workspace.ts (original)
**Reviewer:** [OK] `['apps/api', 'apps/web']` syntactically valid, both target vitest.config.ts files exist
**Reviewer:** [FAIL→FIXED] Confirmed independently by both tester and reviewer: no project entry covers repo-root `scripts/`, so `scripts/check-pinned-deps.test.ts` would silently never run under `pnpm test`, defeating Scenario S13 and invalidating T57's assumption. **Fix applied**: added a third inline project entry (`{ test: { name: 'root', root: '.', environment: 'node', include: ['scripts/**/*.test.ts'] } }`).

### scripts/check-pinned-deps.test.ts
**Reviewer:** [OK] (initial pass deferred — file didn't exist yet at first check; confirmed sound in follow-up verification below)

**Summary (initial passes):** tester 1 OK; reviewer 2 OK, 1 WARN (deferred), 1 FAIL (workspace gap)

**Triage:** Case A (blocking) → applied the vitest.workspace.ts fix. Follow-up verification pass below.

## T46-T47 Fix Verification — Phase 6 Follow-up

**Reviewer:** [OK] Inline root project's `root: '.'` correctly resolves to repo root (where vitest.workspace.ts itself lives) — vitest.workspace.ts:7
**Reviewer:** [OK] `include: ['scripts/**/*.test.ts']` genuinely matches `scripts/check-pinned-deps.test.ts` — confirmed via Glob
**Reviewer:** [OK] No overlap/double-counting with the apps/api and apps/web entries — each scoped to its own `src/**`
**Reviewer:** [OK] check-pinned-deps.test.ts's path resolution (`fileURLToPath` → `scripts/` → `resolve(..,'..')` → repo root) correctly reaches all 4 real package.json files
**Reviewer:** [OK] Exact-version regex spot-checked against real version strings across all 4 files (express@5.2.1, typescript@6.0.3, @types/node@26.1.1, zod@4.4.3, etc.) — no false-positive rejections
**Reviewer:** [OK] `workspace:*` exception correctly narrow, double-layered (general pinned-check + dedicated workspace-protocol assertion), would reject `workspace:^`/`workspace:~`
**Reviewer:** [OK] No `any`, no secrets in either file

**Summary (follow-up):** 8 [OK], 0 [WARN], 0 [FAIL], 0 [SEC]

**Triage:** Case A → both the workspace-discovery fix and the test file itself confirmed correct via independent re-derivation of Vitest's resolution semantics (not just re-reading the diff). No further action. Task T46-T47 marked done.

## T48-T52 — Phase 7: Docs & AI Workflow Scaffolding

**Tester:** [OK] No dedicated test warranted for README.md/settings.json per se, but identified a legitimate mechanical check: wrote `scripts/check-readme-commands.test.ts`, parsing the README's "Everyday Commands" table and asserting every documented `pnpm <script>` exists as a real root package.json script. Deliberately scoped to only the table (not free-form prose steps like `cp .env.example .env`, which aren't checkable the same way). Manually validated the parsing/assertion logic against the real files (node_modules doesn't exist yet).

### README.md
**Reviewer:** [OK] Every Setup-section command matches an actual script exactly, including byte-for-byte match to AGENTS.md §4's `pnpm --filter api exec prisma migrate dev`
**Reviewer:** [OK] `pnpm --filter web exec playwright test` correct — apps/web has no dedicated e2e script, so direct exec is the only path, not redundant
**Reviewer:** [OK] Setup order (install → db up → env config → migrate → dev → test) matches FR-INFRA-8 verbatim
**Reviewer:** [WARN→FIXED] Everyday Commands table listed bare `pnpm lint` as "zero warnings enforced," but the actual enforced gate is `pnpm lint --max-warnings 0` (Husky/AGENTS.md §4 both use the explicit flag). **Fix applied**: table entry now reads `pnpm lint --max-warnings 0`.
**Reviewer:** [OK] postgres:16.14 claim matches docker-compose.yml; no secrets present

### .claude/settings.json
**Reviewer:** [OK] Valid JSON; pre-existing code-review-graph entry and hooks block both preserved verbatim
**Reviewer:** [OK] New context7 entry's shape consistent with the existing entry's field naming; no secrets committed (value is a literal `${VAR}` reference, not a real key)

### .env.example / settings.json consistency
**Reviewer:** [WARN] `${CONTEXT7_API_KEY}` substitution resolves from Claude Code's own launcher process env, a different environment than the project's `apps/api/.env` (no dotenv-loading mechanism exists anywhere in the repo — `env.ts` reads `process.env` directly). Setting the var in the project `.env` would NOT flow through to this MCP config without separately exporting it in the developer's actual shell. Low severity: spec.md explicitly scopes this ticket as unauthenticated-only (Non-Goal), so no functional break exists today — flagged so it isn't assumed to "just work" later without revisiting the docs.

### T50/T51/T52 — Agent & command verification
**Reviewer:** [OK] reviewer.md's `disallowedTools: Write, Edit, Bash` confirmed present, satisfies FR-INFRA-9's read-only requirement
**Reviewer:** [WARN] test-writer.md's "restricted to test file paths" is enforced only via prose instruction, not a structural tool-permission boundary (unlike reviewer.md's hard `disallowedTools`) — accepted as a known asymmetry, no immediate action; revisit only if the tester agent is observed writing outside test paths in practice.
**Reviewer:** [OK] All 7 command files confirmed present

### N/A checks
**Reviewer:** [OK] Layer-skipping, duplicated types, `any`, `dangerouslySetInnerHTML`, physical deletion — all N/A, no application logic touched

**Summary:** 13 [OK], 3 [WARN], 0 [FAIL], 0 [SEC]

**Triage:** Case B → fixed the trivial README wording drift immediately (one-line edit); accepted the other two WARNs as low-severity/consistent-with-scope, no fix bundle needed for those. Task T48-T52 marked done.

## T53-T58 — Phase 8: Install & End-to-End Verification

This is the first phase where code actually runs against real tooling (not just code review/reasoning), and it surfaced several real bugs that no amount of static review could have caught. Documented in full since these are load-bearing decisions for AB-1002+.

### T53 — `pnpm install`
**Finding:** pnpm 11's build-script approval gate blocked native postinstall scripts for `esbuild`, `@prisma/engines`, `prisma`, `@prisma/client` — auto-generated an `allowBuilds` placeholder in `pnpm-workspace.yaml`. **Fix:** approved all four (legitimate native binaries, not suspicious). Install then succeeded (620 packages).
**Finding:** Node version mismatch — pinned `22.23.1`, actual installed `v22.22.0` (non-blocking warning). **Fix (user-approved):** relaxed `.nvmrc`/`package.json` engines to `22.22.0` to match the real reproducible environment.

### T54 — Prisma migration
**Major finding:** Prisma 7 removed `datasource { url = env(...) }` support in `schema.prisma` entirely — requires a `prisma.config.ts` + driver adapter (`@prisma/adapter-pg`) for both CLI and runtime `PrismaClient` construction. None of SDS/FRS anticipate this. **Decision (user-approved):** downgraded to `prisma`/`@prisma/client@6.19.3` — the last version supporting the classic pattern the SDS docs assume, at the cheapest possible point (zero models exist yet).
**Second finding:** Prisma CLI's `.env` auto-detection only checks its own project directory (`apps/api/`), not the monorepo root where the actual `.env` lives — this affects the app runtime too (`tsx watch` has no env-file loading at all). **Fix (user-approved):** added `dotenv-cli@11.0.0`, wrapped both `apps/api`'s `dev` and new `prisma:migrate` scripts with `dotenv -e ../../.env --`. Updated root `db:reset` and `AGENTS.md` §4 to reference the new script name.
**Result:** migration ran cleanly against `notes_dev`, "Already in sync" (correct — zero models), Prisma Client generated successfully.

### T55 — `pnpm dev` boot check
**Result:** Clean. API logged `"API listening on port 3001"` via pino; Vite ready on 5173. Verified via curl: API root returns the expected `404 NOT_FOUND` `ApiError` JSON from the catch-all router; web root serves `index.html` with Vite's dev injection, title "NoteApp", `#root` + `main.tsx` script tag (full client render verified separately by the Playwright smoke test, not raw curl).

### T56 — `pnpm lint --max-warnings 0`
**Findings (3 real bugs in eslint.config.js, none previously caught by review since nothing was installed to lint against):**
1. `env.ts`: `'NodeJS' is not defined (no-undef)` — ESLint's base JS-level `no-undef` rule can't see TypeScript ambient type namespaces. **Fix:** `'no-undef': 'off'` for TS files (TypeScript's own compiler already checks this — standard typescript-eslint guidance).
2. `errorHandler.ts`: `'_next' is defined but never used` — the `_`-prefix "intentionally unused" convention isn't automatic. **Fix:** `argsIgnorePattern: '^_'` on `@typescript-eslint/no-unused-vars`.
3. 8 parsing errors ("not found by the project service") on every root/tooling config file (`vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `vitest.setup.ts`, `scripts/*.test.ts`, etc.) — caused by an unnecessary `parserOptions.projectService: true` that requires every linted file to belong to some tsconfig's `include`, which config/tooling files deliberately don't. **Fix:** removed `projectService` entirely — it was never needed since only non-type-aware `recommended` rules are used, not `recommended-type-checked`.
**Result after fixes:** clean, exit 0.

### T57 — `pnpm test --coverage`
**Findings (5 distinct real bugs, resolved across several rounds):**
1. `scripts/check-readme-commands.test.ts`: broke after the Phase 7 README fix (`pnpm lint --max-warnings 0`, 4 tokens) violated the test's hardcoded 2-token assumption. **Fix (tester agent):** relaxed to `toBeGreaterThanOrEqual(2)`, checking `parts[0]==='pnpm'` and `parts[1]` is a real script name regardless of trailing flags.
2. `apps/api/src/middleware/errorHandler.test.ts`: classic `vi.mock` hoisting bug — factory referenced a top-level class not yet initialized at hoist time. **Fix (tester agent):** moved the mock class inside `vi.hoisted(() => {...})`.
3. **Major, multi-round finding:** `apps/web/e2e/smoke.spec.ts` (a Playwright file) was being collected and executed by **Vitest**, throwing "Playwright Test did not expect test() to be called here." Root cause, found only after extensive diagnosis: **Vitest 4 removed the standalone `vitest.workspace.ts` mechanism entirely** (deprecated since 3.2, removed in 4.0 — confirmed via `--workspace` now being an unrecognized CLI flag) — it's replaced by a `test.projects` array inside a normal root `vitest.config.ts`. The old `vitest.workspace.ts` was being silently mishandled rather than erroring outright, producing confusing partial/inconsistent behavior. **Fix:** deleted `vitest.workspace.ts`, created root `vitest.config.ts` with `test.projects: ['apps/api/vitest.config.ts', 'apps/web/vitest.config.ts', {inline scripts project}]`. Also hardened `apps/web/vitest.config.ts` with an explicit `exclude: [...configDefaults.exclude, '**/e2e/**']` as defense in depth.
4. **Process error, not a code bug:** partway through diagnosing #3, an earlier `cd apps/web && npx vitest run` diagnostic command changed the Bash tool's *persistent* working directory, and subsequent commands (assumed to run from repo root) were silently running from `apps/web/` instead — producing several rounds of confusing, seemingly-unfixable identical failures. Caught by running `pwd` explicitly; fixed by explicitly `cd`-ing back to repo root before continuing. Documented here as a process lesson, not a code defect.
**Result after all fixes:** 5 test files passed, 42 tests passed, 100% statement/branch/function/line coverage on everything covered.

### T58 — Playwright smoke test
**Finding:** `apps/web/e2e/playwright.config.ts` was never actually being loaded — Playwright's auto-discovery looks for `playwright.config.ts` at the package root (`apps/web/`), not in a subdirectory. It silently fell back to built-in defaults (no `baseURL`), causing `page.goto('/')` to fail with "Cannot navigate to invalid URL" since the relative path was never resolved against a base. **Fix (user-approved):** moved the config to `apps/web/playwright.config.ts` (the conventional location), with `testDir: './e2e'` and `webServer.cwd: '.'` adjusted accordingly; deleted the old location.
**Result after fix:** installed Chromium via `playwright install chromium`, ran the suite — 1 passed, confirming the placeholder heading renders correctly in a real browser against the real dev server.

**Summary:** No [SEC] findings. Every failure found here was a real, load-bearing infrastructure bug (Prisma major-version incompatibility, missing env-file loading, ESLint misconfiguration, a major-version tooling removal in Vitest 4, and a config-file-location convention miss) — none were caught by static review because none were executable until this phase. This validates why AB-1001's plan explicitly scoped Phase 8 as the final, mandatory verification gate rather than optional.

**Triage:** All fixes applied and re-verified by actually re-running the affected commands (not just reasoning about them). T53-T58 marked done.

### T59-T60 — Husky/commitlint live-fire verification
**Status: SKIPPED per explicit user choice** at the start of Phase 8 execution — the user opted to run T53-T58 only and defer the git-touching verification steps (which would have required `git add`/`git commit`/`git reset` operations under CLAUDE.md's explicit-permission-per-git-command rule). Also still outstanding from Phase 2: `.husky/pre-commit`'s executable bit does not persist via `chmod` on this Windows/git-bash environment — resolving this was deferred to T59, which itself is now deferred. **Not verified. Recommend running these manually, or resuming /implement for just T59-T60, before relying on the pre-commit hook actually firing.**

### Build gate (`pnpm build`, per /implement's closing step)
**Finding:** `tsconfig.base.json`'s `declaration: true`/`declarationMap: true` caused 4 TS2883 errors in `apps/api` ("inferred type cannot be named without a reference to X... not portable") — a TypeScript diagnostic that fires when a function's inferred return type transitively references a type from a package not directly imported, and declaration emission is on. **Root-cause fix (user-approved):** removed `declaration`/`declarationMap` from `tsconfig.base.json` entirely rather than annotating each function — nothing in this monorepo actually needs emitted `.d.ts`: `packages/shared` is consumed by other workspace packages via its `exports` map pointing directly at `.ts` source (TypeScript reads that source directly under `moduleResolution: "Bundler"`), and `apps/api`/`apps/web` are leaf applications never imported by anything else.
**Result:** `pnpm build` passes cleanly for both `apps/api` (`tsc`) and `apps/web` (`vite build`, 15 modules, 190.53 kB bundle). Re-confirmed `pnpm lint --max-warnings 0` (exit 0) and `pnpm test --coverage` (5 files, 42 tests, 100% coverage) still pass after this change — no regression.

**Phase 8 fully verified**: T53-T58 all genuinely re-run and passing after every fix; build gate passing; T59-T60 remain explicitly skipped per user choice.
