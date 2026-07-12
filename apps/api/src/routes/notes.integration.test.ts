import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import type { Note as NoteResponse, Tag as TagResponse, Page } from 'shared/types';
import type { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/jwt';
import { purgeNotes } from '../lib/jobs/purgeNotes';

// Integration tier (AGENTS.md §10 / SDS §14): real Express app, real
// `notes_test` Postgres via the Prisma singleton (vitest.setup.ts already
// forces DATABASE_URL -> TEST_DATABASE_URL before this file loads). Covers
// spec.md Scenarios 1-13 and 15 for the full /notes API surface. Scenario 14
// (the purgeNotes cron job itself) is covered by lib/jobs/purgeNotes.test.ts
// and is not duplicated here -- purgeNotes is only invoked directly below to
// simulate Scenario 13's "restore after purge" case.
//
// AB-1005 (Notes List & Filtering) extends this suite with Scenarios 1-8 of
// openspec/changes/AB-1005-notes-listing/spec.md, covering the new `sort`
// query param on GET /notes and confirming GET /notes/trash is untouched.
//
// AB-1006 (Tags Architecture) extends this suite with Scenarios 12-20 of
// openspec/changes/AB-1006-tags-crud/spec.md, covering `tagIds` on
// POST/PATCH /notes, the `tagIds` AND-filter on GET /notes (replacing the
// AB-1005-era placeholder test that documented the deferral), and confirming
// `tagIds` survives GET /notes/:id, GET /notes/trash, and restore.

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
  // NoteTag/Tag first for explicitness, even though the Cascade FKs from
  // Note/User would otherwise sweep them up transitively via the deletes below.
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
  createdAt?: Date;
}

