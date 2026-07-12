import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import type { Tag as TagResponse, TagWithCount as TagWithCountResponse, Page } from 'shared/types';
import type { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/jwt';

// Integration tier (AGENTS.md §10 / SDS §14): real Express app, real
// `notes_test` Postgres via the Prisma singleton (vitest.setup.ts already
// forces DATABASE_URL -> TEST_DATABASE_URL before this file loads). Covers
// openspec/changes/AB-1006-tags-crud/spec.md Scenarios 1, 2, 5, 6, 7, 8, 9,
// 10, 11, 21, 22 for the full /tags API surface -- in particular this is the
// only tier that can prove the raw SQL case-insensitive unique index
// (`tag_user_name_ci_idx`) actually enforces uniqueness, since a mocked
// Prisma client cannot simulate a real Postgres constraint violation.
//
// NOTE: at the time this file was written, notes.service.ts/notes.controller.ts
// do not yet accept `tagIds` on POST /notes (that lands in AB-1006 tasks
// 4.1-4.3). Where a scenario requires a note to already carry a tag
// association, this file attaches the NoteTag row directly via the Prisma
// client rather than going through POST /notes. The fuller cross-check (tag
// counts moving as notes are created/deleted through the real /notes API)
// belongs in notes.integration.test.ts once tagIds support lands (task 4.5).

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
  deletedAt?: Date | null;
}

async function seedNote(options: SeedNoteOptions): Promise<{ id: string }> {
  const note = await prisma.note.create({
    data: {
      userId: options.userId,
      title: options.title ?? 'Seeded note',
      body: DEFAULT_BODY as Prisma.InputJsonValue,
      bodyText: '',
      deletedAt: options.deletedAt ?? null,
    },
  });
  return { id: note.id };
}

async function attachTag(noteId: string, tagId: string): Promise<void> {
  await prisma.noteTag.create({ data: { noteId, tagId } });
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('POST /tags', () => {
  const app = buildApp();

  it('#1 creates a tag with valid name/color -> 201, tag scoped to the caller only', async () => {
    const user = await seedUser('create1@example.com');

    const res = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Work', color: 'blue' });

    expect(res.status).toBe(201);
    const body = res.body as TagResponse;
    expect(body.name).toBe('Work');
    expect(body.color).toBe('blue');
    expect(typeof body.id).toBe('string');

    const stored = await prisma.tag.findUnique({ where: { id: body.id } });
    expect(stored?.userId).toBe(user.id);
  });

  it('#3 rejects a color outside the fixed enum -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('create3@example.com');

    const res = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Work', color: 'magenta' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#4 rejects an empty name -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('create4a@example.com');

    const res = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: '', color: 'blue' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#4 rejects a name over 50 chars -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('create4b@example.com');

    const res = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'x'.repeat(51), color: 'blue' });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });

    const count = await prisma.tag.count();
    expect(count).toBe(0);
  });

  it('#2 rejects a name that collides case-insensitively with an existing tag of the same user -> 409 TAG_NAME_DUPLICATE (proves the raw SQL unique index)', async () => {
    const user = await seedUser('create2@example.com');

    const first = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Work', color: 'blue' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'work', color: 'green' });

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: ErrorCodes.TAG_NAME_DUPLICATE });

    const count = await prisma.tag.count({ where: { userId: user.id } });
    expect(count).toBe(1);
  });

  it('#5 two different users can each create a tag named "Work" without conflict (per-user scoping)', async () => {
    const userA = await seedUser('userA5@example.com');
    const userB = await seedUser('userB5@example.com');

    const resA = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(userA.id))
      .send({ name: 'Work', color: 'blue' });
    const resB = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(userB.id))
      .send({ name: 'Work', color: 'red' });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
    expect((resA.body as TagResponse).id).not.toBe((resB.body as TagResponse).id);
  });
});

