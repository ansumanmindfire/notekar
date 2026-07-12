import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ErrorCodes } from 'shared/errorCodes';
import type { Page, SearchResultItem } from 'shared/types';
import type { Prisma } from '@prisma/client';
import { createApp } from '../app';
import { prisma } from '../lib/prisma';
import { signAccessToken } from '../lib/jwt';

// Integration tier (AGENTS.md §10 / SDS §14): real Express app, real
// `notes_test` Postgres via the Prisma singleton (vitest.setup.ts already
// forces DATABASE_URL -> TEST_DATABASE_URL before this file loads). This is
// the only tier that can prove the generated `searchVector` tsvector column,
// its GIN index (`note_search_idx`), and the `plainto_tsquery`/`ts_rank`/
// `ts_headline` query path actually behave correctly against real Postgres --
// a mocked Prisma client cannot simulate real full-text search semantics.
// Covers openspec/changes/AB-1007-search/spec.md Scenarios 1-13 and 15.
//
// Scenario 14 (the migration itself creating `searchVector`/`note_search_idx`
// in both notes_dev and notes_test) is implicitly proven by every test below
// even running at all -- none of these queries would execute without the
// generated column and its GIN index existing, so no dedicated test is added
// for it per the task instructions.

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

interface SeedSearchNoteOptions {
  userId: string;
  title?: string;
  bodyText: string;
  deletedAt?: Date | null;
}

// Search reads title + bodyText directly (via the STORED generated
// `searchVector` column) -- so, unlike notes.integration.test.ts's seedNote
// (which hardcodes bodyText: '' since AB-1004/1005/1006 didn't need real
// searchable content), these tests set `bodyText` explicitly via a direct
// Prisma create to control exactly what the generated column indexes.
async function seedSearchNote(options: SeedSearchNoteOptions): Promise<{ id: string }> {
  const note = await prisma.note.create({
    data: {
      userId: options.userId,
      title: options.title ?? 'Untitled',
      body: DEFAULT_BODY as Prisma.InputJsonValue,
      bodyText: options.bodyText,
      deletedAt: options.deletedAt ?? null,
    },
  });
  return { id: note.id };
}

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