async function seedNote(options: SeedNoteOptions): Promise<{
  id: string;
  title: string;
  body: Record<string, unknown>;
  createdAt: Date;
  deletedAt: Date | null;
}> {
  const note = await prisma.note.create({
    data: {
      userId: options.userId,
      title: options.title ?? 'Seeded note',
      body: (options.body ?? DEFAULT_BODY) as Prisma.InputJsonValue,
      bodyText: '',
      deletedAt: options.deletedAt ?? null,
      ...(options.createdAt && { createdAt: options.createdAt }),
    },
  });
  return {
    id: note.id,
    title: note.title,
    body: note.body as Record<string, unknown>,
    createdAt: note.createdAt,
    deletedAt: note.deletedAt,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

// Creates a Tag row directly via Prisma (bypassing the /tags HTTP surface,
// which is exercised in full by tags.integration.test.ts) so these /notes
// tests can focus purely on the tagIds association contract.
async function seedTag(userId: string, name: string, color = 'blue'): Promise<{ id: string }> {
  const tag = await prisma.tag.create({ data: { userId, name, color } });
  return { id: tag.id };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('POST /notes', () => {
  const app = buildApp();

  it('#1 creates a note with valid title/body -> 201, version: 1, no NoteVersion row yet', async () => {
    const user = await seedUser('create1@example.com');

    const res = await request(app)
      .post('/notes')
      .set('Authorization', authHeader(user.id))
      .send({ title: 'My first note', body: DEFAULT_BODY });

    expect(res.status).toBe(201);
    const body = res.body as NoteResponse;
    expect(body.title).toBe('My first note');
    expect(body.body).toEqual(DEFAULT_BODY);
    expect(body.version).toBe(1);
    expect(body.deletedAt).toBeNull();
    expect(typeof body.id).toBe('string');
    expect(body.tagIds).toEqual([]);

    const versions = await prisma.noteVersion.findMany({ where: { noteId: body.id } });
    expect(versions).toHaveLength(0);
  });

  it('#2 rejects an empty title -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('create2a@example.com');

    const res = await request(app)
      .post('/notes')
      .set('Authorization', authHeader(user.id))
      .send({ title: '', body: DEFAULT_BODY });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#2 rejects a title over 200 chars -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('create2b@example.com');

    const res = await request(app)
      .post('/notes')
      .set('Authorization', authHeader(user.id))
      .send({ title: 'x'.repeat(201), body: DEFAULT_BODY });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });

    const count = await prisma.note.count();
    expect(count).toBe(0);
  });

  // AB-1006 (Tags Architecture) -- tagIds on note create.
  // openspec/changes/AB-1006-tags-crud/spec.md Scenarios 12-13.

  it('AB-1006 #12 creates a note with tagIds referencing only tags the caller owns -> 201, response tagIds matches what was sent', async () => {
    const user = await seedUser('tagcreate12@example.com');
    const tagRes = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Work', color: 'blue' });
    expect(tagRes.status).toBe(201);
    const tag = tagRes.body as TagResponse;

    const res = await request(app)
      .post('/notes')
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Tagged note', body: DEFAULT_BODY, tagIds: [tag.id] });

    expect(res.status).toBe(201);
    const body = res.body as NoteResponse;
    expect(body.tagIds).toEqual([tag.id]);
  });

  it("AB-1006 #13 creates a note with a tagIds entry belonging to another user -> 422 INVALID_TAG, note is not created", async () => {
    const owner = await seedUser('tagcreate13owner@example.com');
    const intruder = await seedUser('tagcreate13intruder@example.com');
    const ownerTag = await seedTag(owner.id, 'Owner Tag');

    const res = await request(app)
      .post('/notes')
      .set('Authorization', authHeader(intruder.id))
      .send({ title: 'Should not be created', body: DEFAULT_BODY, tagIds: [ownerTag.id] });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: ErrorCodes.INVALID_TAG });

    const list = await request(app).get('/notes').set('Authorization', authHeader(intruder.id));
    const listBody = list.body as Page<NoteResponse>;
    expect(listBody.items).toHaveLength(0);
    expect(listBody.totalItems).toBe(0);
  });

  it('AB-1006 #13b creates a note with a nonexistent tagIds entry -> 422 INVALID_TAG, note is not created', async () => {
    const user = await seedUser('tagcreate13b@example.com');

    const res = await request(app)
      .post('/notes')
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Should not be created', body: DEFAULT_BODY, tagIds: ['nonexistent-tag-id'] });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: ErrorCodes.INVALID_TAG });

    const count = await prisma.note.count({ where: { userId: user.id } });
    expect(count).toBe(0);
  });
});

describe('GET /notes/:id', () => {
  const app = buildApp();

  it('#3 reads own active note -> 200 full content', async () => {
    const user = await seedUser('read3@example.com');
    const note = await seedNote({ userId: user.id, title: 'Readable note' });

    const res = await request(app).get(`/notes/${note.id}`).set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as NoteResponse;
    expect(body.id).toBe(note.id);
    expect(body.title).toBe('Readable note');
    expect(body.body).toEqual(DEFAULT_BODY);
  });

  it("#4 reading another user's note -> 404 NOTE_NOT_FOUND", async () => {
    const owner = await seedUser('owner4@example.com');
    const intruder = await seedUser('intruder4@example.com');
    const note = await seedNote({ userId: owner.id, title: "Owner's note" });

    const res = await request(app)
      .get(`/notes/${note.id}`)
      .set('Authorization', authHeader(intruder.id));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });
  });

  it('#5 reading own soft-deleted note -> 404 NOTE_NOT_FOUND', async () => {
    const user = await seedUser('read5@example.com');
    const note = await seedNote({ userId: user.id, title: 'Trashed note', deletedAt: new Date() });

    const res = await request(app).get(`/notes/${note.id}`).set('Authorization', authHeader(user.id));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });
  });

  it('AB-1006 #20a GET /notes/:id includes tagIds in its response', async () => {
    const user = await seedUser('tagget20a@example.com');
    const tag = await seedTag(user.id, 'Personal');
    const note = await seedNote({ userId: user.id, title: 'Tagged read' });
    await prisma.noteTag.create({ data: { noteId: note.id, tagId: tag.id } });

    const res = await request(app).get(`/notes/${note.id}`).set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as NoteResponse;
    expect(body.tagIds).toEqual([tag.id]);
  });
});