describe('GET /tags', () => {
  const app = buildApp();

  it('#6 returns a fresh tag with noteCount 0', async () => {
    const user = await seedUser('list6a@example.com');
    await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Fresh', color: 'blue' });

    const res = await request(app).get('/tags').set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<TagWithCountResponse>;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.noteCount).toBe(0);
  });

  it('#6 noteCount reflects only active (non-deleted) notes -- attach a tag to two notes then soft-delete one, expect noteCount 1', async () => {
    const user = await seedUser('list6b@example.com');
    const tagRes = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Active', color: 'blue' });
    const tagId = (tagRes.body as TagResponse).id;

    const noteA = await seedNote({ userId: user.id, title: 'Note A' });
    const noteB = await seedNote({ userId: user.id, title: 'Note B' });
    await attachTag(noteA.id, tagId);
    await attachTag(noteB.id, tagId);

    const beforeDelete = await request(app).get('/tags').set('Authorization', authHeader(user.id));
    const beforeBody = beforeDelete.body as Page<TagWithCountResponse>;
    expect(beforeBody.items.find((t) => t.id === tagId)?.noteCount).toBe(2);

    const deleteRes = await request(app)
      .delete(`/notes/${noteB.id}`)
      .set('Authorization', authHeader(user.id));
    expect(deleteRes.status).toBe(204);

    const afterDelete = await request(app).get('/tags').set('Authorization', authHeader(user.id));
    expect(afterDelete.status).toBe(200);
    const afterBody = afterDelete.body as Page<TagWithCountResponse>;
    expect(afterBody.items.find((t) => t.id === tagId)?.noteCount).toBe(1);
  });

  it('paginates correctly across two pages', async () => {
    const user = await seedUser('list-paginate@example.com');
    for (let i = 0; i < 15; i += 1) {
      await request(app)
        .post('/tags')
        .set('Authorization', authHeader(user.id))
        .send({ name: `Tag ${i}`, color: 'blue' });
    }

    const page1 = await request(app)
      .get('/tags')
      .query({ page: 1, pageSize: 10 })
      .set('Authorization', authHeader(user.id));
    expect(page1.status).toBe(200);
    const page1Body = page1.body as Page<TagWithCountResponse>;
    expect(page1Body.items).toHaveLength(10);
    expect(page1Body.totalItems).toBe(15);
    expect(page1Body.totalPages).toBe(2);

    const page2 = await request(app)
      .get('/tags')
      .query({ page: 2, pageSize: 10 })
      .set('Authorization', authHeader(user.id));
    expect(page2.status).toBe(200);
    const page2Body = page2.body as Page<TagWithCountResponse>;
    expect(page2Body.items).toHaveLength(5);
  });

  it('only returns tags owned by the caller', async () => {
    const userA = await seedUser('scopeA@example.com');
    const userB = await seedUser('scopeB@example.com');
    await request(app)
      .post('/tags')
      .set('Authorization', authHeader(userA.id))
      .send({ name: 'Mine', color: 'blue' });
    await request(app)
      .post('/tags')
      .set('Authorization', authHeader(userB.id))
      .send({ name: 'Theirs', color: 'red' });

    const res = await request(app).get('/tags').set('Authorization', authHeader(userA.id));
    const body = res.body as Page<TagWithCountResponse>;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.name).toBe('Mine');
  });
});

describe('PATCH /tags/:id', () => {
  const app = buildApp();

  it('#7 updates own tag name and color -> 200', async () => {
    const user = await seedUser('update7@example.com');
    const created = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Work', color: 'blue' });
    const tagId = (created.body as TagResponse).id;

    const res = await request(app)
      .patch(`/tags/${tagId}`)
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Personal', color: 'green' });

    expect(res.status).toBe(200);
    const body = res.body as TagResponse;
    expect(body.name).toBe('Personal');
    expect(body.color).toBe('green');
  });

  it('#8 renaming own tag to collide (case-insensitively) with another of the same user\'s tags -> 409 TAG_NAME_DUPLICATE', async () => {
    const user = await seedUser('update8@example.com');
    await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Work', color: 'blue' });
    const second = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Personal', color: 'green' });
    const secondId = (second.body as TagResponse).id;

    const res = await request(app)
      .patch(`/tags/${secondId}`)
      .set('Authorization', authHeader(user.id))
      .send({ name: 'work' });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: ErrorCodes.TAG_NAME_DUPLICATE });

    const stillThere = await prisma.tag.findUnique({ where: { id: secondId } });
    expect(stillThere?.name).toBe('Personal');
  });

  it('#9 attempting to update a tag belonging to another user -> 404 TAG_NOT_FOUND', async () => {
    const owner = await seedUser('owner9@example.com');
    const intruder = await seedUser('intruder9@example.com');
    const created = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(owner.id))
      .send({ name: 'Owner Tag', color: 'blue' });
    const tagId = (created.body as TagResponse).id;

    const res = await request(app)
      .patch(`/tags/${tagId}`)
      .set('Authorization', authHeader(intruder.id))
      .send({ name: 'Hijacked' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.TAG_NOT_FOUND });

    const stillThere = await prisma.tag.findUnique({ where: { id: tagId } });
    expect(stillThere?.name).toBe('Owner Tag');
  });

  it('updating a nonexistent tag id -> 404 TAG_NOT_FOUND', async () => {
    const user = await seedUser('update-missing@example.com');
    const FAKE_ID = 'cku0nonexistent0000000001';

    const res = await request(app)
      .patch(`/tags/${FAKE_ID}`)
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Anything' });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.TAG_NOT_FOUND });
  });

  it('rejects a body with neither name nor color -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('update-empty@example.com');
    const created = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Work', color: 'blue' });
    const tagId = (created.body as TagResponse).id;

    const res = await request(app)
      .patch(`/tags/${tagId}`)
      .set('Authorization', authHeader(user.id))
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });
});

