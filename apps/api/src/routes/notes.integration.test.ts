import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import type { Note as NoteResponse, Page } from 'shared/types';
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
  // NoteVersion first for explicitness, even though Note.onDelete: Cascade
  // from User would otherwise sweep both up transitively via user.deleteMany().
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
