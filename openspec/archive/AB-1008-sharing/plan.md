---
ticket: AB-1008
status: APPROVED
---

# AB-1008: Sharing Architecture — Technical Plan

## Files to Create/Modify

### `packages/shared` (single source of truth — edit first, everything else imports from here)

| File | Change |
|---|---|
| `packages/shared/src/errorCodes.ts` | Add `SHARE_NOT_FOUND: 'SHARE_NOT_FOUND'` and `GONE_LINK_INVALID: 'GONE_LINK_INVALID'` to `ErrorCodes`. |
| `packages/shared/src/schemas.ts` | Add `createShareLinkSchema = z.object({ expiresAt: z.string().datetime().optional() })` — format validation only (ISO 8601 datetime string). The 1–30-day *range* check is a time-dependent business rule (depends on `now()` at request time) and lives in `shares.service.ts`, not the schema, mirroring how OTP expiry is checked in `auth.service.ts` rather than in `resetPasswordSchema`. Export inferred type `CreateShareLinkInput`. Exact zod v4 datetime API (`z.iso.datetime()` vs `z.string().datetime()`) must be confirmed against Context7 during `/implement` (AGENTS.md FR-INFRA-9) — the schema's public shape (`expiresAt?: string`) does not change either way. |
| `packages/shared/src/schemas.test.ts` | Add unit tests for `createShareLinkSchema`: valid ISO datetime, omitted `expiresAt`, malformed datetime string. |
| `packages/shared/src/types.ts` | Add `CreatedShareLink { token; shareUrl; expiresAt; viewCount }`, `ShareLink { id; token; shareUrl; expiresAt; revokedAt: string \| null; viewCount; createdAt }`, `PublicShareView { title; body: TipTapDocument; viewCount; sharedAt }` interfaces — reusing the existing `TipTapDocument` type, no new date/pagination wrapper needed (the owner-list endpoint returns a plain array per SDS §4, not a `Page<T>`). |

### `apps/api/prisma`

| File | Change |
|---|---|
| `apps/api/prisma/schema.prisma` | Add `model ShareLink` exactly as specified in `spec.md` § Data Model (fully Prisma-representable — unlike search/tags, no raw SQL is needed for the model itself). Add `shares ShareLink[]` back-relation to the existing `Note` model. |
| `apps/api/prisma/migrations/<ts>_share_links/migration.sql` | Standard Prisma-generated migration (`prisma migrate dev --name share_links`, not `--create-only` — no hand-editing needed since this is a normal table + FK + index, unlike the raw-SQL tag/search migrations). Applied to both `notes_dev` (`DATABASE_URL`) and `notes_test` (`TEST_DATABASE_URL`), same dual-database flow as every prior ticket (SDS §2.2/§18). |

### `apps/api/src` — Sharing (new vertical slice, routes → controllers → services)

