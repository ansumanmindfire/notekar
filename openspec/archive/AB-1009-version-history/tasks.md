---
ticket: AB-1009
status: APPROVED
---

# AB-1009: Version History Architecture — Tasks

Ordered so each task is independently testable. `[PARALLEL]` = no dependency on sibling tasks in its group, safe to do out of order or concurrently. `[SUBAGENT]` = estimated >45 min, candidate for delegation.

- [x] **T1. Add `VERSION_NOT_FOUND` error code** (5 min) `[PARALLEL]`
  Add `VERSION_NOT_FOUND: 'VERSION_NOT_FOUND'` to the `ErrorCodes` object.
  Satisfies: infra for scenarios 6, 11.
  Files: `packages/shared/src/errorCodes.ts`

- [x] **T2. Add `NoteVersionSummary`/`NoteVersionDetail` shared types** (10 min) `[PARALLEL]`
  Add both interfaces (summary = `id`/`version`/`title`/`savedAt`; detail extends summary with `body`).
  Satisfies: infra for scenarios 1, 5.
  Files: `packages/shared/src/types.ts`

- [x] **T3. Implement `versions.service.ts`** (40 min)
  `listVersions`, `getVersion`, `restoreVersion` per plan.md's "Files to Create" section — note lookup ignores `deletedAt` (with an explicit comment matching `shares.service.ts:listShareLinks`'s precedent, per plan.md Risk #2), version lookup scoped to `noteId`, restore uses the `$transaction` snapshot-then-mutate shape mirroring `updateNote`. Depends on T1, T2.
  Satisfies: scenarios 1–4 (list), 5–7 (preview), 8–12 (restore).
  Files: `apps/api/src/services/versions.service.ts`

- [x] **T4. Unit tests for `versions.service.ts`** (40 min)
  Mocked-Prisma tests for all three functions, including the ordering check from plan.md Risk #4 (unowned note + valid `versionId` → `NOTE_NOT_FOUND`, not `VERSION_NOT_FOUND`) and the trash-state-ignored case (Risk #2). Depends on T3.
  Satisfies: scenarios 1–12.
  Files: `apps/api/src/services/versions.service.test.ts`

- [x] **T5. Implement `versions.controller.ts`** (20 min) `[PARALLEL]` (parallel with T4 — both depend only on T3)
  `list`/`preview`/`restore` handlers; `restore` reuses `toNoteResponse` imported from `notes.controller.ts`. Depends on T3.
  Satisfies: response-shape portion of scenarios 1, 5, 8.
  Files: `apps/api/src/controllers/versions.controller.ts`

- [x] **T6. Unit tests for `versions.controller.ts`** (25 min)
  Service-layer mocked; asserts status codes and response bodies for all three handlers and their error paths. Depends on T5.
  Satisfies: scenarios 1–12 (HTTP-shape assertions only; business logic already covered by T4).
  Files: `apps/api/src/controllers/versions.controller.test.ts`

- [x] **T7. Implement `versions.router.ts`** (10 min)
  `Router({ mergeParams: true })` mirroring `shares.router.ts`, wiring `GET /`, `GET /:versionId`, `POST /:versionId/restore`. Depends on T5.
  Files: `apps/api/src/routes/versions.router.ts`

- [x] **T8. Mount versions router under `notes.router.ts`** (5 min)
  Add `router.use('/:id/versions', createVersionsRouter());` alongside the existing `shares` mount, after `requireAuth`. Depends on T7.
  Files: `apps/api/src/routes/notes.router.ts`

- [x] **T9. Integration tests for the versions routes** (50 min) `[SUBAGENT]`
  Supertest against real `notes_test` Postgres: trash-state-ignored list/preview/restore (scenario 3, 10), concurrent-restore double-increment (scenario 13, the one case a mock can't prove), tags-untouched-after-restore (scenario 9), and the 401 case (scenario 14) if not already covered by existing `requireAuth` integration tests — check for duplicate coverage first. Depends on T8.
  Satisfies: scenarios 3, 8, 9, 10, 13, 14.
  Files: `apps/api/src/routes/versions.integration.test.ts`

- [x] **T10. Implement `purgeVersions.ts` job** (15 min) `[PARALLEL]` (independent of T1–T9 — only depends on the pre-existing `NoteVersion` model)
  `purgeVersions(prismaClient)` + `schedulePurgeVersionsJob(env)`, structurally identical to `purgeNotes.ts` (own `schedule()` call, own logging, 90-day cutoff instead of 30-day).
  Files: `apps/api/src/lib/jobs/purgeVersions.ts`

- [x] **T11. Integration tests for `purgeVersions.ts`** (30 min)
  Mirrors `purgeNotes.test.ts`'s boundary-test style: purges rows >90 days old, leaves rows at/under the boundary untouched, and asserts no `Note` row is ever deleted (plan.md Risk #3). Depends on T10.
  Satisfies: scenarios 15, 16.
  Files: `apps/api/src/lib/jobs/purgeVersions.test.ts`

- [x] **T12. Register the purge job in `server.ts`** (5 min)
  Import `schedulePurgeVersionsJob` and call it immediately after `schedulePurgeNotesJob(env)`, inside the same `NODE_ENV !== 'test'` guard. Depends on T10.
  Files: `apps/api/src/server.ts`

## Suggested Execution Order

T1, T2 → T3 → { T4, T5 } → T6 → T7 → T8 → T9. T10 can start any time in parallel with the T1–T9 chain; T11 and T12 follow T10.
