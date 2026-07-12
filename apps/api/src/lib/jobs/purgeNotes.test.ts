import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { purgeNotes } from './purgeNotes';

// Integration tier (AGENTS.md §10 / SDS §14 / plan.md Test Strategy row for
// spec scenario #14): real `notes_test` Postgres via the Prisma singleton
// (vitest.setup.ts already forces DATABASE_URL -> TEST_DATABASE_URL before
// this file loads). Verifies the DB-level 30-day physical purge and its
// `NoteVersion` cascade -- behavior only a real database can prove.

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY_MS);
}

async function resetDb(): Promise<void> {
  // NoteVersion first for explicitness, even though Note.onDelete: Cascade
  // from User would otherwise sweep both up transitively via user.deleteMany().
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
  deletedAt: Date | null;
}

async function seedNote(options: SeedNoteOptions): Promise<{ id: string }> {
  const note = await prisma.note.create({
    data: {
      userId: options.userId,
      title: options.title,
      body: { type: 'doc', content: [] },
      bodyText: '',
      deletedAt: options.deletedAt,
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

describe('purgeNotes', () => {
  it('#1 purges only notes soft-deleted more than 30 days ago, cascading their NoteVersion rows, and leaves recently-deleted/active notes untouched', async () => {
    const user = await seedUser('purge1@example.com');

    const oldNote = await seedNote({ userId: user.id, title: 'Old note', deletedAt: daysAgo(31) });
    const recentNote = await seedNote({
      userId: user.id,
      title: 'Recently trashed note',
      deletedAt: daysAgo(29),
    });
    const activeNote = await seedNote({ userId: user.id, title: 'Active note', deletedAt: null });

    const version = await prisma.noteVersion.create({
      data: {
        noteId: oldNote.id,
        version: 1,
        title: 'Old note',
        body: { type: 'doc', content: [] },
      },
    });

    const result = await purgeNotes(prisma);

    expect(result).toEqual({ purgedCount: 1 });

    const purgedNote = await prisma.note.findUnique({ where: { id: oldNote.id } });
    expect(purgedNote).toBeNull();

    const purgedVersion = await prisma.noteVersion.findUnique({ where: { id: version.id } });
    expect(purgedVersion).toBeNull();

    const stillRecent = await prisma.note.findUnique({ where: { id: recentNote.id } });
    expect(stillRecent).not.toBeNull();
    expect(stillRecent?.deletedAt).not.toBeNull();

    const stillActive = await prisma.note.findUnique({ where: { id: activeNote.id } });
    expect(stillActive).not.toBeNull();
    expect(stillActive?.deletedAt).toBeNull();
  });

  it('#2 does not purge a note deleted just under the 30-day cutoff (29 days 23 hours ago)', async () => {
    const user = await seedUser('purge2@example.com');
    const boundaryNote = await seedNote({
      userId: user.id,
      title: 'Just under cutoff',
      deletedAt: new Date(Date.now() - (29 * DAY_MS + 23 * 60 * 60 * 1000)),
    });

    const result = await purgeNotes(prisma);

    expect(result).toEqual({ purgedCount: 0 });

    const stillThere = await prisma.note.findUnique({ where: { id: boundaryNote.id } });
    expect(stillThere).not.toBeNull();
  });

  it('#3 returns { purgedCount: 0 } without throwing when there is nothing to purge', async () => {
    const user = await seedUser('purge3@example.com');
    await seedNote({ userId: user.id, title: 'Active only', deletedAt: null });

    await expect(purgeNotes(prisma)).resolves.toEqual({ purgedCount: 0 });
  });
});
