import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { purgeVersions } from './purgeVersions';

// Integration tier (AGENTS.md §10 / plan.md Test Strategy row for spec
// scenarios #15/#16): real `notes_test` Postgres via the Prisma singleton
// (vitest.setup.ts already forces DATABASE_URL -> TEST_DATABASE_URL before
// this file loads). Mirrors purgeNotes.test.ts's boundary-test style exactly,
// but for the 90-day NoteVersion retention window (FR-VER-3). Also covers
// plan.md Risk Area #3: purgeVersions must never delete the owning `Note`
// row, even when every one of its NoteVersion rows is purged.

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

async function resetDb(): Promise<void> {
  await prisma.noteVersion.deleteMany();
  await prisma.note.deleteMany();
  await prisma.user.deleteMany();
}

async function seedUser(email: string): Promise<{ id: string }> {
  const user = await prisma.user.create({
    data: { email, passwordHash: 'irrelevant-hash-for-this-test' },
  });
  return { id: user.id };
}

interface SeedNoteOptions {
  userId: string;
  title: string;
  deletedAt?: Date | null;
}

async function seedNote(options: SeedNoteOptions): Promise<{ id: string }> {
  const note = await prisma.note.create({
    data: {
      userId: options.userId,
      title: options.title,
      body: { type: 'doc', content: [] },
      bodyText: '',
      deletedAt: options.deletedAt ?? null,
    },
  });
  return { id: note.id };
}

interface SeedVersionOptions {
  noteId: string;
  version: number;
  title: string;
  savedAt: Date;
}

async function seedVersion(options: SeedVersionOptions): Promise<{ id: string }> {
  const version = await prisma.noteVersion.create({
    data: {
      noteId: options.noteId,
      version: options.version,
      title: options.title,
      body: { type: 'doc', content: [] },
      savedAt: options.savedAt,
    },
  });
  return { id: version.id };
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await resetDb();
  await prisma.$disconnect();
});

describe('purgeVersions', () => {
  it('#1 purges only NoteVersion rows saved more than 90 days ago, leaving boundary/recent rows untouched (spec Scenario 15)', async () => {
    const user = await seedUser('purge-versions-1@example.com');
    const note = await seedNote({ userId: user.id, title: 'Note with mixed-age versions' });

    const oldVersion = await seedVersion({
      noteId: note.id,
      version: 1,
      title: 'Old version',
      savedAt: daysAgo(91),
    });
    const boundaryVersion = await seedVersion({
      noteId: note.id,
      version: 2,
      title: 'Just under cutoff',
      savedAt: new Date(Date.now() - (89 * DAY_MS + 23 * 60 * 60 * 1000)),
    });
    const recentVersion = await seedVersion({
      noteId: note.id,
      version: 3,
      title: 'Recent version',
      savedAt: daysAgo(89),
    });

    const result = await purgeVersions(prisma);

    expect(result).toEqual({ purgedCount: 1 });

    const purged = await prisma.noteVersion.findUnique({ where: { id: oldVersion.id } });
    expect(purged).toBeNull();

    const stillBoundary = await prisma.noteVersion.findUnique({ where: { id: boundaryVersion.id } });
    expect(stillBoundary).not.toBeNull();

    const stillRecent = await prisma.noteVersion.findUnique({ where: { id: recentVersion.id } });
    expect(stillRecent).not.toBeNull();
  });

  it('#2 does not purge a version saved just under the 90-day cutoff (89 days 23 hours ago)', async () => {
    const user = await seedUser('purge-versions-2@example.com');
    const note = await seedNote({ userId: user.id, title: 'Boundary note' });
    const boundaryVersion = await seedVersion({
      noteId: note.id,
      version: 1,
      title: 'Just under cutoff',
      savedAt: new Date(Date.now() - (89 * DAY_MS + 23 * 60 * 60 * 1000)),
    });

    const result = await purgeVersions(prisma);

    expect(result).toEqual({ purgedCount: 0 });

    const stillThere = await prisma.noteVersion.findUnique({ where: { id: boundaryVersion.id } });
    expect(stillThere).not.toBeNull();
  });

  it('#3 returns { purgedCount: 0 } without throwing when there is nothing to purge', async () => {
    const user = await seedUser('purge-versions-3@example.com');
    const note = await seedNote({ userId: user.id, title: 'Only-recent-versions note' });
    await seedVersion({
      noteId: note.id,
      version: 1,
      title: 'Recent version',
      savedAt: daysAgo(1),
    });

    await expect(purgeVersions(prisma)).resolves.toEqual({ purgedCount: 0 });
  });

  it('#4 never deletes the owning Note row, even when all of its NoteVersion rows are purged (spec Scenario 16 / plan.md Risk Area #3)', async () => {
    const user = await seedUser('purge-versions-4@example.com');
    const note = await seedNote({ userId: user.id, title: 'Note whose full history gets purged' });
    const trashedNote = await seedNote({
      userId: user.id,
      title: 'Trashed note whose full history gets purged',
      deletedAt: daysAgo(5),
    });

    await seedVersion({ noteId: note.id, version: 1, title: 'v1', savedAt: daysAgo(95) });
    await seedVersion({ noteId: note.id, version: 2, title: 'v2', savedAt: daysAgo(91) });
    await seedVersion({
      noteId: trashedNote.id,
      version: 1,
      title: 'trashed v1',
      savedAt: daysAgo(100),
    });

    const result = await purgeVersions(prisma);

    expect(result).toEqual({ purgedCount: 3 });

    const remainingVersions = await prisma.noteVersion.findMany({ where: { noteId: note.id } });
    expect(remainingVersions).toHaveLength(0);

    const intactNote = await prisma.note.findUnique({ where: { id: note.id } });
    expect(intactNote).not.toBeNull();
    expect(intactNote?.title).toBe('Note whose full history gets purged');
    expect(intactNote?.deletedAt).toBeNull();

    const intactTrashedNote = await prisma.note.findUnique({ where: { id: trashedNote.id } });
    expect(intactTrashedNote).not.toBeNull();
    expect(intactTrashedNote?.deletedAt).not.toBeNull();
  });
});
