import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import type { Note as NoteResponse, NoteVersionSummary, NoteVersionDetail } from 'shared/types';
import type { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/jwt';

// Integration tier (AGENTS.md §10 / SDS §14): real Express app, real
// `notes_test` Postgres via the Prisma singleton (vitest.setup.ts already
// forces DATABASE_URL -> TEST_DATABASE_URL before this file loads). Covers
// openspec/changes/AB-1009-version-history/spec.md Scenarios 3, 8, 9, 10, 13,
// 14 for the /notes/:id/versions surface -- the cases that specifically
// require real Postgres (transactional concurrency) or a full HTTP+DB round
// trip (trash-state-ignored lookups, tags-untouched-after-restore). Unit-tier
// coverage of the service/controller logic itself lives in
// versions.service.test.ts and versions.controller.test.ts.

const TEST_ENV = {
  WEB_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'test' as const,
  JWT_SECRET: 'a'.repeat(32),
  BCRYPT_ROUNDS: 4, // low rounds purely for wall-clock speed, no behavior change
};

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

// Creates a Tag row directly via Prisma (bypassing the /tags HTTP surface,
// which is exercised in full by tags.integration.test.ts), matching
// notes.integration.test.ts's seedTag helper.
async function seedTag(userId: string, name: string, color = 'blue'): Promise<{ id: string }> {
  const tag = await prisma.tag.create({ data: { userId, name, color } });
  return { id: tag.id };
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

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('GET /notes/:id/versions', () => {
  const app = buildApp();

  it('#3 lists versions for a note currently in Trash (trash state ignored for read)', async () => {
    const user = await seedUser('list3@example.com');
    const note = await seedNote({ userId: user.id, title: 'Original title' });

    // Generate one historical version via a real PATCH (updateNote's
    // snapshot-before-update transaction, unchanged by this ticket).
    const patchRes = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Updated title' });
    expect(patchRes.status).toBe(200);

    const deleteRes = await request(app)
      .delete(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id));
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app)
      .get(`/notes/${note.id}/versions`)
      .set('Authorization', authHeader(user.id));

    expect(listRes.status).toBe(200);
    const items = listRes.body as NoteVersionSummary[];
    expect(items).toHaveLength(1);
    expect(items[0]?.title).toBe('Original title');
    expect((items[0] as unknown as Record<string, unknown>).body).toBeUndefined();
  });
});

describe('GET /notes/:id/versions/:versionId', () => {
  const app = buildApp();

  it('#5 previews a specific historical version on a trashed note -> 200 with full title/body/version/savedAt', async () => {
    const user = await seedUser('preview5@example.com');
    const note = await seedNote({ userId: user.id, title: 'Original title', body: DEFAULT_BODY });

    const patchRes = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Updated title' });
    expect(patchRes.status).toBe(200);

    const deleteRes = await request(app)
      .delete(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id));
    expect(deleteRes.status).toBe(204);

    const listRes = await request(app)
      .get(`/notes/${note.id}/versions`)
      .set('Authorization', authHeader(user.id));
    const summary = (listRes.body as NoteVersionSummary[])[0];
    expect(summary).toBeDefined();

    const previewRes = await request(app)
      .get(`/notes/${note.id}/versions/${summary!.id}`)
      .set('Authorization', authHeader(user.id));

    expect(previewRes.status).toBe(200);
    const detail = previewRes.body as NoteVersionDetail;
    expect(detail.title).toBe('Original title');
    expect(detail.body).toEqual(DEFAULT_BODY);
    expect(detail.version).toBe(1);
    expect(typeof detail.savedAt).toBe('string');
  });
});

