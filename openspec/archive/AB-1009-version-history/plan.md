---
ticket: AB-1009
status: APPROVED
---

# AB-1009: Version History Architecture — Implementation Plan

## Files to Create

**Service layer**
- `apps/api/src/services/versions.service.ts`
  - `listVersions(prisma, userId, noteId): Promise<NoteVersion[]>` — `findFirst({ id, userId })` (no `deletedAt` filter), then `noteVersion.findMany({ where: { noteId }, orderBy: { savedAt: 'desc' } })`. Throws `NOTE_NOT_FOUND` (404) if the note lookup fails.
  - `getVersion(prisma, userId, noteId, versionId): Promise<NoteVersion>` — same note lookup, then `noteVersion.findFirst({ where: { id: versionId, noteId } })`. Throws `NOTE_NOT_FOUND` or `VERSION_NOT_FOUND` (404).
  - `restoreVersion(prisma, userId, noteId, versionId): Promise<NoteWithTags>` — note lookup (no `deletedAt` filter) + version lookup, then a `prisma.$transaction` mirroring `notes.service.ts:updateNote`'s snapshot-then-mutate shape: (1) `noteVersion.create` snapshotting the note's *current* `title`/`body`/`version`, (2) `note.update` setting `title`/`body`/`bodyText` (via `extractPlainText`, reused from `../lib/tiptap`) to the target version's content and `version: { increment: 1 }`. No `NoteTag` operations. Re-fetches with `TAGS_INCLUDE` and returns, matching `updateNote`'s return shape.
  - Reuses `NoteWithTags`, `TAGS_INCLUDE`, and `notFound()` conventions already in `notes.service.ts` — import rather than duplicate where the same shape applies; add a local `versionNotFound()` for the new code.

**Controller layer**
- `apps/api/src/controllers/versions.controller.ts`
  - `createVersionsController()` (no env dependency, mirrors `notes.controller.ts`'s no-arg factory shape rather than `shares.controller.ts`'s env-dependent one, since version responses need no `WEB_ORIGIN`-style host config).
  - `list` → `200 NoteVersionSummary[]` (`id`, `version`, `title`, `savedAt` — omits `body`, `noteId`).
  - `preview` → `200 NoteVersionDetail` (`id`, `version`, `title`, `body`, `savedAt`).
  - `restore` → `200 Note`, reusing `toNoteResponse` exported from `notes.controller.ts` (avoids duplicating the `Note` response mapping).
  - Local `getIdParam`/`getVersionIdParam` helpers matching the existing `req.params.x as string` pattern.

**Route layer**
- `apps/api/src/routes/versions.router.ts` — `Router({ mergeParams: true })`, mirrors `shares.router.ts` exactly:
  ```ts
  router.get('/', controller.list);
  router.get('/:versionId', controller.preview);
  router.post('/:versionId/restore', controller.restore);
  ```
- `apps/api/src/routes/notes.router.ts` (modify) — add `router.use('/:id/versions', createVersionsRouter());` alongside the existing `shares` mount, after `requireAuth`. No new auth call (inherited, same as `shares.router.ts`).

**Shared package**
- `packages/shared/src/errorCodes.ts` (modify) — add `VERSION_NOT_FOUND: 'VERSION_NOT_FOUND'` to the `ErrorCodes` object.
- `packages/shared/src/types.ts` (modify) — add:
  ```ts
  export interface NoteVersionSummary {
    id: string;
    version: number;
    title: string;
    savedAt: string;
  }

  export interface NoteVersionDetail extends NoteVersionSummary {
    body: TipTapDocument;
  }
  ```

