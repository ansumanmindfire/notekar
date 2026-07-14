import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  timeout: 60000,
  testDir: './e2e',
  fullyParallel: true,
  webServer: [
    {
      command: 'pnpm --filter api run dev:e2e',
      cwd: '../..',
      url: 'http://localhost:3002/health',
      reuseExistingServer: !process.env.CI,
    },
    {
      command: 'pnpm --filter web run dev:e2e',
      cwd: '.',
      url: 'http://localhost:5174',
      reuseExistingServer: !process.env.CI,
    },
  ],
  use: {
    baseURL: 'http://localhost:5174',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
