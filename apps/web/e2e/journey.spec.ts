import { test, expect } from '@playwright/test';

const TEST_PASSWORD = 'E2eJourney!23';

test('completes the full core user journey', async ({ page }) => {
  const uniqueEmail = `e2e-${Date.now()}@noteapp.test`;

  await test.step('Register & Login', async () => {
    await page.goto('/register');
    await page.locator('#register-email').fill(uniqueEmail);
    await page.locator('#register-password').fill(TEST_PASSWORD);
    await page.locator('#register-confirm-password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/notes$/);
  });

  await test.step('Create Note', async () => {
    await page.getByRole('link', { name: 'New Note' }).click();
    await expect(page).toHaveURL(/\/notes\/new$/);

    // Wait for the debounced POST /notes request
    const createResponsePromise = page.waitForResponse((res) => res.url().includes('/notes') && res.request().method() === 'POST');

    await page.getByLabel('Title').fill('My E2E Test Note');
    await page.locator('.prose-editor').fill('This is the initial content.');

    await createResponsePromise;
  });

  await test.step('Autosave', async () => {
    await expect(page).toHaveURL(/\/notes\/[a-zA-Z0-9_-]+$/);
    // UI pill validation is flaky because it auto-hides quickly, so URL update and POST response completion are our assertions.
  });

  await test.step('Tag Note', async () => {
    const tagInput = page.getByPlaceholder('Add a tag...');
    await tagInput.fill('e2e-tag');
    await tagInput.press('Enter');

    await expect(page.getByRole('button', { name: 'Remove e2e-tag' })).toBeVisible();
  });

  await test.step('Share Note', async () => {
    await page.getByRole('button', { name: 'Share note' }).click();
    await expect(page.getByRole('heading', { name: 'Share Note' })).toBeVisible();

    await page.getByRole('button', { name: 'Create link' }).click();
    
    // Assert a share link row appears with a Revoke button
    await expect(page.getByRole('button', { name: 'Revoke' }).first()).toBeVisible();
  });

  await test.step('Revoke Share', async () => {
    await page.getByRole('button', { name: 'Revoke' }).first().click();
    await expect(page.getByRole('heading', { name: 'Revoke share link?' })).toBeVisible();
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    
    // Revoke button should disappear
    await expect(page.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
    await page.keyboard.press('Escape'); 
    await expect(page.getByRole('heading', { name: 'Share Note' })).toBeHidden();
  });

  await test.step('Setup edit for version restore', async () => {
    // Wait for the debounced PATCH /notes/:id request
    const updateResponsePromise = page.waitForResponse((res) => res.url().includes('/notes/') && res.request().method() === 'PATCH');

    await page.locator('.prose-editor').focus();
    await page.keyboard.press('End');
    await page.keyboard.type(' And this is an edit.');

    await updateResponsePromise;
  });

  await test.step('Restore Version', async () => {
    await page.getByRole('button', { name: 'Version history' }).click();
    await expect(page.getByRole('heading', { name: 'Version History' })).toBeVisible();

    // We expect 2 versions: one snapshot from before tagging, and one snapshot from before the edit.
    const versionButtons = page.getByRole('button', { name: /Version \d+/ });
    await expect(versionButtons).toHaveCount(2);
    await versionButtons.first().click();

    await page.getByRole('button', { name: 'Restore this version' }).click();
    await expect(page.getByRole('heading', { name: 'Restore this version?' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'Version History' })).toBeHidden();

    // Verify body reverted
    await expect(page.locator('.prose-editor')).toHaveText('This is the initial content.');
    
    // Verify tag survived
    await expect(page.getByRole('button', { name: 'Remove e2e-tag' })).toBeVisible();
  });

  await test.step('Delete Note', async () => {
    await page.getByRole('button', { name: 'Delete note' }).click();
    await expect(page.getByRole('heading', { name: 'Delete note?' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByText('My E2E Test Note')).toBeHidden();
  });

  await test.step('Restore from Trash', async () => {
    await page.getByRole('link', { name: 'Trash' }).click();
    await expect(page).toHaveURL(/\/notes\/trash$/);
    
    await page.getByText('My E2E Test Note').click();
    
    // Click Restore in the preview modal
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    
    await expect(page.getByRole('heading', { name: 'Restore note?' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Restore note?' })).toBeHidden();
    
    await page.getByRole('link', { name: 'Notes', exact: true }).click();
    await expect(page).toHaveURL(/\/notes$/);
    await expect(page.getByText('My E2E Test Note')).toBeVisible();
  });

  await test.step('Logout', async () => {
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