**Scheduled job**
- `apps/api/src/lib/jobs/purgeVersions.ts` — mirrors `purgeNotes.ts` structure exactly: `purgeVersions(prismaClient)` computes `cutoff = now - 90 days`, runs `prisma.noteVersion.deleteMany({ where: { savedAt: { lt: cutoff } } })`, logs `[purgeVersions] Permanently deleted N version(s) past the 90-day retention window`, returns `{ purgedCount }`. `schedulePurgeVersionsJob(env: Pick<Env, 'PURGE_CRON_SCHEDULE'>)` calls `schedule(env.PURGE_CRON_SCHEDULE, ...)` independently (own `schedule()` call, own try/catch — not merged into `purgeNotes`'s callback).
- `apps/api/src/server.ts` (modify) — import and call `schedulePurgeVersionsJob(env)` right after `schedulePurgeNotesJob(env)`, inside the same `if (env.NODE_ENV !== 'test')` guard.

## Prisma Schema Changes

**None.** `NoteVersion` (fields, indexes, `Note.versions` back-relation, `onDelete: Cascade`) already exists from AB-1004 (`apps/api/prisma/schema.prisma`). No migration required for this ticket.

## New Packages

**None.** `node-cron@4.6.0` is already an exact-pinned dependency of `apps/api` (used by `purgeNotes.ts`); `purgeVersions.ts` reuses it with no new install.

## Dependencies on Prior Tickets

- **AB-1004** (merged) — `NoteVersion` model, `Note` relation, and the `updateNote` snapshot transaction this ticket's `restoreVersion` mirrors.
- **AB-1008** (merged) — `shares.router.ts`/`shares.controller.ts`/`shares.service.ts` are the direct structural templates for the new nested-router/controller/service trio, and `listShareLinks`'s "ignore `deletedAt`" precedent is what this ticket's version endpoints extend.
- No dependency on AB-1006/AB-1007 (tags/search) — untouched by this ticket.
- **AB-1015** (Version History Frontend, not started) will depend on the API contract shipped here.

## Risk Areas

1. **Restore transaction correctness under concurrency** — two concurrent restores on the same note must both succeed with two independent version increments and two distinct snapshots (spec Scenario 13). Same risk class `updateNote` already carries; mitigated by the same `$transaction` array pattern (Prisma wraps it in a single DB transaction, no read-modify-write gap once the transaction starts). Needs a real-Postgres integration test — cannot be verified with a mocked Prisma client.
2. **Trash-state-ignored lookups drifting from the `Note` service's own trash rules** — `versions.service.ts` deliberately does *not* filter `deletedAt`, unlike `getNote`/`updateNote`. A future refactor that "fixes" this by copy-pasting `notes.service.ts`'s lookup helper would silently break FR-VER-1. Mitigate with an explicit code comment (matching `shares.service.ts:listShareLinks`'s existing comment) and a dedicated test asserting trash notes are still readable/restorable.
3. **`purgeVersions.ts` cascade blast radius** — must never delete a `Note` row itself (spec Scenario 16). Since `NoteVersion.note` has `onDelete: Cascade` in the *other* direction (Note → NoteVersion, not NoteVersion → Note), `purgeVersions`'s `deleteMany` on `NoteVersion` cannot cascade into `Note` — but this should still be asserted by a test rather than left as an inference from the schema.
4. **`VERSION_NOT_FOUND` vs `NOTE_NOT_FOUND` ordering** — controller/service must check note ownership *before* version existence, so an unowned note with a valid-looking `versionId` still returns `NOTE_NOT_FOUND` (not a `VERSION_NOT_FOUND` that would leak whether the note exists). `getVersion`/`restoreVersion`'s two-step lookup order enforces this; needs an explicit test (spec Scenario 7/12 already cover the unowned-note case — test must assert the *code*, not just the status, to catch a swapped check).

## Test Strategy

| Scenario(s) | Test file | Tier |
|---|---|---|
| 1, 2, 3, 4 | `apps/api/src/services/versions.service.test.ts` (`listVersions`) | Unit (mocked Prisma) |
| 5, 6, 7 | `apps/api/src/services/versions.service.test.ts` (`getVersion`) | Unit (mocked Prisma) |
| 8, 9, 10, 11, 12 | `apps/api/src/services/versions.service.test.ts` (`restoreVersion`) | Unit (mocked Prisma) — transaction call shape/args asserted via mock |
| 1–12 (response mapping, status codes) | `apps/api/src/controllers/versions.controller.test.ts` | Unit (service mocked) |
| 3, 8, 9, 10, 13 | `apps/api/src/routes/versions.integration.test.ts` | Integration (real `notes_test` Postgres via Supertest) — 13 specifically requires real transactional concurrency, cannot be mocked |
| 14 | `apps/api/src/routes/versions.integration.test.ts` (or covered generically by existing `requireAuth` middleware tests — confirm no duplicate coverage needed) | Integration |
| 15, 16 | `apps/api/src/lib/jobs/purgeVersions.test.ts` | Integration (real Postgres, mirrors `purgeNotes.test.ts`'s boundary-test style exactly: 91-days-old vs. 90-days-23-hours-old rows) |

Coverage gate: ≥80% on all new files (`versions.service.ts`, `versions.controller.ts`, `versions.router.ts`, `purgeVersions.ts`), enforced via the existing Husky pre-commit hook — no new tooling needed.

## Open Questions

None.