describe('PATCH /notes/:id', () => {
  const app = buildApp();

  it('#6 updates title/body -> 200, version incremented, exactly one new NoteVersion row with the PRE-update title/body', async () => {
    const user = await seedUser('update6@example.com');
    const preBody = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    const note = await seedNote({ userId: user.id, title: 'Before update', body: preBody });

    const res = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'After update', body: DEFAULT_BODY });

    expect(res.status).toBe(200);
    const body = res.body as NoteResponse;
    expect(body.title).toBe('After update');
    expect(body.body).toEqual(DEFAULT_BODY);
    expect(body.version).toBe(2);

    const versions = await prisma.noteVersion.findMany({ where: { noteId: note.id } });
    expect(versions).toHaveLength(1);
    expect(versions[0]?.version).toBe(1);
    expect(versions[0]?.title).toBe('Before update');
    expect(versions[0]?.body).toEqual(preBody);
  });

  it('#7 updating a soft-deleted note -> 404 NOTE_NOT_FOUND', async () => {
    const user = await seedUser('update7@example.com');
    const note = await seedNote({ userId: user.id, title: 'Trashed', deletedAt: new Date() });

    const res = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Should not apply' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });

    const versions = await prisma.noteVersion.findMany({ where: { noteId: note.id } });
    expect(versions).toHaveLength(0);
  });

  // AB-1006 (Tags Architecture) -- tagIds full-set replacement on note update.
  // openspec/changes/AB-1006-tags-crud/spec.md Scenarios 14-16.

  it('AB-1006 #14 PATCH with a new tagIds array -> 200, tags fully replaced (old tag detached, new tag attached)', async () => {
    const user = await seedUser('tagupdate14@example.com');
    const oldTag = await seedTag(user.id, 'Old Tag');
    const newTag = await seedTag(user.id, 'New Tag');
    const note = await seedNote({ userId: user.id, title: 'Replace my tags' });
    await prisma.noteTag.create({ data: { noteId: note.id, tagId: oldTag.id } });

    const res = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ tagIds: [newTag.id] });

    expect(res.status).toBe(200);
    const body = res.body as NoteResponse;
    expect(body.tagIds).toEqual([newTag.id]);

    const getRes = await request(app).get(`/notes/${note.id}`).set('Authorization', authHeader(user.id));
    expect((getRes.body as NoteResponse).tagIds).toEqual([newTag.id]);

    const remainingLinks = await prisma.noteTag.findMany({ where: { noteId: note.id } });
    expect(remainingLinks).toHaveLength(1);
    expect(remainingLinks[0]?.tagId).toBe(newTag.id);
  });

  it('AB-1006 #16 PATCH with only { title } (no tagIds key) -> 200, existing tag associations untouched', async () => {
    const user = await seedUser('tagupdate16@example.com');
    const tag = await seedTag(user.id, 'Keep Me');
    const note = await seedNote({ userId: user.id, title: 'Title only update' });
    await prisma.noteTag.create({ data: { noteId: note.id, tagId: tag.id } });

    const res = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'New title, tags untouched' });

    expect(res.status).toBe(200);
    const body = res.body as NoteResponse;
    expect(body.title).toBe('New title, tags untouched');
    expect(body.tagIds).toEqual([tag.id]);

    const remainingLinks = await prisma.noteTag.findMany({ where: { noteId: note.id } });
    expect(remainingLinks).toHaveLength(1);
    expect(remainingLinks[0]?.tagId).toBe(tag.id);
  });

  it('AB-1006 #15 PATCH with an invalid/unowned tagIds entry -> 422 INVALID_TAG, no partial update applied (title/body/tags all unchanged)', async () => {
    const user = await seedUser('tagupdate15@example.com');
    const intruder = await seedUser('tagupdate15intruder@example.com');
    const keptTag = await seedTag(user.id, 'Kept Tag');
    const intruderTag = await seedTag(intruder.id, 'Not Yours');
    const note = await seedNote({ userId: user.id, title: 'Original title' });
    await prisma.noteTag.create({ data: { noteId: note.id, tagId: keptTag.id } });

    const res = await request(app)
      .patch(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Should not apply', tagIds: [intruderTag.id] });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: ErrorCodes.INVALID_TAG });

    const getRes = await request(app).get(`/notes/${note.id}`).set('Authorization', authHeader(user.id));
    expect(getRes.status).toBe(200);
    const body = getRes.body as NoteResponse;
    expect(body.title).toBe('Original title');
    expect(body.tagIds).toEqual([keptTag.id]);

    const versions = await prisma.noteVersion.findMany({ where: { noteId: note.id } });
    expect(versions).toHaveLength(0);
  });
});

