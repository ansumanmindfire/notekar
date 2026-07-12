import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // Integration test files share one real notes_test database and each
    // does its own unscoped cleanup (e.g. resetDb()'s global deleteMany
    // calls) - running files concurrently lets one file's cleanup race
    // another's in-progress assertions. Sequential file execution avoids it.
    fileParallelism: false,
  },
});
