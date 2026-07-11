# AB-1001: Fix Bundles

Append-only log of fix bundles constructed in response to tester failures or reviewer [WARN]/[FAIL] findings (Triage Case B). Each bundle is presented to the user for one approval before being applied.

Format per entry:

```
## Fix Bundle for T<n>
**Trigger:** <tester failure / reviewer finding this responds to>
**Changes:**
- <file>: <change>
**Status:** <pending approval | approved | applied>
```

---

## Fix Bundle for T1-T5
**Trigger:** Reviewer [WARN] — `.gitignore`'s `.env.*.local` pattern does not glob-match a bare `.env.local` file, so that common Vite local-override filename could be accidentally committed.
**Changes:**
- `.gitignore`: add an explicit `.env.local` line alongside the existing `.env.*.local` pattern.
**Status:** approved — applied

## Fix Bundle for T19-T35 (Phase 4)
**Trigger:** Reviewer [FAIL] x2 + [SEC] x1 + [WARN] (unused pino-http dependency)
**Changes:**
1. `apps/api/src/lib/AppError.ts`: change `readonly fields?: string[];` → `readonly fields: string[] | undefined;` so assigning the constructor's `string[] | undefined`-typed param doesn't violate `exactOptionalPropertyTypes` (TS2412).
2. `apps/api/src/middleware/errorHandler.ts`: in the `AppError` branch, build the `ApiError` object with a conditional spread (`...(err.fields !== undefined && { fields: err.fields })`) instead of `fields: err.fields`, so the `fields` key is omitted entirely when undefined rather than explicitly set to `undefined` — same `exactOptionalPropertyTypes` violation.
3. `apps/api/src/middleware/helmet.ts`: add explicit `frameguard: { action: 'deny' }` and `hsts` conditioned on production (`isProduction` param) instead of relying on undocumented Helmet defaults, to literally satisfy SDS §5.1's `X-Frame-Options: DENY` / prod-only HSTS requirement. Update `apps/api/src/app.ts`'s call site to pass `env.NODE_ENV === 'production'` and widen its `Pick<Env, ...>` to include `NODE_ENV`.
4. `apps/api/src/app.ts`: wire `pino-http` as request-logging middleware (SDS §16), immediately after Helmet/CORS, using the existing `logger` singleton — closes the unused-dependency gap instead of leaving it silently unwired.
**Status:** approved — applied, verified correct by follow-up reviewer pass