describe('DELETE /notes/:id', () => {
  const app = buildApp();

  it('#8 soft-deletes an active note -> 204, deletedAt set (row still in DB), disappears from GET /notes, appears in GET /notes/trash', async () => {
    const user = await seedUser('delete8@example.com');
    const note = await seedNote({ userId: user.id, title: 'To be deleted' });

    const res = await request(app)
      .delete(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id));
    expect(res.status).toBe(204);

    const stored = await prisma.note.findUnique({ where: { id: note.id } });
    expect(stored).not.toBeNull();
    expect(stored?.deletedAt).not.toBeNull();

    const list = await request(app).get('/notes').set('Authorization', authHeader(user.id));
    expect(list.status).toBe(200);
    const listBody = list.body as Page<NoteResponse>;
    expect(listBody.items.find((n) => n.id === note.id)).toBeUndefined();

    const trash = await request(app).get('/notes/trash').set('Authorization', authHeader(user.id));
    expect(trash.status).toBe(200);
    const trashBody = trash.body as Page<NoteResponse>;
    expect(trashBody.items.find((n) => n.id === note.id)).not.toBeUndefined();
  });

  it('#9 deleting an already-deleted note twice -> second call 404 NOTE_NOT_FOUND', async () => {
    const user = await seedUser('delete9@example.com');
    const note = await seedNote({ userId: user.id, title: 'Double delete' });

    const first = await request(app)
      .delete(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id));
    expect(first.status).toBe(204);

    const second = await request(app)
      .delete(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id));
    expect(second.status).toBe(404);
    expect(second.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });
  });
});

