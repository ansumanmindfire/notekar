import { createApp } from './app';
import { loadEnv, EnvValidationError, type Env } from './lib/env';
import { logger } from './lib/logger';

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
