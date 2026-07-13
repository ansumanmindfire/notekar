import { test, expect } from '@playwright/test';

// Baseline smoke test (FR-INFRA-3 / AB-1001 T45 / plan.md Test Strategy "Playwright
// smoke test passes"). Confirms the dev server boots and serves a real page.
// `baseURL` is configured in `e2e/playwright.config.ts`, so a relative path resolves
// against the running `pnpm dev` web server.
//
// AB-1010 replaced the AB-1001 placeholder `<h1>NoteApp</h1>` with a full TanStack
// Router mount. The `/` index route now always redirects: to `/notes` if the session
// bootstrap resolves authenticated, or to `/login` if it resolves unauthenticated.
// This test runs against a fresh browser context (no cookies) with only the web dev
// server running (no API server), so the bootstrap's `/auth/refresh` call fails with
// a network error and deterministically resolves to `'unauthenticated'`, redirecting
// `/` to `/login`. This is a deliberate, reviewed change to the baseline smoke test
// (AB-1010 plan.md risk area #2), not a silent regression.
test('redirects unauthenticated root visits to the login page', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Log in' })).toBeVisible();
});
