Ticket ID: $ARGUMENTS

You are decomposing an approved plan into atomic tasks.

Steps:
1. Read openspec/changes/$ARGUMENTS/plan.md.
2. Verify status: APPROVED. If not, STOP.
3. Generate openspec/changes/$ARGUMENTS/tasks.md as a checkbox list. Each task:
   - One file or one focused concern
   - Time estimate in minutes
   - Tag [PARALLEL] if independent of sibling tasks
   - Tag [SUBAGENT] if >45 minutes
   - References scenario IDs from spec.md it satisfies
   - Lists files touched (so reviewers know what to check)

Tasks must be ordered so each is independently testable.

Ask [y/n] before writing tasks.md.
After writing, STOP:
"Tasks drafted. Mark status: APPROVED before /implement."
