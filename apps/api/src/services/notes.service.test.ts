import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import type { CreateNoteInput, UpdateNoteInput, PaginationQuery, ListNotesQuery } from 'shared/schemas';
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
    noteTag: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    tag: {
      count: vi.fn(),
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
    noteTag: { deleteMany: ReturnType<typeof vi.fn>; createMany: ReturnType<typeof vi.fn> };
    tag: { count: ReturnType<typeof vi.fn> };
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

function p2003(message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2003',
    clientVersion: '6.19.3',
  });
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
    tags: [],
    ...overrides,
  };
}

describe('notes.service', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('createNote', () => {
    it('computes bodyText from the input body and passes it to prisma.note.create (no tagIds), returning the created row', async () => {
      const created = baseNote({ id: 'note-new', version: 1 });
      prisma.note.create.mockResolvedValue(created);

      const input: CreateNoteInput = { title: 'My Title', body: SIMPLE_BODY };
      const result = await createNote(prisma, USER_ID, input);

      expect(prisma.tag.count).not.toHaveBeenCalled();
      expect(prisma.note.create).toHaveBeenCalledTimes(1);
      const createArgs = prisma.note.create.mock.calls[0]![0] as {
        data: {
          userId: string;
          title: string;
          body: unknown;
          bodyText: string;
          tags: { create: { tagId: string }[] };
        };
        include: unknown;
      };
      expect(createArgs.data).toEqual({
        userId: USER_ID,
        title: 'My Title',
        body: SIMPLE_BODY,
        bodyText: 'Hello world',
        tags: { create: [] },
      });
      expect(createArgs.include).toEqual(TAGS_INCLUDE);
      expect(result).toBe(created);
    });

    it('validates tagIds ownership via prisma.tag.count and writes a nested tags.create with the deduped ids', async () => {
      const created = baseNote({ id: 'note-new', version: 1, tags: [{ tagId: 'tag-1' }, { tagId: 'tag-2' }] });
      prisma.tag.count.mockResolvedValue(2);
      prisma.note.create.mockResolvedValue(created);

      const input: CreateNoteInput = {
        title: 'My Title',
        body: SIMPLE_BODY,
        tagIds: ['tag-1', 'tag-2', 'tag-1'],
      };
      const result = await createNote(prisma, USER_ID, input);

      expect(prisma.tag.count).toHaveBeenCalledWith({
        where: { id: { in: ['tag-1', 'tag-2'] }, userId: USER_ID },
      });
      const createArgs = prisma.note.create.mock.calls[0]![0] as {
        data: { tags: { create: { tagId: string }[] } };
      };
      expect(createArgs.data.tags).toEqual({
        create: [{ tagId: 'tag-1' }, { tagId: 'tag-2' }],
      });
      expect(result).toBe(created);
    });

    it('throws 422 INVALID_TAG when tagIds count mismatches (unowned/nonexistent tag), and never calls note.create', async () => {
      prisma.tag.count.mockResolvedValue(1);

      let caught: unknown;
      try {
        await createNote(prisma, USER_ID, {
          title: 'My Title',
          body: SIMPLE_BODY,
          tagIds: ['tag-1', 'tag-2'],
        });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 422, ErrorCodes.INVALID_TAG);
      expect(prisma.note.create).not.toHaveBeenCalled();
    });

    it('translates a P2003 foreign-key violation on note.create into 422 INVALID_TAG (not a raw Prisma error) — TOCTOU backstop for a tag deleted after assertOwnedTagIds passed', async () => {
      prisma.tag.count.mockResolvedValue(1);
      prisma.note.create.mockRejectedValue(p2003('Foreign key constraint failed on the field: `tagId`'));

      let caught: unknown;
      try {
        await createNote(prisma, USER_ID, {
          title: 'My Title',
          body: SIMPLE_BODY,
          tagIds: ['tag-1'],
        });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 422, ErrorCodes.INVALID_TAG);
    });

    it('rethrows a non-P2003 error from note.create unchanged', async () => {
      const otherError = new Error('connection lost');
      prisma.note.create.mockRejectedValue(otherError);

      let caught: unknown;
      try {
        await createNote(prisma, USER_ID, { title: 'My Title', body: SIMPLE_BODY });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBe(otherError);
    });
  });

  describe('getNote', () => {
    it('returns the note when found (scoped by id, userId, deletedAt: null), including tags', async () => {
      const note = baseNote({ tags: [{ tagId: 'tag-1' }] });
      prisma.note.findFirst.mockResolvedValue(note);

      const result = await getNote(prisma, USER_ID, 'note-1');

      expect(prisma.note.findFirst).toHaveBeenCalledWith({
        where: { id: 'note-1', userId: USER_ID, deletedAt: null },
        include: TAGS_INCLUDE,
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

    it('snapshots the PRE-update title/body/version into noteVersion.create and applies the new values via note.update, in a single 2-op $transaction (full update, tagIds omitted)', async () => {
      const existing = baseNote();
      prisma.note.findFirst
        .mockResolvedValueOnce(existing) // pre-update lookup
        .mockResolvedValueOnce(baseNote({ title: 'New Title', body: OTHER_BODY, version: 4 })); // post-update refetch
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue({});
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

      // Refetch after the transaction is what's actually returned, not any
      // positional element of the transaction array.
      expect(prisma.note.findFirst).toHaveBeenCalledTimes(2);
      expect(prisma.note.findFirst).toHaveBeenNthCalledWith(2, {
        where: { id: existing.id },
        include: TAGS_INCLUDE,
      });
      expect(result).toEqual(baseNote({ title: 'New Title', body: OTHER_BODY, version: 4 }));
    });

    it('falls back to the existing body/bodyText on a title-only partial update, and does not recompute bodyText', async () => {
      const existing = baseNote();
      prisma.note.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(baseNote({ title: 'Title Only Update' }));
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue({});
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
      prisma.note.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(baseNote({ body: OTHER_BODY }));
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      await updateNote(prisma, USER_ID, existing.id, { body: OTHER_BODY });

      const updateArgs = prisma.note.update.mock.calls[0]![0] as {
        data: { title: string; body: unknown; bodyText: string };
      };
      expect(updateArgs.data.title).toBe(existing.title);
      expect(updateArgs.data.body).toEqual(OTHER_BODY);
      expect(updateArgs.data.bodyText).toBe(extractPlainText(OTHER_BODY));
    });

    it('throws 422 INVALID_TAG when the new tagIds fail ownership validation, and never starts the $transaction', async () => {
      const existing = baseNote();
      prisma.note.findFirst.mockResolvedValueOnce(existing);
      prisma.tag.count.mockResolvedValue(0);

      let caught: unknown;
      try {
        await updateNote(prisma, USER_ID, existing.id, { tagIds: ['unowned-tag'] });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 422, ErrorCodes.INVALID_TAG);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.noteTag.deleteMany).not.toHaveBeenCalled();
      expect(prisma.noteTag.createMany).not.toHaveBeenCalled();
    });

    it('tagIds omitted entirely -> leaves tags untouched (no noteTag.deleteMany/createMany in the transaction array)', async () => {
      const existing = baseNote();
      prisma.note.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(baseNote({ title: 'Untouched tags' }));
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      await updateNote(prisma, USER_ID, existing.id, { title: 'Untouched tags' });

      expect(prisma.tag.count).not.toHaveBeenCalled();
      expect(prisma.noteTag.deleteMany).not.toHaveBeenCalled();
      expect(prisma.noteTag.createMany).not.toHaveBeenCalled();
      const transactionArg = prisma.$transaction.mock.calls[0]![0] as unknown[];
      expect(transactionArg).toHaveLength(2);
    });

    it('tagIds: [] -> clears all tags: noteTag.deleteMany IS called but createMany is NOT', async () => {
      const existing = baseNote();
      prisma.note.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(baseNote({ tags: [] }));
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue({});
      prisma.noteTag.deleteMany.mockReturnValue({ __op: 'deleteMany' });
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      await updateNote(prisma, USER_ID, existing.id, { tagIds: [] });

      expect(prisma.tag.count).not.toHaveBeenCalled();
      expect(prisma.noteTag.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.noteTag.deleteMany).toHaveBeenCalledWith({ where: { noteId: existing.id } });
      expect(prisma.noteTag.createMany).not.toHaveBeenCalled();

      const transactionArg = prisma.$transaction.mock.calls[0]![0] as unknown[];
      // version snapshot + note update + deleteMany, no createMany
      expect(transactionArg).toHaveLength(3);
    });

    it('tagIds: non-empty array -> full-set replacement: deleteMany then createMany, both inside the $transaction array, in that order', async () => {
      const existing = baseNote();
      prisma.note.findFirst
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce(baseNote({ tags: [{ tagId: 'tag-a' }, { tagId: 'tag-b' }] }));
      prisma.tag.count.mockResolvedValue(2);
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue({});
      prisma.noteTag.deleteMany.mockReturnValue({ __op: 'deleteMany' });
      prisma.noteTag.createMany.mockReturnValue({ __op: 'createMany' });
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      const result = await updateNote(prisma, USER_ID, existing.id, {
        tagIds: ['tag-a', 'tag-b'],
      });

      expect(prisma.tag.count).toHaveBeenCalledWith({
        where: { id: { in: ['tag-a', 'tag-b'] }, userId: USER_ID },
      });
      expect(prisma.noteTag.deleteMany).toHaveBeenCalledWith({ where: { noteId: existing.id } });
      expect(prisma.noteTag.createMany).toHaveBeenCalledWith({
        data: [
          { noteId: existing.id, tagId: 'tag-a' },
          { noteId: existing.id, tagId: 'tag-b' },
        ],
      });

      const transactionArg = prisma.$transaction.mock.calls[0]![0] as unknown[];
      // version snapshot + note update + deleteMany + createMany
      expect(transactionArg).toHaveLength(4);
      expect(transactionArg[2]).toEqual({ __op: 'deleteMany' });
      expect(transactionArg[3]).toEqual({ __op: 'createMany' });

      expect(result).toEqual(baseNote({ tags: [{ tagId: 'tag-a' }, { tagId: 'tag-b' }] }));
    });

    it('throws 404 when the post-transaction refetch unexpectedly returns null', async () => {
      const existing = baseNote();
      prisma.note.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
      prisma.noteVersion.create.mockResolvedValue({});
      prisma.note.update.mockResolvedValue({});
      prisma.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));

      let caught: unknown;
      try {
        await updateNote(prisma, USER_ID, existing.id, { title: 'New Title' });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
    });

    it('translates a P2003 foreign-key violation in the update $transaction into 422 INVALID_TAG (tagIds provided, so the tag-replacement ops ride in the transaction array) — TOCTOU backstop for a tag deleted after assertOwnedTagIds passed', async () => {
      const existing = baseNote();
      prisma.note.findFirst.mockResolvedValueOnce(existing);
      prisma.tag.count.mockResolvedValue(1);
      prisma.noteTag.deleteMany.mockReturnValue({ __op: 'deleteMany' });
      prisma.noteTag.createMany.mockReturnValue({ __op: 'createMany' });
      prisma.$transaction.mockRejectedValue(p2003('Foreign key constraint failed on the field: `tagId`'));

      let caught: unknown;
      try {
        await updateNote(prisma, USER_ID, existing.id, { tagIds: ['tag-1'] });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 422, ErrorCodes.INVALID_TAG);
      const transactionArg = prisma.$transaction.mock.calls[0]![0] as unknown[];
      // version snapshot + note update + deleteMany + createMany
      expect(transactionArg).toHaveLength(4);
    });

    it('rethrows a non-P2003 error from the update $transaction unchanged (tagIds provided)', async () => {
      const existing = baseNote();
      prisma.note.findFirst.mockResolvedValueOnce(existing);
      prisma.tag.count.mockResolvedValue(1);
      prisma.noteTag.deleteMany.mockReturnValue({ __op: 'deleteMany' });
      prisma.noteTag.createMany.mockReturnValue({ __op: 'createMany' });
      const otherError = new Error('connection lost');
      prisma.$transaction.mockRejectedValue(otherError);

      let caught: unknown;
      try {
        await updateNote(prisma, USER_ID, existing.id, { tagIds: ['tag-1'] });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBe(otherError);
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

    it('re-fetches (including tags) and returns the restored note when updateMany affects 1 row', async () => {
      prisma.note.updateMany.mockResolvedValue({ count: 1 });
      const restored = baseNote({ deletedAt: null, tags: [{ tagId: 'tag-1' }] });
      prisma.note.findFirst.mockResolvedValue(restored);

      const result = await restoreNote(prisma, USER_ID, 'note-1');

      expect(prisma.note.updateMany).toHaveBeenCalledWith({
        where: { id: 'note-1', userId: USER_ID, deletedAt: { not: null } },
        data: { deletedAt: null },
      });
      expect(prisma.note.findFirst).toHaveBeenCalledWith({
        where: { id: 'note-1', userId: USER_ID },
        include: TAGS_INCLUDE,
      });
      expect(result).toBe(restored);
    });
  });

  describe('listNotes', () => {
    it('scopes by deletedAt: null, orders by createdAt desc (default sort), includes tags, and computes skip/take + totalPages correctly', async () => {
      const items = [baseNote({ id: 'note-a' }), baseNote({ id: 'note-b' })];
      prisma.note.findMany.mockResolvedValue(items);
      prisma.note.count.mockResolvedValue(25);

      const query: ListNotesQuery = { page: 2, pageSize: 10, sort: 'createdAt:desc' };
      const result = await listNotes(prisma, USER_ID, query);

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: null },
        include: TAGS_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: 10,
        take: 10,
      });
      expect(prisma.note.count).toHaveBeenCalledWith({ where: { userId: USER_ID, deletedAt: null } });
      expect(result).toEqual({ items, page: 2, pageSize: 10, totalItems: 25, totalPages: 3 });
    });

    it('orders by createdAt asc when sort is createdAt:asc', async () => {
      const items = [baseNote({ id: 'note-a' })];
      prisma.note.findMany.mockResolvedValue(items);
      prisma.note.count.mockResolvedValue(1);

      const query: ListNotesQuery = { page: 1, pageSize: 10, sort: 'createdAt:asc' };
      await listNotes(prisma, USER_ID, query);

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: null },
        include: TAGS_INCLUDE,
        orderBy: { createdAt: 'asc' },
        skip: 0,
        take: 10,
      });
    });

    it('orders by updatedAt asc when sort is updatedAt:asc', async () => {
      const items = [baseNote({ id: 'note-a' })];
      prisma.note.findMany.mockResolvedValue(items);
      prisma.note.count.mockResolvedValue(1);

      const query: ListNotesQuery = { page: 1, pageSize: 10, sort: 'updatedAt:asc' };
      await listNotes(prisma, USER_ID, query);

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: null },
        include: TAGS_INCLUDE,
        orderBy: { updatedAt: 'asc' },
        skip: 0,
        take: 10,
      });
    });

    it('orders by updatedAt desc when sort is updatedAt:desc', async () => {
      const items = [baseNote({ id: 'note-a' })];
      prisma.note.findMany.mockResolvedValue(items);
      prisma.note.count.mockResolvedValue(1);

      const query: ListNotesQuery = { page: 1, pageSize: 10, sort: 'updatedAt:desc' };
      await listNotes(prisma, USER_ID, query);

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: null },
        include: TAGS_INCLUDE,
        orderBy: { updatedAt: 'desc' },
        skip: 0,
        take: 10,
      });
    });

    it('tagIds present -> builds where.AND from tags.some(tagId) clauses (AND semantics, FR-NOTE-6)', async () => {
      const items = [baseNote({ id: 'note-a' })];
      prisma.note.findMany.mockResolvedValue(items);
      prisma.note.count.mockResolvedValue(1);

      const query: ListNotesQuery = {
        page: 1,
        pageSize: 10,
        sort: 'createdAt:desc',
        tagIds: ['tag-a', 'tag-b'],
      };
      await listNotes(prisma, USER_ID, query);

      const expectedWhere = {
        userId: USER_ID,
        deletedAt: null,
        AND: [{ tags: { some: { tagId: 'tag-a' } } }, { tags: { some: { tagId: 'tag-b' } } }],
      };
      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: expectedWhere,
        include: TAGS_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(prisma.note.count).toHaveBeenCalledWith({ where: expectedWhere });
    });

    it('duplicate tagIds query values (?tagIds=t1,t1) produce redundant-but-harmless duplicate AND clauses, no explicit dedup', async () => {
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      const query: ListNotesQuery = {
        page: 1,
        pageSize: 10,
        sort: 'createdAt:desc',
        tagIds: ['tag-a', 'tag-a'],
      };
      await listNotes(prisma, USER_ID, query);

      expect(prisma.note.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            AND: [{ tags: { some: { tagId: 'tag-a' } } }, { tags: { some: { tagId: 'tag-a' } } }],
          }) as unknown,
        }),
      );
    });

    it('tagIds absent -> no AND key added, same where shape as before this ticket', async () => {
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      const query: ListNotesQuery = { page: 1, pageSize: 10, sort: 'createdAt:desc' };
      await listNotes(prisma, USER_ID, query);

      const call = prisma.note.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(call.where).toEqual({ userId: USER_ID, deletedAt: null });
      expect(call.where).not.toHaveProperty('AND');
    });

    it('tagIds empty array -> treated the same as absent, no AND key added', async () => {
      prisma.note.findMany.mockResolvedValue([]);
      prisma.note.count.mockResolvedValue(0);

      const query: ListNotesQuery = { page: 1, pageSize: 10, sort: 'createdAt:desc', tagIds: [] };
      await listNotes(prisma, USER_ID, query);

      const call = prisma.note.findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
      expect(call.where).toEqual({ userId: USER_ID, deletedAt: null });
      expect(call.where).not.toHaveProperty('AND');
    });
  });

  describe('listTrash', () => {
    it('scopes by deletedAt: { not: null }, orders by deletedAt desc, includes tags, and computes skip/take + totalPages correctly', async () => {
      const items = [baseNote({ id: 'note-c', deletedAt: new Date() })];
      prisma.note.findMany.mockResolvedValue(items);
      prisma.note.count.mockResolvedValue(1);

      const pagination: PaginationQuery = { page: 1, pageSize: 10 };
      const result = await listTrash(prisma, USER_ID, pagination);

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID, deletedAt: { not: null } },
        include: TAGS_INCLUDE,
        orderBy: { deletedAt: 'desc' },
        skip: 0,
        take: 10,
      });
      expect(prisma.note.count).toHaveBeenCalledWith({ where: { userId: USER_ID, deletedAt: { not: null } } });
      expect(result).toEqual({ items, page: 1, pageSize: 10, totalItems: 1, totalPages: 1 });
    });
  });
});