describe('POST /notes/:id/versions/:versionId/restore', () => {
  const app = buildApp();

  it('#8 restores a historical version -> 200, title/body reverted, new snapshot created, version incremented', async () => {
    const user = await seedUser('restore8@example.com');
    const note = await seedNote({ userId: user.id, title: 'Title A' });

    const patchRes = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Title B' });
    expect(patchRes.status).toBe(200);
    const afterPatch = patchRes.body as NoteResponse;
    expect(afterPatch.version).toBe(2);

    const listRes = await request(app)
      .get(`/notes/${note.id}/versions`)
      .set('Authorization', authHeader(user.id));
    const historical = (listRes.body as NoteVersionSummary[]).find((v) => v.title === 'Title A');
    expect(historical).toBeDefined();

    const restoreRes = await request(app)
      .post(`/notes/${note.id}/versions/${historical!.id}/restore`)
      .set('Authorization', authHeader(user.id));

    expect(restoreRes.status).toBe(200);
    const restored = restoreRes.body as NoteResponse;
    expect(restored.title).toBe('Title A');
    expect(restored.version).toBe(3);

    // A new NoteVersion snapshot of the pre-restore state ("Title B") now
    // exists in history, in addition to the original "Title A" snapshot.
    const versions = await prisma.noteVersion.findMany({ where: { noteId: note.id } });
    expect(versions).toHaveLength(2);
    expect(versions.some((v) => v.title === 'Title B')).toBe(true);
    expect(versions.some((v) => v.title === 'Title A')).toBe(true);
  });

  it('#9 restore leaves the note current tags untouched even though tags differ from what was attached when the version was saved', async () => {
    const user = await seedUser('restore9@example.com');
    const tagAtSaveTime = await seedTag(user.id, 'Save-time tag');
    const currentTag = await seedTag(user.id, 'Current tag');

    const createRes = await request(app)
      .post('/notes')
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Title A', body: DEFAULT_BODY, tagIds: [tagAtSaveTime.id] });
    expect(createRes.status).toBe(201);
    const noteId = (createRes.body as NoteResponse).id;

    // Update title (creates the historical snapshot of "Title A") while the
    // save-time tag is still attached.
    const patchRes = await request(app)
      .patch(`/notes/${noteId}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Title B' });
    expect(patchRes.status).toBe(200);

    // Now change the note's current tags, independent of version history.
    const retagRes = await request(app)
      .patch(`/notes/${noteId}`)
      .set('Authorization', authHeader(user.id))
      .send({ tagIds: [currentTag.id] });
    expect(retagRes.status).toBe(200);
    expect((retagRes.body as NoteResponse).tagIds).toEqual([currentTag.id]);

    const listRes = await request(app)
      .get(`/notes/${noteId}/versions`)
      .set('Authorization', authHeader(user.id));
    const historical = (listRes.body as NoteVersionSummary[]).find((v) => v.title === 'Title A');
    expect(historical).toBeDefined();

    const restoreRes = await request(app)
      .post(`/notes/${noteId}/versions/${historical!.id}/restore`)
      .set('Authorization', authHeader(user.id));

    expect(restoreRes.status).toBe(200);
    const restored = restoreRes.body as NoteResponse;
    expect(restored.title).toBe('Title A');
    // Tags remain whatever was current immediately before restore -- never
    // reverted to what was attached when the historical version was saved.
    expect(restored.tagIds).toEqual([currentTag.id]);

    const noteTags = await prisma.noteTag.findMany({ where: { noteId } });
    expect(noteTags).toHaveLength(1);
    expect(noteTags[0]?.tagId).toBe(currentTag.id);
  });

  it('#10 restore succeeds on a trashed note; deletedAt remains unchanged (still trashed)', async () => {
    const user = await seedUser('restore10@example.com');
    const note = await seedNote({ userId: user.id, title: 'Title A' });

    const patchRes = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Title B' });
    expect(patchRes.status).toBe(200);

    const deleteRes = await request(app)
      .delete(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id));
    expect(deleteRes.status).toBe(204);

    const stored = await prisma.note.findUnique({ where: { id: note.id } });
    const deletedAtBefore = stored?.deletedAt;
    expect(deletedAtBefore).not.toBeNull();

    const listRes = await request(app)
      .get(`/notes/${note.id}/versions`)
      .set('Authorization', authHeader(user.id));
    const historical = (listRes.body as NoteVersionSummary[]).find((v) => v.title === 'Title A');
    expect(historical).toBeDefined();

    const restoreRes = await request(app)
      .post(`/notes/${note.id}/versions/${historical!.id}/restore`)
      .set('Authorization', authHeader(user.id));

    expect(restoreRes.status).toBe(200);
    const restored = restoreRes.body as NoteResponse;
    expect(restored.title).toBe('Title A');
    expect(restored.deletedAt).not.toBeNull();
    expect(new Date(restored.deletedAt!).getTime()).toBe(deletedAtBefore!.getTime());

    const stillTrashed = await prisma.note.findUnique({ where: { id: note.id } });
    expect(stillTrashed?.deletedAt?.getTime()).toBe(deletedAtBefore!.getTime());
  });

  it('#13 two concurrent restores targeting different historical versions both succeed (real-transaction test, plan.md Risk #1)', async () => {
    const user = await seedUser('restore13@example.com');
    const note = await seedNote({ userId: user.id, title: 'Version A' });

    const patchB = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Version B' });
    expect(patchB.status).toBe(200);
    expect((patchB.body as NoteResponse).version).toBe(2);

    const patchC = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Version C' });
    expect(patchC.status).toBe(200);
    const preTestVersion = (patchC.body as NoteResponse).version;
    expect(preTestVersion).toBe(3);

    const listRes = await request(app)
      .get(`/notes/${note.id}/versions`)
      .set('Authorization', authHeader(user.id));
    const historicalRows = listRes.body as NoteVersionSummary[];
    const versionA = historicalRows.find((v) => v.title === 'Version A');
    const versionB = historicalRows.find((v) => v.title === 'Version B');
    expect(versionA).toBeDefined();
    expect(versionB).toBeDefined();

    const beforeCount = await prisma.noteVersion.count({ where: { noteId: note.id } });
    expect(beforeCount).toBe(2);

    // Fire both restores concurrently against two distinct historical
    // versions of the same note.
    const [resA, resB] = await Promise.all([
      request(app)
        .post(`/notes/${note.id}/versions/${versionA!.id}/restore`)
        .set('Authorization', authHeader(user.id)),
      request(app)
        .post(`/notes/${note.id}/versions/${versionB!.id}/restore`)
        .set('Authorization', authHeader(user.id)),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    const finalNote = await prisma.note.findUnique({ where: { id: note.id } });
    expect(finalNote?.version).toBe(preTestVersion + 2);

    const finalVersions = await prisma.noteVersion.findMany({ where: { noteId: note.id } });
    // Two original historical rows plus two new pre-restore snapshots, one
    // per concurrent restore call.
    expect(finalVersions).toHaveLength(4);
    const ids = new Set(finalVersions.map((v) => v.id));
    expect(ids.size).toBe(4);
  });

  it('ordering: restore on an unowned note returns 404 NOTE_NOT_FOUND even though versionId is a real, existing version of that note (plan.md Risk #4)', async () => {
    const owner = await seedUser('ordering-owner@example.com');
    const intruder = await seedUser('ordering-intruder@example.com');
    const note = await seedNote({ userId: owner.id, title: 'Owner title A' });

    const patchRes = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(owner.id))
      .send({ title: 'Owner title B' });
    expect(patchRes.status).toBe(200);

    const listRes = await request(app)
      .get(`/notes/${note.id}/versions`)
      .set('Authorization', authHeader(owner.id));
    const realVersionId = (listRes.body as NoteVersionSummary[])[0]!.id;

    const restoreRes = await request(app)
      .post(`/notes/${note.id}/versions/${realVersionId}/restore`)
      .set('Authorization', authHeader(intruder.id));

    expect(restoreRes.status).toBe(404);
    expect(restoreRes.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });

    // No mutation occurred as a side effect of the (rejected) restore.
    const untouched = await prisma.note.findUnique({ where: { id: note.id } });
    expect(untouched?.title).toBe('Owner title B');
    expect(untouched?.version).toBe(2);
    const versions = await prisma.noteVersion.findMany({ where: { noteId: note.id } });
    expect(versions).toHaveLength(1);
  });
});

describe('ordering: preview on an unowned note returns 404 NOTE_NOT_FOUND even though versionId is a real, existing version of that note (plan.md Risk #4)', () => {
  const app = buildApp();

  it('GET /notes/:id/versions/:versionId', async () => {
    const owner = await seedUser('preview-owner@example.com');
    const intruder = await seedUser('preview-intruder@example.com');
    const note = await seedNote({ userId: owner.id, title: 'Owner title A' });

    const patchRes = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(owner.id))
      .send({ title: 'Owner title B' });
    expect(patchRes.status).toBe(200);

    const listRes = await request(app)
      .get(`/notes/${note.id}/versions`)
      .set('Authorization', authHeader(owner.id));
    const realVersionId = (listRes.body as NoteVersionSummary[])[0]!.id;

    const previewRes = await request(app)
      .get(`/notes/${note.id}/versions/${realVersionId}`)
      .set('Authorization', authHeader(intruder.id));

    expect(previewRes.status).toBe(404);
    expect(previewRes.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });
    expect((previewRes.body as { code: string }).code).not.toBe(ErrorCodes.VERSION_NOT_FOUND);
  });
});

describe('auth guard: every /notes/:id/versions route rejects a missing or invalid access token', () => {
  const app = buildApp();
  const FAKE_ID = 'cku0nonexistent0000000001';
  const FAKE_VERSION_ID = 'cku0nonexistent0000000002';

  const routes: Array<{ method: 'get' | 'post'; path: string }> = [
    { method: 'get', path: `/notes/${FAKE_ID}/versions` },
    { method: 'get', path: `/notes/${FAKE_ID}/versions/${FAKE_VERSION_ID}` },
    { method: 'post', path: `/notes/${FAKE_ID}/versions/${FAKE_VERSION_ID}/restore` },
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
