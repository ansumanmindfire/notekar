import express from 'express';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import type { Env } from './lib/env';
import { logger } from './lib/logger';
import { createHelmetMiddleware } from './middleware/helmet';
import { createCorsMiddleware } from './middleware/cors';
import { defaultBodyLimit } from './middleware/bodyLimit';
import { createRouter } from './routes/index';
import { errorHandler } from './middleware/errorHandler';

export function createApp(
  env: Pick<Env, 'WEB_ORIGIN' | 'NODE_ENV' | 'JWT_SECRET' | 'BCRYPT_ROUNDS'>,
) {
  const app = express();

  app.use(createHelmetMiddleware(env.NODE_ENV === 'production'));
  app.use(createCorsMiddleware(env.WEB_ORIGIN));
  app.use(pinoHttp({ logger }));
  app.use(defaultBodyLimit);
  app.use(cookieParser());
  app.use(createRouter(env));
  app.use(errorHandler);

  return app;
}
