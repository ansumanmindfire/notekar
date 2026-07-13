import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import type { PublicShareView } from 'shared/types';
import type { Prisma, ShareLink } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { generateShareToken } from '../lib/shareToken';

// Integration tier (AGENTS.md §10 / SDS §14): real Express app, real
// `notes_test` Postgres via the Prisma singleton (vitest.setup.ts already
// forces DATABASE_URL -> TEST_DATABASE_URL before this file loads). Covers
// openspec/changes/AB-1008-sharing/spec.md Scenarios 7, 10-15, and 19 for the
// unauthenticated public viewer endpoint: GET /public/shares/:token. The
// owner-facing share-link surface (POST/GET /notes/:id/shares, DELETE
// /notes/:id/shares/:token) is covered separately in
// shares.integration.test.ts (T19).
//
// This endpoint takes no bearer token, so `Note` and `ShareLink` fixture rows
// are created directly via the Prisma singleton rather than through an
// authenticated HTTP flow -- there is no owner-facing API call in this file.

const TEST_ENV = {
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test' as const,
  JWT_SECRET: 'a'.repeat(32),
  BCRYPT_ROUNDS: 4, // low rounds purely for wall-clock speed, no behavior change
};

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_BODY = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
};

function buildApp(): Express {
  return createApp(TEST_ENV);
}

async function resetDb(): Promise<void> {
  await prisma.shareLink.deleteMany();
  await prisma.noteTag.deleteMany();
  await prisma.tag.deleteMany();
  await prisma.noteVersion.deleteMany();
  await prisma.note.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUser(email: string): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'irrelevant-hash-for-this-test' },
  });
  return { id: user.id, email: user.email };
}

interface SeedNoteOptions {
  userId: string;
  title?: string;
  body?: Record<string, unknown>;
  deletedAt?: Date | null;
}

async function seedNote(options: SeedNoteOptions): Promise<{ id: string }> {
  const note = await prisma.note.create({
    data: {
      userId: options.userId,
      title: options.title ?? 'Seeded note',
      body: (options.body ?? DEFAULT_BODY) as Prisma.InputJsonValue,
      bodyText: '',
      deletedAt: options.deletedAt ?? null,
    },
  });
  return { id: note.id };
}

interface SeedShareLinkOptions {
  noteId: string;
  token?: string;
  expiresAt?: Date;
  revokedAt?: Date | null;
  viewCount?: number;
}