| File | Change |
|---|---|
| `apps/api/src/lib/shareToken.ts` | New. `generateShareToken(): string` — `randomBytes(24).toString('base64url')` (32 URL-safe chars). Separate file from `lib/refreshToken.ts` since it's a distinct token concern (no hashing-at-rest, no `familyId`), matching the codebase's one-concern-per-lib-file convention (`jwt.ts`, `cookie.ts`, `otp.ts`, `refreshToken.ts`). |
| `apps/api/src/lib/shareToken.test.ts` | New. Confirms output length/charset and that two calls produce different tokens. |
| `apps/api/src/services/shares.service.ts` | New. Exports: `createShareLink(prisma, userId, noteId, input, defaultDays=7, maxDays=30)` — looks up the note via `{ id: noteId, userId, deletedAt: null }` (reuses the same active-note lookup shape as `getNote`/`updateNote` in `notes.service.ts`), throws `404 NOTE_NOT_FOUND` if missing; validates `expiresAt` (if provided) is strictly after `now()` and no more than 30 days out, throwing `400 VALIDATION_FAILED` otherwise; defaults to `now() + 7 days` if omitted; generates a token via `generateShareToken()` and creates the row. `revokeShareLink(prisma, userId, noteId, token)` — owner-scoped lookup by `{ token, noteId, note: { userId } }` (no `deletedAt` filter — trash state doesn't matter for revoke), `404 SHARE_NOT_FOUND` if no match; sets `revokedAt: new Date()` only if not already revoked (idempotent no-op otherwise), never a physical delete. `listShareLinks(prisma, userId, noteId)` — owner-scoped note lookup by `{ id: noteId, userId }` (no `deletedAt` filter), `404 NOTE_NOT_FOUND` if missing/unowned; returns all `ShareLink` rows for the note ordered `createdAt desc`. `viewPublicShare(prisma, token)` — runs the atomic raw-SQL `UPDATE ... RETURNING` statement from `spec.md` § Data Model via `prisma.$queryRaw`/`Prisma.sql` (parameterized, never string-concatenated); if it returns no row, throws `410 GONE_LINK_INVALID`; otherwise re-fetches the parent `Note`'s `title`/`body` for the response. |
| `apps/api/src/services/shares.service.test.ts` | New. Unit tests, Prisma mocked — covers the `expiresAt` range validation (boundary cases: exactly `now()`, exactly 30 days, 30 days + 1ms), default-7-days computation, owner/soft-delete branching for create vs. list/revoke, idempotent re-revoke, and that the raw view query is invoked via `Prisma.sql` (injection-safety regression guard, mirroring `search.service.test.ts`'s existing check). |
| `apps/api/src/controllers/shares.controller.ts` | New. `createSharesController(env: Pick<Env, 'WEB_ORIGIN'>)` factory (mirrors `createAuthController(env)`), returning `{ create, list, revoke }` — owner-facing, all read `req.params.id` (mergeParams-inherited) and `req.userId!`. `create`: parses body with `createShareLinkSchema`, calls `createShareLink`, maps the created row to `CreatedShareLink` with `shareUrl: \`${env.WEB_ORIGIN}/shares/${token}\``, responds `201`. `list`: calls `listShareLinks`, maps each row to `ShareLink` (same `shareUrl` construction), responds `200` with a plain array (not `Page<T>`). `revoke`: reads `req.params.token`, calls `revokeShareLink`, responds `204`. |
| `apps/api/src/controllers/shares.controller.test.ts` | New. Mirrors `tags.controller.test.ts` conventions: validation-error passthrough, correct `shareUrl` construction from an injected `WEB_ORIGIN`, correct status codes per action. |
| `apps/api/src/controllers/public.controller.ts` | New. `createPublicController()` (no env needed), single `view(req, res, next)`: calls `viewPublicShare(prisma, req.params.token)`, maps to `PublicShareView { title, body, viewCount, sharedAt: createdAt.toISOString() }`, responds `200`. |
| `apps/api/src/controllers/public.controller.test.ts` | New. `410` passthrough on service throw, correct response mapping on success. |
| `apps/api/src/routes/shares.router.ts` | New. `Router({ mergeParams: true })` — **no** `requireAuth` call here; auth is inherited from the parent `notes.router.ts`'s existing `router.use(requireAuth(env.JWT_SECRET))`, which already runs before this sub-router is reached. Routes: `POST /` → `controller.create`, `GET /` → `controller.list`, `DELETE /:token` → `controller.revoke`. |
| `apps/api/src/routes/notes.router.ts` | Modify. Widen `NotesRouterEnv` from `Pick<Env, 'JWT_SECRET'>` to `Pick<Env, 'JWT_SECRET' \| 'WEB_ORIGIN'>`. Add `router.use('/:id/shares', createSharesRouter(env));` (registered alongside the existing `/:id/restore` route — no ordering conflict with `/trash` or `/:id`, since Express path-pattern matching only matches `/:id` against single-segment paths). |
| `apps/api/src/routes/public.router.ts` | New. No `requireAuth`. `createPublicRateLimiter()` — `createRateLimiter({ windowMs: 60_000, max: 60, keyGenerator: (req) => \`${ipKeyGenerator(req.ip ?? '')}:${req.params.token}\` })`, reusing the existing `ipKeyGenerator` import from `express-rate-limit` (same IPv6-safety precedent as `auth.router.ts`'s `forgotPasswordRateLimitKey`). Single route: `router.get('/:token', publicShareLimiter, controller.view)`. |
| `apps/api/src/routes/index.ts` | Modify. Widen the `createRouter` env param type to include `WEB_ORIGIN` (already satisfied at the real call site in `app.ts`, which passes the full `createApp` env — this is a type-only change, zero runtime risk). Add `router.use('/notes', createNotesRouter(env))` (unchanged) now implicitly carries `WEB_ORIGIN` through to the nested shares router; add `router.use('/public/shares', createPublicRouter());`. |
| `apps/api/src/routes/shares.integration.test.ts` | New. Supertest against the real `notes_test` database — owner-facing CRUD surface (`POST`/`GET`/`DELETE` under `/notes/:id/shares`), including the transactional-adjacent ownership/soft-delete branching that a mock can assert the *shape* of but not the real FK/constraint behavior. |
| `apps/api/src/routes/public.integration.test.ts` | New. Supertest against real Postgres — the only tier that can prove the atomic `UPDATE ... RETURNING` view-count increment has no lost updates under concurrency (SDS §14), plus expired/revoked/soft-deleted-note `410` cases and the 60/min/IP+token rate limit. |

## Prisma Schema Changes

New model, fully additive — no changes to any existing model's columns, and **no physical deletes introduced**:

```prisma
model ShareLink {
  id        String    @id @default(cuid())
  noteId    String
  token     String    @unique
  expiresAt DateTime
  revokedAt DateTime?
  viewCount Int       @default(0)
  createdAt DateTime  @default(now())

  note Note @relation(fields: [noteId], references: [id], onDelete: Cascade)

  @@index([noteId])
}
```

- `Note.shares ShareLink[]` back-relation added; no existing `Note` column, index, or relation is touched.
- Application code never issues `prisma.shareLink.delete(...)`. Revoke is `UPDATE ... SET revokedAt = now()` only. The `onDelete: Cascade` on `ShareLink.note` fires exclusively as a side effect of `purgeNotes.ts` physically deleting a `Note` row 30+ days past `deletedAt` (SDS §18) — the same cascade pattern already in place for `NoteTag`/`NoteVersion`, not a new bypass of the soft-delete rule.
- One migration, applied to both `DATABASE_URL` (`notes_dev`) and `TEST_DATABASE_URL` (`notes_test`) — same migration file run twice (SDS §2.2/§18).

## New Packages

None. `express-rate-limit` (`8.5.2`, already a dependency) already exports `ipKeyGenerator`, in active use in `auth.router.ts`. Token generation uses Node's built-in `node:crypto` (`randomBytes`, already imported in `lib/refreshToken.ts`). No `package.json` changes in this ticket.

## Dependencies on Prior Tickets

- **AB-1004 (Core Note Models)** — merged. `ShareLink.note` relation and every ownership/soft-delete lookup in `shares.service.ts` reuse the existing `Note` model and the exact `{ id, userId, deletedAt: null }` lookup shape `notes.service.ts` established.
- **AB-1002 (Core User & Auth Models)** — merged. `middleware/auth.ts` (`requireAuth`) is reused unmodified, inherited by the nested `shares.router.ts` from `notes.router.ts`'s existing mount — no new auth wiring.
- No dependency on AB-1006 (Tags) or AB-1007 (Search) — unrelated domains, confirmed in spec.
- **AB-1014 (Sharing Frontend)** will depend on this ticket's `shareUrl` shape (`${WEB_ORIGIN}/shares/:token`) and full API contract.

## Risk Areas

1. **Raw SQL must be parameterized, never string-concatenated.** The atomic view-count `UPDATE ... RETURNING` is the fourth raw-SQL exception in this codebase (alongside the tag ci-index, `searchVector`, and now this). `token` must go through `Prisma.sql`/`$queryRaw` tagged-template placeholders, never interpolated into a template string. Mitigated by a unit test asserting the query is built via `Prisma.sql`, mirroring `search.service.test.ts`'s existing check.
2. **Rate-limit key must be IPv6-safe.** Naively concatenating `req.ip` with `req.params.token` breaks under IPv6 (variable-length representations can collide or split unpredictably across the `express-rate-limit` internal store's key parsing). Must reuse `ipKeyGenerator` from `express-rate-limit`, exactly as `auth.router.ts`'s `forgotPasswordRateLimitKey` already does, not raw string concatenation.
3. **`mergeParams` wiring.** `shares.router.ts` must be created with `Router({ mergeParams: true })` and mounted via `router.use('/:id/shares', ...)` inside `notes.router.ts` for `req.params.id` (the note ID) to be visible inside `shares.controller.ts`'s handlers. Easy to silently get wrong (Express does not merge params by default) — covered by an integration test that a share link is correctly scoped to its parent note ID.
4. **`NotesRouterEnv`/`createRouter` env-type widening.** Adding `WEB_ORIGIN` to `NotesRouterEnv` and the `createRouter` env param is a type-only change — the actual runtime env object passed from `app.ts` already contains `WEB_ORIGIN` (used today for CORS), so no test fixture or server wiring changes are needed. Confirmed by checking `notes.integration.test.ts`'s `TEST_ENV`, which already includes `WEB_ORIGIN`.
5. **Revoke/list ignoring `deletedAt` vs. create requiring it.** Two different owner-scoped lookup shapes exist side-by-side in the same service file (`{ id, userId, deletedAt: null }` for create vs. `{ id, userId }` for list/revoke) — easy to accidentally copy-paste the wrong one. Both are explicitly unit-tested with a soft-deleted note fixture to catch a swap.
6. **`expiresAt` boundary math.** "1 to 30 days" must be validated as an open-ended lower bound (`> now()`, not `>= now()`) and an inclusive upper bound (`<= now() + 30 days`) — off-by-one here would silently reject a legitimate 30-day request or accept an already-past timestamp. Covered by explicit boundary-case unit tests (see Test Strategy).
7. **Token collision handling.** No retry-on-collision loop is implemented per `spec.md`'s explicit decision (probability is astronomically low, and a `P2002` would surface as `500 INTERNAL_ERROR`, which is acceptable for a case that cannot realistically occur). Flagging here only so this isn't "fixed" as an oversight during `/implement` or code review.

## Test Strategy

| Spec Scenario # | Behavior | Test File | Tier |
|---|---|---|---|
| 1–2 | Create with no `expiresAt` (defaults to +7d) / with `expiresAt` 14 days out | `shares.service.test.ts`, `shares.integration.test.ts` | Unit + Integration |
| 3–4 | `expiresAt` > 30 days / in the past or equal to now → `400 VALIDATION_FAILED` | `shares.service.test.ts` (boundary cases), `shares.controller.test.ts` (passthrough) | Unit |
| 5 | Create for a note owned by another user → `404 NOTE_NOT_FOUND` | `shares.service.test.ts`, `shares.integration.test.ts` | Unit + Integration |
| 6 | Create for caller's own soft-deleted note → `404 NOTE_NOT_FOUND` | `shares.service.test.ts` (active-only lookup), `shares.integration.test.ts` | Unit + Integration |
| 7 | Revoke an active link → subsequent public view → `410` | `shares.integration.test.ts` + `public.integration.test.ts` (cross-router flow) | Integration |
| 8 | Re-revoke an already-revoked link → `204` (idempotent) | `shares.service.test.ts`, `shares.integration.test.ts` | Unit + Integration |
| 9 | Revoke a token not belonging to the note → `404 SHARE_NOT_FOUND` | `shares.service.test.ts`, `shares.integration.test.ts` | Unit + Integration |
| 10 | Valid public view → `200`, `viewCount` incremented by 1 | `public.integration.test.ts` | Integration |
| 11 | Two concurrent public views → atomic increment, no lost update | `public.integration.test.ts` (real Postgres required — SDS §14) | Integration |
| 12–14 | Expired / revoked / parent-soft-deleted link → `410 GONE_LINK_INVALID` | `shares.service.test.ts` (raw-query-returns-no-row branch), `public.integration.test.ts` (real behavior) | Unit + Integration |
| 15 | Restored note's still-valid link becomes viewable again | `public.integration.test.ts` (restore via `/notes/:id/restore` then view) | Integration |
| 16 | List returns both active + revoked, newest first | `shares.service.test.ts`, `shares.integration.test.ts` | Unit + Integration |
| 17 | List works for a note currently in Trash | `shares.service.test.ts` (owner-scoped lookup ignores `deletedAt`), `shares.integration.test.ts` | Unit + Integration |
| 18 | Non-owner `GET /notes/:id/shares` → `404 NOTE_NOT_FOUND` | `shares.service.test.ts`, `shares.integration.test.ts` | Unit + Integration |
| 19 | 60 req/min/IP+token rate limit on public view | `public.integration.test.ts` | Integration |
| 20 | Missing/invalid access token on owner-facing routes → `401 AUTH_TOKEN_INVALID` | `shares.integration.test.ts` (reuses the existing `requireAuth` behavior already covered by `notes.integration.test.ts`'s equivalent case) | Integration |

Coverage gate (≥80% on new code, AGENTS.md §10) applies to every new/modified file above, enforced locally via the Husky pre-commit hook — no CI in this project (FRS §11).
