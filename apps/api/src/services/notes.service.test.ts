import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import type { CreateNoteInput, UpdateNoteInput, PaginationQuery } from 'shared/schemas';
import { AppError } from '../lib/AppError';
import { extractPlainText } from '../lib/tiptap';
import {
  createNote,
  getNote,
  updateNote,
  softDeleteNote,
  restoreNote,
  listNotes,
  listTrash,
} from './notes.service';

const USER_ID = 'user-1';

function createMockPrisma() {
  return {
    note: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    noteVersion: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  } as unknown as PrismaClient & {
    note: {
      create: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    noteVersion: { create: ReturnType<typeof vi.fn> };
    $transaction: ReturnType<typeof vi.fn>;
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

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

const OTHER_BODY = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Updated body' }] }],
};

function baseNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    userId: USER_ID,
    title: 'Old title',
    body: SIMPLE_BODY,
    bodyText: extractPlainText(SIMPLE_BODY),
    version: 3,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

describe('notes.service', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('createNote', () => {
    it('computes bodyText from the input body and passes it to prisma.note.create, returning the created row', async () => {
      const created = baseNote({ id: 'note-new', version: 1 });
      prisma.note.create.mockResolvedValue(created);

      const input: CreateNoteInput = { title: 'My Title', body: SIMPLE_BODY };
      const result = await createNote(prisma, USER_ID, input);

      expect(prisma.note.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.note.create.mock.calls[0]![0] as {
        data: { userId: string; title: string; body: unknown; bodyText: string };
      };
      expect(createArgs.data).toEqual({
        userId: USER_ID,
        title: 'My Title',
        body: SIMPLE_BODY,
        bodyText: 'Hello world',
      });
      expect(result).toBe(created);
    });
  });

  describe('getNote', () => {
    it('returns the note when found (scoped by id, userId, deletedAt: null)', async () => {
      const note = baseNote();
      prisma.note.findFirst.mockResolvedValue(note);

      const result = await getNote(prisma, USER_ID, 'note-1');

      expect(prisma.note.findFirst).toHaveBeenCalledWith({
        where: { id: 'note-1', userId: USER_ID, deletedAt: null },
      });
      expect(result).toBe(note);
    });

    it('throws a 404 NOTE_NOT_FOUND AppError when not found', async () => {
      prisma.note.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await getNote(prisma, USER_ID, 'missing-note');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
    });
  });

  describe('updateNote', () => {
    it('throws 404 when the note is not found (missing/not-owned/trashed), and never calls $transaction', async () => {
      prisma.note.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await updateNote(prisma, USER_ID, 'missing-note', { title: 'New Title' });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('snapshots the PRE-update title/body/version into noteVersion.create and applies the new values via note.update, in a single 2-op $transaction (full update)', async () => {
      const existing = baseNote();
      prisma.note.findFirst.mockResolvedValue(existing);
      prisma.noteVersion.create.mockResolvedValue({});
      const updated = baseNote({ title: 'New Title', body: OTHER_BODY, version: 4 });
      prisma.note.update.mockResolvedValue(updated);
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      const input: UpdateNoteInput = { title: 'New Title', body: OTHER_BODY };
      const result = await updateNote(prisma, USER_ID, existing.id, input);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const transactionArg = prisma.$transaction.mock.calls[0]![0] as unknown[];
      expect(transactionArg).toHaveLength(2);

      expect(prisma.noteVersion.create).toHaveBeenCalledTimes(1);
      const versionArgs = prisma.noteVersion.create.mock.calls[0]![0] as {
        data: { noteId: string; version: number; title: string; body: unknown };
      };
      // Crux of FR-NOTE-3: the snapshot must capture the EXISTING (pre-update)
      // values, never the incoming input.
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
      expect(updateArgs.data.title).toBe('New Title');
      expect(updateArgs.data.body).toEqual(OTHER_BODY);
      expect(updateArgs.data.bodyText).toBe(extractPlainText(OTHER_BODY));
      expect(updateArgs.data.version).toEqual({ increment: 1 });

      expect(result).toBe(updated);
    });

    it('falls back to the existing body/bodyText on a title-only partial update, and does not recompute bodyText', async () => {
      const existing = baseNote();
      prisma.note.findFirst.mockResolvedValue(existing);
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue(baseNote({ title: 'Title Only Update' }));
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      await updateNote(prisma, USER_ID, existing.id, { title: 'Title Only Update' });

      const updateArgs = prisma.note.update.mock.calls[0]![0] as {
        data: { title: string; body: unknown; bodyText: string };
      };
      expect(updateArgs.data.title).toBe('Title Only Update');
      expect(updateArgs.data.body).toEqual(existing.body);
      expect(updateArgs.data.bodyText).toBe(existing.bodyText);

      const versionArgs = prisma.noteVersion.create.mock.calls[0]![0] as {
        data: { title: string; body: unknown };
      };
      expect(versionArgs.data.title).toBe(existing.title);
      expect(versionArgs.data.body).toEqual(existing.body);
    });

    it('falls back to the existing title on a body-only partial update, and recomputes bodyText from the new body', async () => {
      const existing = baseNote();
      prisma.note.findFirst.mockResolvedValue(existing);
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue(baseNote({ body: OTHER_BODY }));
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      await updateNote(prisma, USER_ID, existing.id, { body: OTHER_BODY });

      const updateArgs = prisma.note.update.mock.calls[0]![0] as {
        data: { title: string; body: unknown; bodyText: string };
      };
      expect(updateArgs.data.title).toBe(existing.title);
      expect(updateArgs.data.body).toEqual(OTHER_BODY);
      expect(updateArgs.data.bodyText).toBe(extractPlainText(OTHER_BODY));
    });
  });

  describe('softDeleteNote', () => {
    it('resolves cleanly when updateMany affects exactly 1 row', async () => {
      prisma.note.updateMany.mockResolvedValue({ count: 1 });

      await expect(softDeleteNote(prisma, USER_ID, 'note-1')).resolves.toBeUndefined();

      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'note-1', userId: USER_ID, deletedAt: null },
        data: { deletedAt: expect.any(Date) as Date },
      });
    });

    it('throws 404 when updateMany affects 0 rows (missing, not owned, or already deleted)', async () => {
      prisma.note.updateMany.mockResolvedValue({ count: 0 });

      let caught: unknown;
      try {
        await softDeleteNote(prisma, USER_ID, 'note-1');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
    });
  });

  describe('restoreNote', () => {
    it('throws 404 when updateMany affects 0 rows, without ever calling findFirst', async () => {
      prisma.note.updateMany.mockResolvedValue({ count: 0 });

      let caught: unknown;
      try {
        await restoreNote(prisma, USER_ID, 'note-1');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
      expect(prisma.note.findFirst).not.toHaveBeenCalled();
    });

    it('re-fetches and returns the restored note when updateMany affects 1 row', async () => {
      prisma.note.updateMany.mockResolvedValue({ count: 1 });
      const restored = baseNote({ deletedAt: null });
      prisma.note.findFirst.mockResolvedValue(restored);

      const result = await restoreNote(prisma, USER_ID, 'note-1');

      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'note-1', userId: USER_ID, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      expect(prisma.note.findFirst).toHaveBeenCalledWith({ where: { id: 'note-1', userId: USER_ID } });
      expect(result).toBe(restored);
    });
  });

  describe('listNotes', () => {
    it('scopes by deletedAt: null, orders by createdAt desc, and computes skip/take + totalPages correctly', async () => {
      const items = [baseNote({ id: 'note-a' }), baseNote({ id: 'note-b' })];
      prisma.note.findMany.mockResolvedValue(items);
      prisma.note.count.mockResolvedValue(25);

      const pagination: PaginationQuery = { page: 2, pageSize: 10 };
      const result = await listNotes(prisma, USER_ID, pagination);

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(prisma.note.count).toHaveBeenCalledWith({ where: { userId: USER_ID, deletedAt: null } });
      expect(result).toEqual({ items, page: 2, pageSize: 10, totalItems: 25, totalPages: 3 });
    });
  });

  describe('listTrash', () => {
    it('scopes by deletedAt: { not: null }, orders by deletedAt desc, and computes skip/take + totalPages correctly', async () => {
      const items = [baseNote({ id: 'note-c', deletedAt: new Date() })];
      prisma.note.findMany.mockResolvedValue(items);
      prisma.note.count.mockResolvedValue(1);

      const pagination: PaginationQuery = { page: 1, pageSize: 10 };
      const result = await listTrash(prisma, USER_ID, pagination);

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: { not: null } },
        orderBy: { deletedAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(prisma.note.count).toHaveBeenCalledWith({ where: { userId: USER_ID, deletedAt: { not: null } } });
      expect(result).toEqual({ items, page: 1, pageSize: 10, totalItems: 1, totalPages: 1 });
    });
  });
});
