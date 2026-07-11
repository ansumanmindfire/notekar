import pino from 'pino';

export const logger = pino({
  redact: {
    paths: [
      'password',
      'token',
      'otp',
      'authorization',
      'cookie',
      'req.headers.authorization',
      'req.headers.cookie',
    ],
    censor: '[REDACTED]',
  },
});
