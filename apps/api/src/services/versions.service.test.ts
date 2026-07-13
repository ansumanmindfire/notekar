import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import { AppError } from '../lib/AppError';
import { extractPlainText } from '../lib/tiptap';
import { listVersions, getVersion, restoreVersion } from './versions.service';

const USER_ID = 'user-1';

function createMockPrisma() {
  return {
    note: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    noteVersion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient & {
    note: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    noteVersion: {
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

const TAGS_INCLUDE = { tags: { select: { tagId: true } } };

function expectAppError(err: unknown, statusCode: number, code: string): void {
  expect(err).toBeInstanceOf(AppError);
  const appError = err as AppError;
  expect(appError.statusCode).toBe(statusCode);
  expect(appError.code).toBe(code);
}

const SIMPLE_BODY = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
};

const HISTORICAL_BODY = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Historical body' }] }],
};

function baseNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    userId: USER_ID,
    title: 'Current title',
    body: SIMPLE_BODY,
    bodyText: extractPlainText(SIMPLE_BODY),
    version: 3,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    tags: [],
    ...overrides,
  };
}

function baseVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    noteId: 'note-1',
    version: 2,
    title: 'Historical title',
    body: HISTORICAL_BODY,
    savedAt: new Date('2025-12-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('versions.service', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('listVersions', () => {
    it('scenario 1: returns 3 items newest-savedAt-first, scoping note lookup by id+userId only (no deletedAt filter)', async () => {
      const note = baseNote();
      const versions = [
        baseVersion({ id: 'v-3', version: 3, savedAt: new Date('2026-01-03T00:00:00.000Z') }),
        baseVersion({ id: 'v-2', version: 2, savedAt: new Date('2026-01-02T00:00:00.000Z') }),
        baseVersion({ id: 'v-1', version: 1, savedAt: new Date('2026-01-01T00:00:00.000Z') }),
      ];
      prisma.note.findFirst.mockResolvedValue(note);
      prisma.noteVersion.findMany.mockResolvedValue(versions);

      const result = await listVersions(prisma, USER_ID, note.id);

      expect(prisma.note.findFirst).toHaveBeenCalledWith({ where: { id: note.id, userId: USER_ID } });
      // Risk Area #2: the lookup must not filter deletedAt at all.
      const noteLookupArgs = prisma.note.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(noteLookupArgs.where).not.toHaveProperty('deletedAt');
      expect(prisma.noteVersion.findMany).toHaveBeenCalledWith({
        where: { noteId: note.id },
        orderBy: { savedAt: 'desc' },
      });
      expect(result).toBe(versions);
      expect(result).toHaveLength(3);
    });

    it('scenario 2: returns an empty array for a note with zero historical versions', async () => {
      const note = baseNote();
      prisma.note.findFirst.mockResolvedValue(note);
      prisma.noteVersion.findMany.mockResolvedValue([]);

      const result = await listVersions(prisma, USER_ID, note.id);

      expect(result).toEqual([]);
    });

    it('scenario 3 / Risk Area #2: returns versions for a note currently in Trash (deletedAt set) — trash state ignored for read', async () => {
      const trashedNote = baseNote({ deletedAt: new Date('2026-01-05T00:00:00.000Z') });
      const versions = [baseVersion()];
      prisma.note.findFirst.mockResolvedValue(trashedNote);
      prisma.noteVersion.findMany.mockResolvedValue(versions);

      const result = await listVersions(prisma, USER_ID, trashedNote.id);

      expect(prisma.note.findFirst).toHaveBeenCalledWith({
        where: { id: trashedNote.id, userId: USER_ID },
      });
      expect(result).toBe(versions);
    });

    it('scenario 4: throws 404 NOTE_NOT_FOUND for an unowned/missing note and never queries noteVersion.findMany', async () => {
      prisma.note.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await listVersions(prisma, USER_ID, 'unowned-note');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
      expect(prisma.noteVersion.findMany).not.toHaveBeenCalled();
    });
  });

  describe('getVersion', () => {
    it('scenario 5: returns the full historical version (title/body/version/savedAt) when found', async () => {
      const note = baseNote();
      const version = baseVersion();
      prisma.note.findFirst.mockResolvedValue(note);
      prisma.noteVersion.findFirst.mockResolvedValue(version);

      const result = await getVersion(prisma, USER_ID, note.id, version.id);

      expect(prisma.noteVersion.findFirst).toHaveBeenCalledWith({
        where: { id: version.id, noteId: note.id },
      });
      expect(result).toBe(version);
    });

    it('scenario 6: throws 404 VERSION_NOT_FOUND when versionId does not belong to the given note', async () => {
      const note = baseNote();
      prisma.note.findFirst.mockResolvedValue(note);
      prisma.noteVersion.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await getVersion(prisma, USER_ID, note.id, 'wrong-version');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.VERSION_NOT_FOUND);
    });

    it('scenario 7 / Risk Area #4: throws 404 NOTE_NOT_FOUND (not VERSION_NOT_FOUND) for a note the caller does not own, even with a valid-looking versionId, and never calls noteVersion.findFirst', async () => {
      prisma.note.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await getVersion(prisma, USER_ID, 'unowned-note', 'some-version');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
      // Ordering assertion: note lookup happens first, version lookup never
      // runs, so an unowned note can never leak version-existence info.
      expect(prisma.noteVersion.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('restoreVersion', () => {
    it('scenario 8: snapshots the CURRENT title/body/version into noteVersion.create, applies TARGET content via note.update with version incremented, in a 2-op $transaction, and returns the refetched note', async () => {
      const existing = baseNote();
      const target = baseVersion();
      const restored = baseNote({
        title: target.title,
        body: target.body,
        bodyText: extractPlainText(target.body),
        version: existing.version + 1,
      });
      prisma.note.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(restored);
      prisma.noteVersion.findFirst.mockResolvedValue(target);
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      const result = await restoreVersion(prisma, USER_ID, existing.id, target.id);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = prisma.$transaction.mock.calls[0]![0] as unknown[];
      expect(transactionArg).toHaveLength(2);

      expect(prisma.noteVersion.create).toHaveBeenCalledTimes(1);
      const versionArgs = prisma.noteVersion.create.mock.calls[0]![0] as {
        data: { noteId: string; version: number; title: string; body: unknown };
      };
      // Crux of FR-VER-2: the snapshot captures the CURRENT (pre-restore)
      // state, never the target version's content.
      expect(versionArgs.data).toEqual({
        noteId: existing.id,
        version: existing.version,
        title: existing.title,
        body: existing.body,
      });

      expect(prisma.note.update).toHaveBeenCalledTimes(1);
      const updateArgs = prisma.note.update.mock.calls[0]![0] as {
        where: { id: string };
        data: { title: string; body: unknown; bodyText: string; version: { increment: number } };
      };
      expect(updateArgs.where).toEqual({ id: existing.id });
      expect(updateArgs.data.title).toBe(target.title);
      expect(updateArgs.data.body).toEqual(target.body);
      expect(updateArgs.data.bodyText).toBe(extractPlainText(target.body));
      expect(updateArgs.data.version).toEqual({ increment: 1 });

      expect(prisma.note.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.note.findFirst).toHaveBeenNthCalledWith(2, {
        where: { id: existing.id },
        include: TAGS_INCLUDE,
      });
      expect(result).toBe(restored);
    });

    it('scenario 9: restore transaction contains no NoteTag operations — current tags are unaffected regardless of what was attached at save time', async () => {
      const existing = baseNote({ tags: [{ tagId: 'tag-current' }] });
      const target = baseVersion();
      const restored = baseNote({
        title: target.title,
        body: target.body,
        tags: [{ tagId: 'tag-current' }],
      });
      prisma.note.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(restored);
      prisma.noteVersion.findFirst.mockResolvedValue(target);
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      const result = await restoreVersion(prisma, USER_ID, existing.id, target.id);

      const transactionArg = prisma.$transaction.mock.calls[0]![0] as unknown[];
      expect(transactionArg).toHaveLength(2); // noteVersion.create + note.update only, no NoteTag ops
      expect(result.tags).toEqual([{ tagId: 'tag-current' }]);
    });

    it('scenario 10 / Risk Area #2: restores a version while the note is currently in Trash — succeeds, note lookup ignores deletedAt', async () => {
      const trashedNote = baseNote({ deletedAt: new Date('2026-01-05T00:00:00.000Z') });
      const target = baseVersion();
      const restored = baseNote({
        title: target.title,
        body: target.body,
        deletedAt: trashedNote.deletedAt,
      });
      prisma.note.findFirst.mockResolvedValueOnce(trashedNote).mockResolvedValueOnce(restored);
      prisma.noteVersion.findFirst.mockResolvedValue(target);
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      const result = await restoreVersion(prisma, USER_ID, trashedNote.id, target.id);

      const noteLookupArgs = prisma.note.findFirst.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(noteLookupArgs.where).not.toHaveProperty('deletedAt');
      // deletedAt is never part of the update's data payload.
      const updateArgs = prisma.note.update.mock.calls[0]![0] as { data: Record<string, unknown> };
      expect(updateArgs.data).not.toHaveProperty('deletedAt');
      expect(result.deletedAt).toEqual(trashedNote.deletedAt);
    });

    it('scenario 11: throws 404 VERSION_NOT_FOUND when versionId does not belong to the note, and never starts the $transaction', async () => {
      const existing = baseNote();
      prisma.note.findFirst.mockResolvedValueOnce(existing);
      prisma.noteVersion.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await restoreVersion(prisma, USER_ID, existing.id, 'wrong-version');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.VERSION_NOT_FOUND);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('scenario 12 / Risk Area #4: throws 404 NOTE_NOT_FOUND (not VERSION_NOT_FOUND) for a note the caller does not own, never calls noteVersion.findFirst nor $transaction', async () => {
      prisma.note.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await restoreVersion(prisma, USER_ID, 'unowned-note', 'some-version');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
      expect(prisma.noteVersion.findFirst).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws 404 NOTE_NOT_FOUND when the post-transaction refetch unexpectedly returns null', async () => {
      const existing = baseNote();
      const target = baseVersion();
      prisma.note.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
      prisma.noteVersion.findFirst.mockResolvedValue(target);
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      let caught: unknown;
      try {
        await restoreVersion(prisma, USER_ID, existing.id, target.id);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
    });
  });
});