describe('DELETE /tags/:id', () => {
  const app = buildApp();

  it('#10 deletes a tag attached to several notes -> 204; the notes remain fully intact, just missing this tag\'s association', async () => {
    const user = await seedUser('delete10@example.com');
    const created = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Doomed', color: 'blue' });
    const tagId = (created.body as TagResponse).id;

    const noteA = await seedNote({ userId: user.id, title: 'Note A' });
    const noteB = await seedNote({ userId: user.id, title: 'Note B' });
    await attachTag(noteA.id, tagId);
    await attachTag(noteB.id, tagId);

    const res = await request(app).delete(`/tags/${tagId}`).set('Authorization', authHeader(user.id));

    expect(res.status).toBe(204);

    const tagStored = await prisma.tag.findUnique({ where: { id: tagId } });
    expect(tagStored).toBeNull();

    const noteTags = await prisma.noteTag.findMany({ where: { tagId } });
    expect(noteTags).toHaveLength(0);

    const noteAStored = await prisma.note.findUnique({ where: { id: noteA.id } });
    const noteBStored = await prisma.note.findUnique({ where: { id: noteB.id } });
    expect(noteAStored).not.toBeNull();
    expect(noteAStored?.title).toBe('Note A');
    expect(noteAStored?.deletedAt).toBeNull();
    expect(noteBStored).not.toBeNull();
    expect(noteBStored?.title).toBe('Note B');
    expect(noteBStored?.deletedAt).toBeNull();
  });

  it('#11 attempting to delete a tag belonging to another user -> 404 TAG_NOT_FOUND, tag untouched', async () => {
    const owner = await seedUser('owner11@example.com');
    const intruder = await seedUser('intruder11@example.com');
    const created = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(owner.id))
      .send({ name: 'Owner Tag', color: 'blue' });
    const tagId = (created.body as TagResponse).id;

    const res = await request(app)
      .delete(`/tags/${tagId}`)
      .set('Authorization', authHeader(intruder.id));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.TAG_NOT_FOUND });

    const stillThere = await prisma.tag.findUnique({ where: { id: tagId } });
    expect(stillThere).not.toBeNull();
  });

  it('#11 attempting to delete a nonexistent tag id -> 404 TAG_NOT_FOUND', async () => {
    const user = await seedUser('delete-missing@example.com');
    const FAKE_ID = 'cku0nonexistent0000000002';

    const res = await request(app).delete(`/tags/${FAKE_ID}`).set('Authorization', authHeader(user.id));

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ code: ErrorCodes.TAG_NOT_FOUND });
  });

  it('deleting an already-deleted tag twice -> second call 404 TAG_NOT_FOUND', async () => {
    const user = await seedUser('double-delete@example.com');
    const created = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Once', color: 'blue' });
    const tagId = (created.body as TagResponse).id;

    const first = await request(app).delete(`/tags/${tagId}`).set('Authorization', authHeader(user.id));
    expect(first.status).toBe(204);

    const second = await request(app).delete(`/tags/${tagId}`).set('Authorization', authHeader(user.id));
    expect(second.status).toBe(404);
    expect(second.body).toMatchObject({ code: ErrorCodes.TAG_NOT_FOUND });
  });
});

describe('full CRUD lifecycle', () => {
  const app = buildApp();

  it('create -> list -> update -> delete, each step reflected in the next', async () => {
    const user = await seedUser('lifecycle@example.com');

    const createRes = await request(app)
      .post('/tags')
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Lifecycle', color: 'purple' });
    expect(createRes.status).toBe(201);
    const tagId = (createRes.body as TagResponse).id;

    const listRes = await request(app).get('/tags').set('Authorization', authHeader(user.id));
    expect(listRes.status).toBe(200);
    const listBody = listRes.body as Page<TagWithCountResponse>;
    expect(listBody.items).toHaveLength(1);
    expect(listBody.items[0]).toMatchObject({ id: tagId, name: 'Lifecycle', color: 'purple', noteCount: 0 });

    const updateRes = await request(app)
      .patch(`/tags/${tagId}`)
      .set('Authorization', authHeader(user.id))
      .send({ name: 'Lifecycle Renamed' });
    expect(updateRes.status).toBe(200);
    expect((updateRes.body as TagResponse).name).toBe('Lifecycle Renamed');

    const listAfterUpdate = await request(app).get('/tags').set('Authorization', authHeader(user.id));
    const listAfterUpdateBody = listAfterUpdate.body as Page<TagWithCountResponse>;
    expect(listAfterUpdateBody.items[0]?.name).toBe('Lifecycle Renamed');

    const deleteRes = await request(app).delete(`/tags/${tagId}`).set('Authorization', authHeader(user.id));
    expect(deleteRes.status).toBe(204);

    const listAfterDelete = await request(app).get('/tags').set('Authorization', authHeader(user.id));
    const listAfterDeleteBody = listAfterDelete.body as Page<TagWithCountResponse>;
    expect(listAfterDeleteBody.items).toHaveLength(0);
    expect(listAfterDeleteBody.totalItems).toBe(0);
  });
});

describe('#22 auth guard: every /tags route rejects a missing or invalid access token', () => {
  const app = buildApp();
  const FAKE_ID = 'cku0nonexistent0000000003';

  const routes: Array<{ method: 'get' | 'post' | 'patch' | 'delete'; path: string }> = [
    { method: 'get', path: '/tags' },
    { method: 'post', path: '/tags' },
    { method: 'patch', path: `/tags/${FAKE_ID}` },
    { method: 'delete', path: `/tags/${FAKE_ID}` },
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
