import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import type { CreateTagInput, UpdateTagInput, PaginationQuery } from 'shared/schemas';
import { AppError } from '../lib/AppError';
import { createTag, updateTag, deleteTag, listTags } from './tags.service';

const USER_ID = 'user-1';

function createMockPrisma() {
  return {
    tag: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  } as unknown as PrismaClient & {
    tag: {
      create: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

function expectAppError(err: unknown, statusCode: number, code: string): void {
  expect(err).toBeInstanceOf(AppError);
  const appError = err as AppError;
  expect(appError.statusCode).toBe(statusCode);
  expect(appError.code).toBe(code);
}

function p2002(message: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code: 'P2002',
    clientVersion: '6.19.3',
  });
}

function baseTag(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tag-1',
    userId: USER_ID,
    name: 'Work',
    color: 'blue',
    ...overrides,
  };
}

describe('tags.service', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('createTag', () => {
    it('creates a tag scoped to the caller and returns the created row', async () => {
      const created = baseTag();
      prisma.tag.create.mockResolvedValue(created);

      const input: CreateTagInput = { name: 'Work', color: 'blue' };
      const result = await createTag(prisma, USER_ID, input);

      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: { userId: USER_ID, name: 'Work', color: 'blue' },
      });
      expect(result).toBe(created);
    });

    it('translates a P2002 unique-constraint violation into 409 TAG_NAME_DUPLICATE (not a raw Prisma error)', async () => {
      prisma.tag.create.mockRejectedValue(p2002('Unique constraint failed on the fields: (`userId`,`name`)'));

      let caught: unknown;
      try {
        await createTag(prisma, USER_ID, { name: 'Work', color: 'blue' });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 409, ErrorCodes.TAG_NAME_DUPLICATE);
    });

    it('rethrows a non-P2002 error unchanged', async () => {
      const otherError = new Error('connection lost');
      prisma.tag.create.mockRejectedValue(otherError);

      let caught: unknown;
      try {
        await createTag(prisma, USER_ID, { name: 'Work', color: 'blue' });
      } catch (err) {
        caught = err;
      }

      expect(caught).toBe(otherError);
    });
  });

  describe('updateTag', () => {
    it('updates the name only, scoped by id + userId, and returns the refreshed row', async () => {
      prisma.tag.updateMany.mockResolvedValue({ count: 1 });
      const refreshed = baseTag({ name: 'Renamed' });
      prisma.tag.findFirst.mockResolvedValue(refreshed);

      const input: UpdateTagInput = { name: 'Renamed' };
      const result = await updateTag(prisma, USER_ID, 'tag-1', input);

      expect(prisma.tag.updateMany).toHaveBeenCalledWith({
        where: { id: 'tag-1', userId: USER_ID },
        data: { name: 'Renamed' },
      });
      expect(prisma.tag.findFirst).toHaveBeenCalledWith({ where: { id: 'tag-1', userId: USER_ID } });
      expect(result).toBe(refreshed);
    });

    it('updates the color only', async () => {
      prisma.tag.updateMany.mockResolvedValue({ count: 1 });
      const refreshed = baseTag({ color: 'green' });
      prisma.tag.findFirst.mockResolvedValue(refreshed);

      const input: UpdateTagInput = { color: 'green' };
      await updateTag(prisma, USER_ID, 'tag-1', input);

      expect(prisma.tag.updateMany).toHaveBeenCalledWith({
        where: { id: 'tag-1', userId: USER_ID },
        data: { color: 'green' },
      });
    });

    it('updates both name and color', async () => {
      prisma.tag.updateMany.mockResolvedValue({ count: 1 });
      const refreshed = baseTag({ name: 'Renamed', color: 'green' });
      prisma.tag.findFirst.mockResolvedValue(refreshed);

      const input: UpdateTagInput = { name: 'Renamed', color: 'green' };
      await updateTag(prisma, USER_ID, 'tag-1', input);

      expect(prisma.tag.updateMany).toHaveBeenCalledWith({
        where: { id: 'tag-1', userId: USER_ID },
        data: { name: 'Renamed', color: 'green' },
      });
    });

    it('throws 404 TAG_NOT_FOUND when updateMany affects 0 rows (missing/not owned), and never re-fetches', async () => {
      prisma.tag.updateMany.mockResolvedValue({ count: 0 });

      let caught: unknown;
      try {
        await updateTag(prisma, USER_ID, 'missing-tag', { name: 'Renamed' });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.TAG_NOT_FOUND);
      expect(prisma.tag.findFirst).not.toHaveBeenCalled();
    });

    it('translates a P2002 unique-constraint violation on rename into 409 TAG_NAME_DUPLICATE', async () => {
      prisma.tag.updateMany.mockRejectedValue(
        p2002('Unique constraint failed on the fields: (`userId`,`name`)'),
      );

      let caught: unknown;
      try {
        await updateTag(prisma, USER_ID, 'tag-1', { name: 'Existing' });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 409, ErrorCodes.TAG_NAME_DUPLICATE);
      expect(prisma.tag.findFirst).not.toHaveBeenCalled();
    });

    it('throws 404 TAG_NOT_FOUND if updateMany reports 1 row but the re-fetch finds nothing (defensive branch)', async () => {
      prisma.tag.updateMany.mockResolvedValue({ count: 1 });
      prisma.tag.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await updateTag(prisma, USER_ID, 'tag-1', { name: 'Renamed' });
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.TAG_NOT_FOUND);
    });
  });

  describe('deleteTag', () => {
    it('resolves cleanly when deleteMany affects exactly 1 row', async () => {
      prisma.tag.deleteMany.mockResolvedValue({ count: 1 });

      await expect(deleteTag(prisma, USER_ID, 'tag-1')).resolves.toBeUndefined();

      expect(prisma.tag.deleteMany).toHaveBeenCalledWith({ where: { id: 'tag-1', userId: USER_ID } });
    });

    it('throws 404 TAG_NOT_FOUND when deleteMany affects 0 rows (missing or not owned)', async () => {
      prisma.tag.deleteMany.mockResolvedValue({ count: 0 });

      let caught: unknown;
      try {
        await deleteTag(prisma, USER_ID, 'missing-tag');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.TAG_NOT_FOUND);
    });
  });

  describe('listTags', () => {
    it('scopes the where clause to userId, includes _count.notes filtered to active notes, and computes skip/take + totalPages correctly', async () => {
      const items = [
        { ...baseTag({ id: 'tag-a' }), _count: { notes: 2 } },
        { ...baseTag({ id: 'tag-b' }), _count: { notes: 0 } },
      ];
      prisma.tag.findMany.mockResolvedValue(items);
      prisma.tag.count.mockResolvedValue(25);

      const pagination: PaginationQuery = { page: 2, pageSize: 10 };
      const result = await listTags(prisma, USER_ID, pagination);

      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { userId: USER_ID },
        include: {
          _count: {
            select: { notes: { where: { note: { deletedAt: null } } } },
          },
        },
        skip: 10,
        take: 10,
      });
      expect(prisma.tag.count).toHaveBeenCalledWith({ where: { userId: USER_ID } });
      expect(result).toEqual({ items, page: 2, pageSize: 10, totalItems: 25, totalPages: 3 });
      expect(result.items.every((item) => typeof item._count.notes === 'number')).toBe(true);
    });

    it('computes skip/take for page 1 (default pagination)', async () => {
      prisma.tag.findMany.mockResolvedValue([]);
      prisma.tag.count.mockResolvedValue(0);

      const pagination: PaginationQuery = { page: 1, pageSize: 10 };
      const result = await listTags(prisma, USER_ID, pagination);

      expect(prisma.tag.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 10 }),
      );
      expect(result).toEqual({ items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 0 });
    });
  });
});
