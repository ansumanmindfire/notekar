import { describe, it, expect } from 'vitest';
import { loadEnv, EnvValidationError } from './env';

/**
 * These tests exercise `loadEnv()` purely against plain objects passed via the
 * `source` parameter — process.env is never touched, which is exactly the
 * scenario the parameter exists for (fail-fast validation must be testable
 * without mutating global process state).
 */

const validBaseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/notes_dev',
  JWT_SECRET: 'a'.repeat(32),
  WEB_ORIGIN: 'http://localhost:5173',
};

const validFullEnv = {
  ...validBaseEnv,
  TEST_DATABASE_URL: 'postgresql://user:pass@localhost:5432/notes_test',
  NODE_ENV: 'production',
  PORT: '4000',
  BCRYPT_ROUNDS: '10',
  PURGE_CRON_SCHEDULE: '0 4 * * *',
};

describe('loadEnv', () => {
  it('parses a fully-specified valid env object with correct types', () => {
    const env = loadEnv(validFullEnv);

    expect(env.DATABASE_URL).toBe(validBaseEnv.DATABASE_URL);
    expect(env.TEST_DATABASE_URL).toBe(validFullEnv.TEST_DATABASE_URL);
    expect(env.JWT_SECRET).toBe(validBaseEnv.JWT_SECRET);
    expect(env.WEB_ORIGIN).toBe(validBaseEnv.WEB_ORIGIN);
    expect(env.NODE_ENV).toBe('production');

    // PORT and BCRYPT_ROUNDS must be coerced from string to number.
    expect(env.PORT).toBe(4000);
    expect(typeof env.PORT).toBe('number');
    expect(env.BCRYPT_ROUNDS).toBe(10);
    expect(typeof env.BCRYPT_ROUNDS).toBe('number');

    expect(env.PURGE_CRON_SCHEDULE).toBe('0 4 * * *');
  });

  it('applies documented defaults when optional vars are omitted', () => {
    const env = loadEnv(validBaseEnv);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.BCRYPT_ROUNDS).toBe(12);
    expect(env.PURGE_CRON_SCHEDULE).toBe('0 3 * * *');
    expect(env.TEST_DATABASE_URL).toBeUndefined();
  });

  it('throws EnvValidationError when DATABASE_URL is missing', () => {
    const invalid = {
      JWT_SECRET: validBaseEnv.JWT_SECRET,
      WEB_ORIGIN: validBaseEnv.WEB_ORIGIN,
    };

    expect(() => loadEnv(invalid)).toThrow(EnvValidationError);
    expect(() => loadEnv(invalid)).toThrow(/DATABASE_URL/);
  });

  it('throws EnvValidationError when JWT_SECRET is missing', () => {
    const invalid = {
      DATABASE_URL: validBaseEnv.DATABASE_URL,
      WEB_ORIGIN: validBaseEnv.WEB_ORIGIN,
    };

    expect(() => loadEnv(invalid)).toThrow(EnvValidationError);
    expect(() => loadEnv(invalid)).toThrow(/JWT_SECRET/);
  });

  it('throws EnvValidationError when JWT_SECRET is shorter than 32 characters', () => {
    const invalid = {
      ...validBaseEnv,
      JWT_SECRET: 'too-short',
    };

    expect(() => loadEnv(invalid)).toThrow(EnvValidationError);
    expect(() => loadEnv(invalid)).toThrow(/JWT_SECRET/);
  });

  it('throws EnvValidationError when WEB_ORIGIN is missing', () => {
    const invalid = {
      DATABASE_URL: validBaseEnv.DATABASE_URL,
      JWT_SECRET: validBaseEnv.JWT_SECRET,
    };

    expect(() => loadEnv(invalid)).toThrow(EnvValidationError);
    expect(() => loadEnv(invalid)).toThrow(/WEB_ORIGIN/);
  });

  it('throws EnvValidationError when PORT cannot be coerced to a valid number', () => {
    const invalid = {
      ...validBaseEnv,
      PORT: 'not-a-number',
    };

    expect(() => loadEnv(invalid)).toThrow(EnvValidationError);
    expect(() => loadEnv(invalid)).toThrow(/PORT/);
  });

  it('throws EnvValidationError when NODE_ENV is not one of the allowed enum values', () => {
    const invalid = {
      ...validBaseEnv,
      NODE_ENV: 'staging',
    };

    expect(() => loadEnv(invalid)).toThrow(EnvValidationError);
    expect(() => loadEnv(invalid)).toThrow(/NODE_ENV/);
  });

  it('does not mutate global process.env when passed a plain object as the source', () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    const originalJwtSecret = process.env.JWT_SECRET;
    const originalWebOrigin = process.env.WEB_ORIGIN;

    loadEnv(validFullEnv);

    expect(process.env.DATABASE_URL).toBe(originalDatabaseUrl);
    expect(process.env.JWT_SECRET).toBe(originalJwtSecret);
    expect(process.env.WEB_ORIGIN).toBe(originalWebOrigin);
  });
});
