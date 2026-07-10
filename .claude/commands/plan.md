Ticket ID: $ARGUMENTS

You are creating a technical plan for an approved spec.

Steps:
1. Read openspec/changes/$ARGUMENTS/spec.md (and delta-openapi.yaml if backend).
2. Verify spec.md has status: APPROVED. If not, STOP.
3. Read CLAUDE.md and existing code structure.
4. GRAPH LOOKUP: Run `get_architecture_overview` and `query_graph` to find existing schemas/types in `packages/shared/src` to ensure REUSE (no duplication).
5. Generate openspec/changes/$ARGUMENTS/plan.md with:
   - Files to create/modify (full paths. Backend must follow routes→controllers→services).
   - Prisma schema changes (No physical deletes, use `deletedAt`).
   - New packages (exact pinned versions)
   - Dependencies on prior tickets
   - Risk areas
   - Test strategy (which scenarios → which test files)

Ask [y/n] before writing plan.md.
After writing, STOP:
"Plan drafted. Mark status: APPROVED before /tasks."
