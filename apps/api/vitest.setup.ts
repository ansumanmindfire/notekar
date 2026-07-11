import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../.env') });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'TEST_DATABASE_URL is not set. Integration tests must never run against the dev database — set TEST_DATABASE_URL in .env before running tests.',
  );
}

// Force every test in this package onto the test database, so it is
// structurally impossible for any test (now or added later) to touch
// notes_dev — the Prisma singleton in lib/prisma.ts reads DATABASE_URL.
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