async function seedShareLink(options: SeedShareLinkOptions): Promise<ShareLink> {
  return prisma.shareLink.create({
    data: {
      noteId: options.noteId,
      token: options.token ?? generateShareToken(),
      expiresAt: options.expiresAt ?? new Date(Date.now() + 7 * DAY_MS),
      revokedAt: options.revokedAt ?? null,
      viewCount: options.viewCount ?? 0,
    },
  });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('GET /public/shares/:token', () => {
  const app = buildApp();

  it('#10 valid, unexpired, unrevoked link -> 200 with { title, body, viewCount, sharedAt }; viewCount is exactly one higher than before the request', async () => {
    const user = await seedUser('view10@example.com');
    const note = await seedNote({ userId: user.id, title: 'Shared Title', body: DEFAULT_BODY });
    const link = await seedShareLink({ noteId: note.id, viewCount: 3 });

    const res = await request(app).get(`/public/shares/${link.token}`);

    expect(res.status).toBe(200);
    const body = res.body as PublicShareView;
    expect(body.title).toBe('Shared Title');
    expect(body.body).toEqual(DEFAULT_BODY);
    expect(body.viewCount).toBe(4);
    expect(body.sharedAt).toBe(link.createdAt.toISOString());

    const stored = await prisma.shareLink.findUnique({ where: { token: link.token } });
    expect(stored?.viewCount).toBe(4);
  });

  // This is the one behavior ONLY a real Postgres instance can prove (SDS
  // §14) -- the atomic `UPDATE ... RETURNING` in shares.service.ts's
  // `viewPublicShare` must not lose an update under concurrent callers.
  it('#11 two concurrent public views of the same valid link both increment atomically -- no lost update', async () => {
    const user = await seedUser('concurrent11@example.com');
    const note = await seedNote({ userId: user.id, title: 'Concurrent note' });
    const link = await seedShareLink({ noteId: note.id, viewCount: 0 });

    const [resA, resB] = await Promise.all([
      request(app).get(`/public/shares/${link.token}`),
      request(app).get(`/public/shares/${link.token}`),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const bodyA = resA.body as PublicShareView;
    const bodyB = resB.body as PublicShareView;
    const viewCounts = [bodyA.viewCount, bodyB.viewCount].sort((a, b) => a - b);
    expect(viewCounts).toEqual([1, 2]);

    const stored = await prisma.shareLink.findUnique({ where: { token: link.token } });
    expect(stored?.viewCount).toBe(2);
  });

  it('#12 expired link (expiresAt in the past) -> 410 GONE_LINK_INVALID', async () => {
    const user = await seedUser('expired12@example.com');
    const note = await seedNote({ userId: user.id });
    const link = await seedShareLink({
      noteId: note.id,
      expiresAt: new Date(Date.now() - DAY_MS),
    });

    const res = await request(app).get(`/public/shares/${link.token}`);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: ErrorCodes.GONE_LINK_INVALID });

    const stored = await prisma.shareLink.findUnique({ where: { token: link.token } });
    expect(stored?.viewCount).toBe(0);
  });

  it('#13 revoked link (revokedAt set) -> 410 GONE_LINK_INVALID', async () => {
    const user = await seedUser('revoked13@example.com');
    const note = await seedNote({ userId: user.id });
    const link = await seedShareLink({ noteId: note.id, revokedAt: new Date() });

    const res = await request(app).get(`/public/shares/${link.token}`);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: ErrorCodes.GONE_LINK_INVALID });
  });

  it('#7 a link revoked via a direct update (simulating the outcome of the owner-facing revoke) -> subsequent public view 410 GONE_LINK_INVALID', async () => {
    const user = await seedUser('crossrouter7@example.com');
    const note = await seedNote({ userId: user.id });
    const link = await seedShareLink({ noteId: note.id });

    // Simulates the DB-level outcome of DELETE /notes/:id/shares/:token
    // (owner-facing revoke, covered end-to-end via the API in T19's
    // shares.integration.test.ts) without going through that authenticated
    // route, since this file is scoped to the public viewer surface only.
    await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });

    const res = await request(app).get(`/public/shares/${link.token}`);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: ErrorCodes.GONE_LINK_INVALID });
  });

  it("#14 valid link whose parent note has since been soft-deleted -> 410 GONE_LINK_INVALID", async () => {
    const user = await seedUser('softdeleted14@example.com');
    const note = await seedNote({ userId: user.id, deletedAt: new Date() });
    const link = await seedShareLink({ noteId: note.id });

    const res = await request(app).get(`/public/shares/${link.token}`);

    expect(res.status).toBe(410);
    expect(res.body).toMatchObject({ code: ErrorCodes.GONE_LINK_INVALID });
  });

  it('#15 a note restored from Trash within its recovery window becomes viewable again (410 while trashed, 200 after clearing deletedAt), provided the link itself is still valid', async () => {
    const user = await seedUser('restored15@example.com');
    const note = await seedNote({ userId: user.id, title: 'Comes back', deletedAt: new Date() });
    const link = await seedShareLink({ noteId: note.id });

    const whileTrashed = await request(app).get(`/public/shares/${link.token}`);
    expect(whileTrashed.status).toBe(410);
    expect(whileTrashed.body).toMatchObject({ code: ErrorCodes.GONE_LINK_INVALID });

    // Simulates the DB-level outcome of POST /notes/:id/restore (covered
    // end-to-end via the API in notes.integration.test.ts) without going
    // through that authenticated route.
    await prisma.note.update({ where: { id: note.id }, data: { deletedAt: null } });

    const afterRestore = await request(app).get(`/public/shares/${link.token}`);
    expect(afterRestore.status).toBe(200);
    const body = afterRestore.body as PublicShareView;
    expect(body.title).toBe('Comes back');
    expect(body.viewCount).toBe(1);
  });
});

describe('GET /public/shares/:token - rate limit', () => {
  // FRS §11 / public.router.ts's `publicShareRateLimitKey` scopes the limit
  // per IP+token (60/min), not per IP alone. Own fresh app instance so this
  // test's tight 60-allowed + 1-blocked call budget is self-contained and
  // never interferes with (or is interfered by) the describe block above
  // sharing its own `app` -- rate limiter state persists per createApp()
  // instance, not globally (same precedent as auth.integration.test.ts).
  it('#19 blocks the 61st request against the same token within a minute; a different token is unaffected, proving the key is IP+token, not IP-only', async () => {
    const app = buildApp();
    const user = await seedUser('ratelimit19@example.com');
    const noteA = await seedNote({ userId: user.id, title: 'Link A' });
    const noteB = await seedNote({ userId: user.id, title: 'Link B' });
    const linkA = await seedShareLink({ noteId: noteA.id });
    const linkB = await seedShareLink({ noteId: noteB.id });

    for (let i = 0; i < 60; i += 1) {
      const res = await request(app).get(`/public/shares/${linkA.token}`);
      expect(res.status).toBe(200);
    }

    const blocked = await request(app).get(`/public/shares/${linkA.token}`);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: ErrorCodes.RATE_LIMITED });

    const differentToken = await request(app).get(`/public/shares/${linkB.token}`);
    expect(differentToken.status).toBe(200);
  });
});
