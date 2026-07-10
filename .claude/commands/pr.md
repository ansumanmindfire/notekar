Ticket ID: $ARGUMENTS

You are preparing a pull request. You DRAFT git commands; the user EXECUTES them. You never run git yourself.

Preconditions (verify all before proceeding):
1. openspec/changes/$ARGUMENTS/review-log.md shows no unresolved [FAIL] or [SEC]
2. openspec/changes/$ARGUMENTS/fix-bundles.md entries all marked APPLIED
3. openspec validate passes
4. pnpm build: 0 errors, 0 warnings
5. pnpm lint --max-warnings 0
6. pnpm test --coverage ≥80% on new code
7. python -m code_review_graph build (generates latest insights)
8. openspec archive $ARGUMENTS done
9. spec.md and FRS.md in sync with code
10. User is on a branch named like `<type>/$ARGUMENTS-<slug>`
   (Read branch from shell output or ask user). The `<type>`
   prefix (feat/chore/test/fix/docs/refactor/perf/ci) should match
   the dominant commit type for this ticket.

If any precondition fails, STOP and list what's missing.

Generate FOUR things for the user:

PART 1 — Grouped commit messages
   Inspect repo state using Read tools or ask the user for `git status` output.
   Group changes into logical commits (one concern per commit):
     - Shared types/schemas → first
     - Prisma migrations → second
     - Service layer → third
     - Controllers/routes/middleware → fourth
     - Tests → fifth
     - Docs/spec archive/FRS updates → sixth

   For each group, output a paste-ready block:

     git add <files>
     git commit -m "<type>(<scope>): <description> $ARGUMENTS"

   Use conventional commit types:
     feat (new feature) | fix (bug) | test (tests) | docs (docs/spec)
     chore (tooling/config) | refactor | perf | ci

PART 2 — Push command

     git push -u origin <type>/$ARGUMENTS-<slug>

PART 3 — PR title and body

   Title:
     <type>(<scope>): <description> $ARGUMENTS

   Body sections:
     ## FRs Covered
     - FR-AUTH-1 (register)
     ...

     ## Scenarios Tested
     - AUTH-LOGIN-S1..S4 → apps/api/tests/auth.login.test.ts
     ...

     ## Spec/FRS Changes During Implementation
     - Bundle #2: ...
     (If no bundles edited spec/FRS, write "None — implementation matched approved spec exactly.")

     ## Watcher Summary
     - {N} fix bundles applied
     - 0 unresolved [FAIL] or [SEC]
     - Coverage: <pct>% on new code
     
     ## Code Graph Highlights
     - Summarize architectural insights from code-review-graph

PART 4 — gh CLI command to open the PR

     gh pr create \
       --title "<title from PART 3>" \
       --body-file - <<'EOF'
     <body from PART 3>
     EOF

After outputting these four parts, STOP. Tell the user:
"Paste the commits one block at a time. The Husky pre-commit hook will run typecheck + lint + test for each. After all commits succeed, paste the push command, then the gh pr create command."

DO NOT run git commands yourself. DO NOT use Bash to execute any git operation. This includes status, diff, log — read-only commands too.
Use Read/Grep to inspect repo state or ask the user if needed.
