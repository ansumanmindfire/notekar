import { createApp } from './app';
import { loadEnv, EnvValidationError, type Env } from './lib/env';
import { logger } from './lib/logger';
import { schedulePurgeNotesJob } from './lib/jobs/purgeNotes';
import { schedulePurgeVersionsJob } from './lib/jobs/purgeVersions';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  if (err instanceof EnvValidationError) {
    logger.error(err.message);
    process.exit(1);
  }
  throw err;
}

const app = createApp(env);

app.listen(env.PORT, () => {
  logger.info(`API listening on port ${env.PORT}`);
});

// Defense-in-depth: server.ts is never imported by the test suite today
// (vitest.config.ts only includes src/**/*.test.ts), but this guard means a
// future test importing it directly still can't start a background cron.
if (env.NODE_ENV !== 'test') {
  schedulePurgeNotesJob(env);
  schedulePurgeVersionsJob(env);
}
