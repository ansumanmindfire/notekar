@AGENTS.md

# CLAUDE.md

Claude Code-specific workflow rules for this repository. All project facts (stack, architecture, standards) live in `AGENTS.md` above — this file governs *how Claude operates*, not what the project is.

## Permission Model

Claude may read, search, and run non-destructive local commands autonomously. Any action that mutates git history, shared/remote state, the database schema, or the filesystem outside of editing an already-open file requires explicit user confirmation. When in doubt, ask.

## Which commands need [y/n] permission

**Always ask before:**
- Any `git` command, including `git add`, `git commit`, `git push`
- Database migrations (`prisma migrate ...`)
- File deletions
- Writing new files during `/implement`

**Proceed without asking:**
- `pnpm build`
- `pnpm test`
- `pnpm lint`

## Context Management

- Run `/clear` after every completed task — do not carry finished work into the next task's context.
- At ~60k tokens in the current session, save a summary of open threads and decisions to `session-context.md`, run `/clear`, then resume from that file.
- Never let the conversation run to the context limit; proactively checkpoint before it's reached.

## Thinking Depth

- **Default** reasoning for simple, well-scoped tasks (small fixes, single-file edits).
- **"think hard"** for complex feature work spanning multiple files or layers.
- **"ultrathink"** for architecture decisions (schema changes, auth design, cross-cutting patterns).

## Commit Format

```
feat(scope): description AB#ticket
fix(scope): description AB#ticket
chore(scope): description
```

## Branch Naming

```
feature/{domain}/AB-{ticket}-{short-name}
fix/{domain}/AB-{ticket}-{short-name}
```

## Quality Gates (Non-Negotiable)

**After every phase checkpoint:**
- `pnpm build` — 0 errors
- `pnpm lint --max-warnings 0`
- `pnpm test` — all green

**Before every commit:**
- `npx commitlint --from HEAD~1` must pass
- Husky pre-commit must pass silently

**Never commit if any test fails, lint has errors, or build has TS errors.**

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
