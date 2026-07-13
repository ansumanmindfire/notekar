import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import type { CreatedShareLink, ShareLink as ShareLinkResponse } from 'shared/types';
import type { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/jwt';

// Integration tier (AGENTS.md §10 / SDS §14): real Express app, real
// `notes_test` Postgres via the Prisma singleton (vitest.setup.ts already
// forces DATABASE_URL -> TEST_DATABASE_URL before this file loads). Covers
// openspec/changes/AB-1008-sharing/spec.md Scenarios 1-9, 16-18, and 20 for
// the owner-facing share-link surface: POST/GET /notes/:id/shares and
// DELETE /notes/:id/shares/:token. The public (unauthenticated) viewer
// endpoint and view-count semantics are covered separately in T20.

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

function authHeader(userId: string): string {
  return `Bearer ${signAccessToken(userId, TEST_ENV.JWT_SECRET)}`;
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

function isoDaysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('POST /notes/:id/shares', () => {
  const app = buildApp();

  it('#1 creates with no expiresAt -> 201, expiresAt ~7 days out, viewCount 0, shareUrl starts with WEB_ORIGIN', async () => {
    const user = await seedUser('create1@example.com');
    const note = await seedNote({ userId: user.id });

    const before = Date.now();
    const res = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({});
    const after = Date.now();

    expect(res.status).toBe(201);
    const body = res.body as CreatedShareLink;
    expect(body.viewCount).toBe(0);
    expect(typeof body.token).toBe('string');
    expect(body.shareUrl.startsWith(TEST_ENV.WEB_ORIGIN)).toBe(true);

    const expiresAtMs = new Date(body.expiresAt).getTime();
    expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 5000);
    expect(expiresAtMs).toBeLessThanOrEqual(after + 7 * DAY_MS + 5000);
  });

  it('#2 creates with expiresAt 14 days out -> 201, link valid for 14 days', async () => {
    const user = await seedUser('create2@example.com');
    const note = await seedNote({ userId: user.id });
    const target = isoDaysFromNow(14);

    const res = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({ expiresAt: target });

    expect(res.status).toBe(201);
    const body = res.body as CreatedShareLink;
    expect(new Date(body.expiresAt).getTime()).toBe(new Date(target).getTime());
  });

  it('#3 creates with expiresAt >30 days out -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('create3@example.com');
    const note = await seedNote({ userId: user.id });

    const res = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({ expiresAt: isoDaysFromNow(31) });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it('#4 creates with expiresAt in the past -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('create4a@example.com');
    const note = await seedNote({ userId: user.id });

    const res = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({ expiresAt: new Date(Date.now() - DAY_MS).toISOString() });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#4 creates with expiresAt equal to now -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('create4b@example.com');
    const note = await seedNote({ userId: user.id });

    const res = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({ expiresAt: new Date().toISOString() });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it("#5 creates for a note owned by another user -> 404 NOTE_NOT_FOUND", async () => {
    const owner = await seedUser('owner5@example.com');
    const intruder = await seedUser('intruder5@example.com');
    const note = await seedNote({ userId: owner.id });

    const res = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(intruder.id))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });

    const count = await prisma.shareLink.count({ where: { noteId: note.id } });
    expect(count).toBe(0);
  });

  it("#6 creates for caller's own soft-deleted (trashed) note -> 404 NOTE_NOT_FOUND", async () => {
    const user = await seedUser('create6@example.com');
    const note = await seedNote({ userId: user.id, deletedAt: new Date() });

    const res = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({});

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });
  });
});

