import { test, expect } from '@playwright/test';

// Baseline smoke test (FR-INFRA-3 / AB-1001 T45 / plan.md Test Strategy "Playwright
// smoke test passes"). Confirms the dev server boots and serves the placeholder
// landing page. `baseURL` is configured in `e2e/playwright.config.ts`, so a
// relative path resolves against the running `pnpm dev` web server.
test('renders the NoteApp placeholder heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'NoteApp' })).toBeVisible();
});