describe('GET /notes', () => {
  const app = buildApp();

  it('#10 paginates correctly: page 1 has 10 items newest-first, page 2 has the remaining 5, correct envelope totals', async () => {
    const user = await seedUser('list10@example.com');
    const base = Date.now();

    for (let i = 0; i < 15; i += 1) {
      await seedNote({
        userId: user.id,
        title: `Note ${i}`,
        createdAt: new Date(base + i * 1000),
      });
    }

    const page1 = await request(app)
      .get('/notes')
      .query({ page: 1, pageSize: 10 })
      .set('Authorization', authHeader(user.id));
    expect(page1.status).toBe(200);
    const page1Body = page1.body as Page<NoteResponse>;
    expect(page1Body.items).toHaveLength(10);
    expect(page1Body.totalItems).toBe(15);
    expect(page1Body.totalPages).toBe(2);
    expect(page1Body.page).toBe(1);
    expect(page1Body.pageSize).toBe(10);
    expect(page1Body.items.map((n) => n.title)).toEqual([
      'Note 14',
      'Note 13',
      'Note 12',
      'Note 11',
      'Note 10',
      'Note 9',
      'Note 8',
      'Note 7',
      'Note 6',
      'Note 5',
    ]);

    const page2 = await request(app)
      .get('/notes')
      .query({ page: 2, pageSize: 10 })
      .set('Authorization', authHeader(user.id));
    expect(page2.status).toBe(200);
    const page2Body = page2.body as Page<NoteResponse>;
    expect(page2Body.items).toHaveLength(5);
    expect(page2Body.items.map((n) => n.title)).toEqual([
      'Note 4',
      'Note 3',
      'Note 2',
      'Note 1',
      'Note 0',
    ]);
  });

  it('excludes soft-deleted notes from the list', async () => {
    const user = await seedUser('list10b@example.com');
    await seedNote({ userId: user.id, title: 'Active' });
    const trashed = await seedNote({ userId: user.id, title: 'Trashed', deletedAt: new Date() });

    const res = await request(app).get('/notes').set('Authorization', authHeader(user.id));
    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items.find((n) => n.id === trashed.id)).toBeUndefined();
    expect(body.totalItems).toBe(1);
  });

  // AB-1005 (Notes List & Filtering) -- sort query param coverage.
  // openspec/changes/AB-1005-notes-listing/spec.md Scenarios 2-7.

  it('AB-1005 #2 sort=createdAt:asc -> oldest-created note first', async () => {
    const user = await seedUser('sort2createdasc@example.com');
    const base = Date.now();

    for (let i = 0; i < 5; i += 1) {
      await seedNote({
        userId: user.id,
        title: `Note ${i}`,
        createdAt: new Date(base + i * 1000),
      });
    }

    const res = await request(app)
      .get('/notes')
      .query({ sort: 'createdAt:asc' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items.map((n) => n.title)).toEqual([
      'Note 0',
      'Note 1',
      'Note 2',
      'Note 3',
      'Note 4',
    ]);
  });

  it('AB-1005 sort=createdAt:desc (explicit) -> newest-created note first, same as the default order', async () => {
    const user = await seedUser('sortcreateddesc@example.com');
    const base = Date.now();

    for (let i = 0; i < 5; i += 1) {
      await seedNote({
        userId: user.id,
        title: `Note ${i}`,
        createdAt: new Date(base + i * 1000),
      });
    }

    const res = await request(app)
      .get('/notes')
      .query({ sort: 'createdAt:desc' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items.map((n) => n.title)).toEqual([
      'Note 4',
      'Note 3',
      'Note 2',
      'Note 1',
      'Note 0',
    ]);
  });

  it('AB-1005 #3 sort=updatedAt:desc -> most-recently-updated note first, even though it was created oldest (plan.md Risk Area 5)', async () => {
    const user = await seedUser('sort3updateddesc@example.com');
    const base = Date.now();

    const noteA = await seedNote({
      userId: user.id,
      title: 'Note A (oldest created)',
      createdAt: new Date(base),
    });
    const noteB = await seedNote({
      userId: user.id,
      title: 'Note B',
      createdAt: new Date(base + 1000),
    });
    const noteC = await seedNote({
      userId: user.id,
      title: 'Note C (newest created)',
      createdAt: new Date(base + 2000),
    });

    // PATCH the OLDEST-created note last, so its updatedAt diverges from
    // createdAt order -- a same-timestamp seed would pass even with a
    // broken updatedAt sort.
    const patchRes = await request(app)
      .patch(`/notes/${noteA.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Note A (oldest created, just updated)' });
    expect(patchRes.status).toBe(200);

    const res = await request(app)
      .get('/notes')
      .query({ sort: 'updatedAt:desc' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items.map((n) => n.id)).toEqual([noteA.id, noteC.id, noteB.id]);
  });

  it('AB-1005 #4 sort=updatedAt:asc -> least-recently-updated note first', async () => {
    const user = await seedUser('sort4updatedasc@example.com');
    const base = Date.now();

    const noteA = await seedNote({
      userId: user.id,
      title: 'Note A (oldest created)',
      createdAt: new Date(base),
    });
    const noteB = await seedNote({
      userId: user.id,
      title: 'Note B',
      createdAt: new Date(base + 1000),
    });
    const noteC = await seedNote({
      userId: user.id,
      title: 'Note C (newest created)',
      createdAt: new Date(base + 2000),
    });

    // Same setup as the updatedAt:desc case above, opposite assertion.
    const patchRes = await request(app)
      .patch(`/notes/${noteA.id}`)
      .set('Authorization', authHeader(user.id))
      .send({ title: 'Note A (oldest created, just updated)' });
    expect(patchRes.status).toBe(200);

    const res = await request(app)
      .get('/notes')
      .query({ sort: 'updatedAt:asc' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items.map((n) => n.id)).toEqual([noteB.id, noteC.id, noteA.id]);
  });

  it('AB-1005 #5 sort=title:desc (out-of-enum value) -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('sort5invalid@example.com');
    await seedNote({ userId: user.id, title: 'Irrelevant' });

    const res = await request(app)
      .get('/notes')
      .query({ sort: 'title:desc' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('AB-1005 #7 sort=updatedAt:desc composes correctly with pagination across two pages', async () => {
    const user = await seedUser('sort7pagination@example.com');
    const base = Date.now();

    const notes: { id: string; title: string }[] = [];
    for (let i = 0; i < 12; i += 1) {
      const note = await seedNote({
        userId: user.id,
        title: `Note ${i}`,
        createdAt: new Date(base + i * 1000),
      });
      notes.push(note);
    }

    // Force updatedAt to be the EXACT INVERSE of createdAt order (Note 0
    // gets the newest updatedAt, Note 11 the oldest), so this test can only
    // pass if pagination genuinely sorts by updatedAt across both pages,
    // rather than silently falling back to createdAt order.
    for (let i = 0; i < notes.length; i += 1) {
      const note = notes[i];
      if (!note) continue;
      await prisma.note.update({
        where: { id: note.id },
        data: { updatedAt: new Date(base + (11 - i) * 1000) },
      });
    }

    const page1 = await request(app)
      .get('/notes')
      .query({ sort: 'updatedAt:desc', page: 1, pageSize: 5 })
      .set('Authorization', authHeader(user.id));
    expect(page1.status).toBe(200);
    const page1Body = page1.body as Page<NoteResponse>;
    expect(page1Body.totalItems).toBe(12);
    expect(page1Body.totalPages).toBe(3);
    expect(page1Body.items.map((n) => n.title)).toEqual([
      'Note 0',
      'Note 1',
      'Note 2',
      'Note 3',
      'Note 4',
    ]);

    const page2 = await request(app)
      .get('/notes')
      .query({ sort: 'updatedAt:desc', page: 2, pageSize: 5 })
      .set('Authorization', authHeader(user.id));
    expect(page2.status).toBe(200);
    const page2Body = page2.body as Page<NoteResponse>;
    expect(page2Body.items.map((n) => n.title)).toEqual([
      'Note 5',
      'Note 6',
      'Note 7',
      'Note 8',
      'Note 9',
    ]);
  });

  // AB-1006 (Tags Architecture) -- tagIds AND-filter on GET /notes, replacing
  // the AB-1005-era placeholder that documented this as deferred.
  // openspec/changes/AB-1006-tags-crud/spec.md Scenarios 17-19.

  it('AB-1006 #17 tagIds=A,B where a note has both A and B and another note has only A -> only the both-tags note is returned (AND semantics)', async () => {
    const user = await seedUser('tagfilter17@example.com');
    const tagA = await seedTag(user.id, 'Tag A');
    const tagB = await seedTag(user.id, 'Tag B');
    const noteBoth = await seedNote({ userId: user.id, title: 'Has both tags' });
    const noteOnlyA = await seedNote({ userId: user.id, title: 'Has only tag A' });
    await prisma.noteTag.createMany({
      data: [
        { noteId: noteBoth.id, tagId: tagA.id },
        { noteId: noteBoth.id, tagId: tagB.id },
        { noteId: noteOnlyA.id, tagId: tagA.id },
      ],
    });

    const res = await request(app)
      .get('/notes')
      .query({ tagIds: `${tagA.id},${tagB.id}` })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items.map((n) => n.id)).toEqual([noteBoth.id]);
    expect(body.totalItems).toBe(1);
  });

  it('AB-1006 #18 tagIds=<unowned-or-nonexistent-id> -> 200 with zero matching notes, not an error', async () => {
    const user = await seedUser('tagfilter18@example.com');
    await seedNote({ userId: user.id, title: 'Untagged note' });

    const res = await request(app)
      .get('/notes')
      .query({ tagIds: 'nonexistent-tag-id' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items).toEqual([]);
    expect(body.totalItems).toBe(0);
  });

  it('AB-1006 #19 GET /notes with no tagIds -> unchanged from AB-1005, all active notes returned, each carrying its tagIds array (possibly empty)', async () => {
    const user = await seedUser('tagfilter19@example.com');
    const tag = await seedTag(user.id, 'Solo Tag');
    const taggedNote = await seedNote({ userId: user.id, title: 'Tagged' });
    const untaggedNote = await seedNote({ userId: user.id, title: 'Untagged' });
    await prisma.noteTag.create({ data: { noteId: taggedNote.id, tagId: tag.id } });

    const res = await request(app).get('/notes').set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.totalItems).toBe(2);
    const tagged = body.items.find((n) => n.id === taggedNote.id);
    const untagged = body.items.find((n) => n.id === untaggedNote.id);
    expect(tagged?.tagIds).toEqual([tag.id]);
    expect(untagged?.tagIds).toEqual([]);
  });
});

describe('GET /notes/trash', () => {
  const app = buildApp();

  it('#11 paginates using the same Page<Note> envelope, ordered deletedAt desc, and never includes active notes', async () => {
    const user = await seedUser('trash11@example.com');
    const base = Date.now();

    for (let i = 0; i < 12; i += 1) {
      await seedNote({
        userId: user.id,
        title: `Trashed ${i}`,
        deletedAt: new Date(base + i * 1000),
      });
    }
    const activeNote = await seedNote({ userId: user.id, title: 'Still active' });

    const page1 = await request(app)
      .get('/notes/trash')
      .query({ page: 1, pageSize: 10 })
      .set('Authorization', authHeader(user.id));
    expect(page1.status).toBe(200);
    const page1Body = page1.body as Page<NoteResponse>;
    expect(page1Body.items).toHaveLength(10);
    expect(page1Body.totalItems).toBe(12);
    expect(page1Body.totalPages).toBe(2);
    expect(page1Body.items.map((n) => n.title)).toEqual([
      'Trashed 11',
      'Trashed 10',
      'Trashed 9',
      'Trashed 8',
      'Trashed 7',
      'Trashed 6',
      'Trashed 5',
      'Trashed 4',
      'Trashed 3',
      'Trashed 2',
    ]);
    expect(page1Body.items.find((n) => n.id === activeNote.id)).toBeUndefined();

    const page2 = await request(app)
      .get('/notes/trash')
      .query({ page: 2, pageSize: 10 })
      .set('Authorization', authHeader(user.id));
    expect(page2.status).toBe(200);
    const page2Body = page2.body as Page<NoteResponse>;
    expect(page2Body.items).toHaveLength(2);
    expect(page2Body.items.map((n) => n.title)).toEqual(['Trashed 1', 'Trashed 0']);
    expect(page2Body.items.find((n) => n.id === activeNote.id)).toBeUndefined();
  });

  it('is matched correctly and is not swallowed by GET /:id (never looked up as a note literally named "trash")', async () => {
    const user = await seedUser('trashroute12@example.com');

    const res = await request(app).get('/notes/trash').set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items).toEqual([]);
    expect(body.totalItems).toBe(0);
    expect(res.body).not.toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });
  });

  it('AB-1005 #8 a stray sort query param has no effect -- order stays deletedAt desc (AB-1004 contract untouched)', async () => {
    const user = await seedUser('sort8trashstray@example.com');
    const base = Date.now();

    for (let i = 0; i < 3; i += 1) {
      await seedNote({
        userId: user.id,
        title: `Trashed ${i}`,
        deletedAt: new Date(base + i * 1000),
      });
    }

    const res = await request(app)
      .get('/notes/trash')
      .query({ sort: 'updatedAt:asc' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    expect(body.items.map((n) => n.title)).toEqual(['Trashed 2', 'Trashed 1', 'Trashed 0']);
  });

  it('AB-1006 #20b GET /notes/trash includes tagIds in its response', async () => {
    const user = await seedUser('tagtrash20b@example.com');
    const tag = await seedTag(user.id, 'Trash Tag');
    const note = await seedNote({ userId: user.id, title: 'Trashed with tag', deletedAt: new Date() });
    await prisma.noteTag.create({ data: { noteId: note.id, tagId: tag.id } });

    const res = await request(app).get('/notes/trash').set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<NoteResponse>;
    const found = body.items.find((n) => n.id === note.id);
    expect(found?.tagIds).toEqual([tag.id]);
  });
});

describe('POST /notes/:id/restore', () => {
  const app = buildApp();

  it('#12 restores a note within the 30-day window -> 200, deletedAt cleared, reappears in GET /notes, disappears from GET /notes/trash', async () => {
    const user = await seedUser('restore12@example.com');
    const note = await seedNote({ userId: user.id, title: 'Restorable', deletedAt: new Date() });

    const res = await request(app)
      .post(`/notes/${note.id}/restore`)
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as NoteResponse;
    expect(body.deletedAt).toBeNull();

    const list = await request(app).get('/notes').set('Authorization', authHeader(user.id));
    const listBody = list.body as Page<NoteResponse>;
    expect(listBody.items.find((n) => n.id === note.id)).not.toBeUndefined();

    const trash = await request(app).get('/notes/trash').set('Authorization', authHeader(user.id));
    const trashBody = trash.body as Page<NoteResponse>;
    expect(trashBody.items.find((n) => n.id === note.id)).toBeUndefined();
  });

  it('#13 restoring a note whose 30 days have elapsed and been purged -> 404 NOTE_NOT_FOUND', async () => {
    const user = await seedUser('restore13@example.com');
    const note = await seedNote({
      userId: user.id,
      title: 'Long gone',
      deletedAt: daysAgo(31),
    });

    const purgeResult = await purgeNotes(prisma);
    expect(purgeResult.purgedCount).toBeGreaterThanOrEqual(1);

    const stillThere = await prisma.note.findUnique({ where: { id: note.id } });
    expect(stillThere).toBeNull();

    const res = await request(app)
      .post(`/notes/${note.id}/restore`)
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.NOTE_NOT_FOUND });
  });

  it('AB-1006 #20c restoring a note whose tag was attached before soft-delete -> tagIds survives the delete/restore round trip', async () => {
    const user = await seedUser('tagrestore20c@example.com');
    const tag = await seedTag(user.id, 'Survivor Tag');
    const note = await seedNote({ userId: user.id, title: 'Round trip' });
    await prisma.noteTag.create({ data: { noteId: note.id, tagId: tag.id } });

    const deleteRes = await request(app)
      .delete(`/notes/${note.id}`)
      .set('Authorization', authHeader(user.id));
    expect(deleteRes.status).toBe(204);

    const restoreRes = await request(app)
      .post(`/notes/${note.id}/restore`)
      .set('Authorization', authHeader(user.id));

    expect(restoreRes.status).toBe(200);
    const body = restoreRes.body as NoteResponse;
    expect(body.deletedAt).toBeNull();
    expect(body.tagIds).toEqual([tag.id]);
  });
});

describe('#15 auth guard: every /notes route rejects a missing or invalid access token', () => {
  const app = buildApp();
  const FAKE_ID = 'cku0nonexistent0000000001';

  const routes: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string }> = [
    { method: 'get', path: '/notes/trash' },
    { method: 'get', path: '/notes' },
    { method: 'post', path: '/notes' },
    { method: 'get', path: `/notes/${FAKE_ID}` },
    { method: 'patch', path: `/notes/${FAKE_ID}` },
    { method: 'delete', path: `/notes/${FAKE_ID}` },
    { method: 'post', path: `/notes/${FAKE_ID}/restore` },
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