describe('DELETE /notes/:id/shares/:token', () => {
  const app = buildApp();

  it('#7 revokes an active share link -> 204, DB row revokedAt gets set', async () => {
    const user = await seedUser('revoke7@example.com');
    const note = await seedNote({ userId: user.id });

    const createRes = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({});
    expect(createRes.status).toBe(201);
    const { token } = createRes.body as CreatedShareLink;

    const revokeRes = await request(app)
      .delete(`/notes/${note.id}/shares/${token}`)
      .set('Authorization', authHeader(user.id));

    expect(revokeRes.status).toBe(204);

    const stored = await prisma.shareLink.findUnique({ where: { token } });
    expect(stored).not.toBeNull();
    expect(stored?.revokedAt).not.toBeNull();
  });

  it('#8 revokes an already-revoked link -> 204 again (idempotent, not an error)', async () => {
    const user = await seedUser('revoke8@example.com');
    const note = await seedNote({ userId: user.id });

    const createRes = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({});
    const { token } = createRes.body as CreatedShareLink;

    const first = await request(app)
      .delete(`/notes/${note.id}/shares/${token}`)
      .set('Authorization', authHeader(user.id));
    expect(first.status).toBe(204);

    const stored1 = await prisma.shareLink.findUnique({ where: { token } });
    const firstRevokedAt = stored1?.revokedAt;

    const second = await request(app)
      .delete(`/notes/${note.id}/shares/${token}`)
      .set('Authorization', authHeader(user.id));
    expect(second.status).toBe(204);

    const stored2 = await prisma.shareLink.findUnique({ where: { token } });
    expect(stored2?.revokedAt).not.toBeNull();
    expect(stored2?.revokedAt?.getTime()).toBe(firstRevokedAt?.getTime());
  });

  it("#9 revokes a token that doesn't belong to the note -> 404 SHARE_NOT_FOUND", async () => {
    const user = await seedUser('revoke9@example.com');
    const noteA = await seedNote({ userId: user.id, title: 'Note A' });
    const noteB = await seedNote({ userId: user.id, title: 'Note B' });

    const createRes = await request(app)
      .post(`/notes/${noteA.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({});
    const { token } = createRes.body as CreatedShareLink;

    const res = await request(app)
      .delete(`/notes/${noteB.id}/shares/${token}`)
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.SHARE_NOT_FOUND });

    const stored = await prisma.shareLink.findUnique({ where: { token } });
    expect(stored?.revokedAt).toBeNull();
  });

  it('revokes a token for a note owned by another user -> 404 SHARE_NOT_FOUND', async () => {
    const owner = await seedUser('revokeowner@example.com');
    const intruder = await seedUser('revokeintruder@example.com');
    const note = await seedNote({ userId: owner.id });

    const createRes = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(owner.id))
      .send({});
    const { token } = createRes.body as CreatedShareLink;

    const res = await request(app)
      .delete(`/notes/${note.id}/shares/${token}`)
      .set('Authorization', authHeader(intruder.id));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.SHARE_NOT_FOUND });

    const stored = await prisma.shareLink.findUnique({ where: { token } });
    expect(stored?.revokedAt).toBeNull();
  });
});

describe('GET /notes/:id/shares', () => {
  const app = buildApp();

  it('#16 returns both active and revoked links, newest first, revokedAt populated only for revoked ones', async () => {
    const user = await seedUser('list16@example.com');
    const note = await seedNote({ userId: user.id });

    const firstCreate = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({});
    const first = firstCreate.body as CreatedShareLink;

    const secondCreate = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({});
    const second = secondCreate.body as CreatedShareLink;

    // Revoke only the first (older) link, leaving the second active.
    const revokeRes = await request(app)
      .delete(`/notes/${note.id}/shares/${first.token}`)
      .set('Authorization', authHeader(user.id));
    expect(revokeRes.status).toBe(204);

    const listRes = await request(app)
      .get(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id));

    expect(listRes.status).toBe(200);
    const items = listRes.body as ShareLinkResponse[];
    expect(items).toHaveLength(2);

    // Newest first: second link was created after first.
    expect(items[0]?.token).toBe(second.token);
    expect(items[1]?.token).toBe(first.token);

    expect(items[0]?.revokedAt).toBeNull();
    expect(items[1]?.revokedAt).not.toBeNull();
  });

  it('#17 works for a note currently in Trash (soft-deleted, within the 30-day window)', async () => {
    const user = await seedUser('list17@example.com');
    const note = await seedNote({ userId: user.id });

    const createRes = await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id))
      .send({});
    expect(createRes.status).toBe(201);

    const deleteRes = await request(app)
      .delete(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id));
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app)
      .get(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(user.id));

    expect(listRes.status).toBe(200);
    const items = listRes.body as ShareLinkResponse[];
    expect(items).toHaveLength(1);
  });

  it("#18 non-owner GET /notes/:id/shares -> 404 NOTE_NOT_FOUND", async () => {
    const owner = await seedUser('owner18@example.com');
    const intruder = await seedUser('intruder18@example.com');
    const note = await seedNote({ userId: owner.id });

    await request(app)
      .post(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(owner.id))
      .send({});

    const res = await request(app)
      .get(`/notes/${note.id}/shares`)
      .set('Authorization', authHeader(intruder.id));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });
  });
});

describe('#20 auth guard: every /notes/:id/shares route rejects a missing or invalid access token', () => {
  const app = buildApp();
  const FAKE_ID = 'cku0nonexistent0000000001';
  const FAKE_TOKEN = 'nonexistent-share-token';

  const routes: Array<{ method: 'get' | 'post' | 'delete'; path: string }> = [
    { method: 'post', path: `/notes/${FAKE_ID}/shares` },
    { method: 'get', path: `/notes/${FAKE_ID}/shares` },
    { method: 'delete', path: `/notes/${FAKE_ID}/shares/${FAKE_TOKEN}` },
  ];

  it.each(routes)('$method $path -> 401 AUTH_TOKEN_INVALID with no Authorization header', async (route) => {
    const res = await request(app)[route.method](route.path);

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: ErrorCodes.AUTH_TOKEN_INVALID });
  });

  it.each(routes)('$method $path -> 401 AUTH_TOKEN_INVALID with a garbage token', async (route) => {
    const res = await request(app)[route.method](route.path).set('Authorization', 'Bearer garbage-token');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: ErrorCodes.AUTH_TOKEN_INVALID });
  });
});