describe('GET /search', () => {
  const app = buildApp();

  it('#1 a keyword present only in a note\'s title is returned', async () => {
    const user = await seedUser('search1@example.com');
    const note = await seedSearchNote({
      userId: user.id,
      title: 'Photosynthesis explained',
      bodyText: 'This document covers plant biology basics unrelated to the title.',
    });

    const res = await request(app)
      .get('/search')
      .query({ q: 'photosynthesis' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    expect(body.items.map((r) => r.note.id)).toContain(note.id);
  });

  it('#2 a keyword present only in a note\'s body is returned, headline contains <mark> around the term', async () => {
    const user = await seedUser('search2@example.com');
    const note = await seedSearchNote({
      userId: user.id,
      title: 'Random title here',
      bodyText: 'The old lighthouse keeper walked along the rocky shoreline at dawn.',
    });

    const res = await request(app)
      .get('/search')
      .query({ q: 'lighthouse' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    const match = body.items.find((r) => r.note.id === note.id);
    expect(match).not.toBeUndefined();
    expect(match?.headline.toLowerCase()).toContain('<mark>lighthouse</mark>');
  });

  it('#3 a multi-word phrase query returns notes matching ALL significant words (plainto_tsquery ANDs terms), excludes a note with only one of the words', async () => {
    const user = await seedUser('search3@example.com');
    const bothWords = await seedSearchNote({
      userId: user.id,
      title: 'Garden diary',
      bodyText: 'The elephant sat quietly in the elegant garden while butterflies danced nearby.',
    });
    const onlyOneWord = await seedSearchNote({
      userId: user.id,
      title: 'Zoo notes',
      bodyText: 'The elephant wandered far away from the enclosure fence.',
    });

    const res = await request(app)
      .get('/search')
      .query({ q: 'elephant garden' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    const ids = body.items.map((r) => r.note.id);
    expect(ids).toContain(bothWords.id);
    expect(ids).not.toContain(onlyOneWord.id);
  });

  it("#4 a keyword existing only in another user's note is not returned (userId scoping)", async () => {
    const owner = await seedUser('search4owner@example.com');
    const searcher = await seedUser('search4searcher@example.com');
    await seedSearchNote({
      userId: owner.id,
      title: 'Owner secret note',
      bodyText: 'This note contains the unique keyword zephyrfoxtrot in its body.',
    });

    const res = await request(app)
      .get('/search')
      .query({ q: 'zephyrfoxtrot' })
      .set('Authorization', authHeader(searcher.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    expect(body.items).toEqual([]);
    expect(body.totalItems).toBe(0);
  });

  it("#5 a keyword existing only in the caller's own soft-deleted (trashed) note is not returned (deletedAt IS NULL filter)", async () => {
    const user = await seedUser('search5@example.com');
    await seedSearchNote({
      userId: user.id,
      title: 'Old trashed note',
      bodyText: 'This trashed note mentions trashedgorilla content that would otherwise match.',
      deletedAt: new Date(),
    });

    const res = await request(app)
      .get('/search')
      .query({ q: 'trashedgorilla' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    expect(body.items).toEqual([]);
    expect(body.totalItems).toBe(0);
  });

  it('#6 a keyword matching no notes -> 200 with items: [], totalItems: 0', async () => {
    const user = await seedUser('search6@example.com');
    await seedSearchNote({
      userId: user.id,
      title: 'Unrelated note',
      bodyText: 'Nothing to see here.',
    });

    const res = await request(app)
      .get('/search')
      .query({ q: 'nonexistentquerytermxyz' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    expect(body.items).toEqual([]);
    expect(body.totalItems).toBe(0);
  });

  it('#7 a stronger match (denser term occurrences) is ranked before a weaker match (ts_rank descending)', async () => {
    const user = await seedUser('search7@example.com');
    const sameTitle = 'Ranking test note';
    const weak = await seedSearchNote({
      userId: user.id,
      title: sameTitle,
      bodyText:
        'This note mentions serendipity once amid a lot of unrelated padding content padding content padding content padding.',
    });
    const strong = await seedSearchNote({
      userId: user.id,
      title: sameTitle,
      bodyText:
        'serendipity serendipity serendipity is the central theme of this entire note, which is all about serendipity and more serendipity.',
    });

    const res = await request(app)
      .get('/search')
      .query({ q: 'serendipity' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    const ids = body.items.map((r) => r.note.id);
    expect(ids).toContain(strong.id);
    expect(ids).toContain(weak.id);
    expect(ids.indexOf(strong.id)).toBeLessThan(ids.indexOf(weak.id));
  });

  it('#8 missing q param entirely -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('search8@example.com');

    const res = await request(app).get('/search').set('Authorization', authHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#9 q present but empty string -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('search9a@example.com');

    const res = await request(app)
      .get('/search')
      .query({ q: '' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#9 q present but whitespace-only -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('search9b@example.com');

    const res = await request(app)
      .get('/search')
      .query({ q: '   ' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#10 pageSize=0 (below allowed bounds) -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('search10a@example.com');

    const res = await request(app)
      .get('/search')
      .query({ q: 'anything', pageSize: 0 })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#10 pageSize=51 (above allowed bounds) -> 400 VALIDATION_FAILED', async () => {
    const user = await seedUser('search10b@example.com');

    const res = await request(app)
      .get('/search')
      .query({ q: 'anything', pageSize: 51 })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: ErrorCodes.VALIDATION_FAILED });
  });

  it('#11 default pagination (page/pageSize omitted) -> page: 1, pageSize: 10 reflected in the envelope', async () => {
    const user = await seedUser('search11@example.com');
    await seedSearchNote({
      userId: user.id,
      title: 'Defaults test',
      bodyText: 'A note about paginationdefaultkeyword and nothing else.',
    });

    const res = await request(app)
      .get('/search')
      .query({ q: 'paginationdefaultkeyword' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(10);
  });

  it("#12 each result's note.tagIds reflects the note's current tag associations", async () => {
    const user = await seedUser('search12@example.com');
    const tag = await seedTag(user.id, 'Important');
    const note = await seedSearchNote({
      userId: user.id,
      title: 'Tagged searchable note',
      bodyText: 'This note contains the distinctive term tagsearchmarker in its body.',
    });
    await prisma.noteTag.create({ data: { noteId: note.id, tagId: tag.id } });

    const res = await request(app)
      .get('/search')
      .query({ q: 'tagsearchmarker' })
      .set('Authorization', authHeader(user.id));

    expect(res.status).toBe(200);
    const body = res.body as Page<SearchResultItem>;
    const match = body.items.find((r) => r.note.id === note.id);
    expect(match).not.toBeUndefined();
    expect(match?.note.tagIds).toEqual([tag.id]);
  });

  it("#15 updating a note's body via PATCH /notes/:id makes the NEW content searchable and the OLD content no longer matches (STORED generated column recomputes on write)", async () => {
    const user = await seedUser('search15@example.com');

    const createRes = await request(app)
      .post('/notes')
      .set('Authorization', authHeader(user.id))
      .send({
        title: 'Recompute test note',
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'oldcontentzeta some other words' }] },
          ],
        },
      });
    expect(createRes.status).toBe(201);
    const noteId = (createRes.body as { id: string }).id;

    const beforeUpdate = await request(app)
      .get('/search')
      .query({ q: 'oldcontentzeta' })
      .set('Authorization', authHeader(user.id));
    expect(beforeUpdate.status).toBe(200);
    expect((beforeUpdate.body as Page<SearchResultItem>).items.map((r) => r.note.id)).toContain(noteId);

    const patchRes = await request(app)
      .patch(`/notes/${noteId}`)
      .set('Authorization', authHeader(user.id))
      .send({
        title: 'Recompute test note, updated',
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'newcontentomega replaces the old text' }] },
          ],
        },
      });
    expect(patchRes.status).toBe(200);

    const afterUpdateNew = await request(app)
      .get('/search')
      .query({ q: 'newcontentomega' })
      .set('Authorization', authHeader(user.id));
    expect(afterUpdateNew.status).toBe(200);
    expect((afterUpdateNew.body as Page<SearchResultItem>).items.map((r) => r.note.id)).toContain(noteId);

    const afterUpdateOld = await request(app)
      .get('/search')
      .query({ q: 'oldcontentzeta' })
      .set('Authorization', authHeader(user.id));
    expect(afterUpdateOld.status).toBe(200);
    expect((afterUpdateOld.body as Page<SearchResultItem>).items).toEqual([]);
  });
});

describe('#13 auth guard: GET /search rejects a missing or invalid access token', () => {
  const app = buildApp();

  it('no Authorization header -> 401 AUTH_TOKEN_INVALID', async () => {
    const res = await request(app).get('/search').query({ q: 'anything' });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: ErrorCodes.AUTH_TOKEN_INVALID });
  });

  it('malformed/garbage token -> 401 AUTH_TOKEN_INVALID', async () => {
    const res = await request(app)
      .get('/search')
      .query({ q: 'anything' })
      .set('Authorization', 'Bearer garbage-token');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ code: ErrorCodes.AUTH_TOKEN_INVALID });
  });
});
