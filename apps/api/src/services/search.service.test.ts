import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { SearchQuery } from 'shared/schemas';
import { searchNotes } from './search.service';

const USER_ID = 'user-1';

function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    note: {
      findMany: vi.fn(),
    },
  } as unknown as PrismaClient & {
    $queryRaw: ReturnType<typeof vi.fn>;
    note: { findMany: ReturnType<typeof vi.fn> };
  };
}

type MockPrisma = ReturnType<typeof createMockPrisma>;

function baseNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 'note-1',
    userId: USER_ID,
    title: 'Old title',
    body: { type: 'doc', content: [] },
    bodyText: 'Old title body',
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    tags: [],
    ...overrides,
  };
}

describe('search.service', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('searchNotes', () => {
    it('re-sorts findMany results back to the rank order returned by the matches query, even when findMany returns them in a different order', async () => {
      const matchRows = [
        { id: 'note-a', headline: '<mark>foo</mark> highlight a' },
        { id: 'note-b', headline: '<mark>foo</mark> highlight b' },
      ];
      const countRows = [{ count: 2n }];
      // findMany intentionally returns rows in the OPPOSITE order to the ids array.
      const noteB = baseNote({ id: 'note-b', title: 'Note B', tags: [{ tagId: 'tag-1' }] });
      const noteA = baseNote({ id: 'note-a', title: 'Note A', tags: [] });
      prisma.$queryRaw.mockResolvedValueOnce(matchRows).mockResolvedValueOnce(countRows);
      prisma.note.findMany.mockResolvedValue([noteB, noteA]);

      const query: SearchQuery = { q: 'foo', page: 1, pageSize: 10 };
      const result = await searchNotes(prisma, USER_ID, query);

      expect(prisma.note.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['note-a', 'note-b'] } },
        include: { tags: { select: { tagId: true } } },
      });

      expect(result.items).toEqual([
        { note: noteA, headline: matchRows[0]!.headline },
        { note: noteB, headline: matchRows[1]!.headline },
      ]);
    });

    it('assembles correct pagination metadata (page, pageSize, totalItems from count query, totalPages)', async () => {
      const matchRows = [{ id: 'note-a', headline: 'headline a' }];
      const countRows = [{ count: 42n }];
      const note = baseNote({ id: 'note-a' });
      prisma.$queryRaw.mockResolvedValueOnce(matchRows).mockResolvedValueOnce(countRows);
      prisma.note.findMany.mockResolvedValue([note]);

      const query: SearchQuery = { q: 'foo', page: 3, pageSize: 5 };
      const result = await searchNotes(prisma, USER_ID, query);

      expect(result.page).toBe(3);
      expect(result.pageSize).toBe(5);
      expect(result.totalItems).toBe(42);
      expect(result.totalPages).toBe(Math.ceil(42 / 5));
      expect(typeof result.totalItems).toBe('number');
    });

    it('empty matches -> returns items: [] with totalItems 0 and never calls note.findMany', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }]);

      const query: SearchQuery = { q: 'nothing-matches', page: 1, pageSize: 10 };
      const result = await searchNotes(prisma, USER_ID, query);

      expect(prisma.note.findMany).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.totalItems).toBe(0);
    });

    it('empty matches but a nonzero/mismatched count -> function trusts the count query independently, never calling note.findMany', async () => {
      // Contrived race/edge case: the count query reports rows that the
      // ranked/limited matches query did not return (e.g. pagination beyond
      // available rows on this page). Function must not crash and must not
      // reconcile the two independently-issued raw queries against each other.
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 7n }]);

      const query: SearchQuery = { q: 'foo', page: 99, pageSize: 10 };
      const result = await searchNotes(prisma, USER_ID, query);

      expect(prisma.note.findMany).not.toHaveBeenCalled();
      expect(result.items).toEqual([]);
      expect(result.totalItems).toBe(7);
    });

    it('issues both $queryRaw calls via Prisma.sql tagged templates, never plain string concatenation (SQL-injection safety guard)', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([{ count: 0n }]);

      const query: SearchQuery = { q: "'; DROP TABLE \"Note\"; --", page: 1, pageSize: 10 };
      await searchNotes(prisma, USER_ID, query);

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
      const maliciousInput = query.q;
      for (const call of prisma.$queryRaw.mock.calls) {
        const arg = call[0] as unknown as { strings: string[]; values: unknown[] };
        // A Prisma.Sql tagged-template value, never a plain string.
        expect(typeof arg).not.toBe('string');
        expect(Array.isArray(arg.strings)).toBe(true);
        expect(Array.isArray(arg.values)).toBe(true);
        // The raw literal SQL text fragments must never contain the
        // user-supplied value directly (that would indicate string
        // concatenation instead of parameter binding); it must only appear
        // as a bound parameter in .values.
        expect(arg.strings.some((part) => part.includes(maliciousInput))).toBe(false);
        expect(arg.values).toContain(maliciousInput);
      }
    });

    it('silently skips a matched id with no corresponding row in note.findMany (e.g. deleted between the two queries), never producing a null/undefined entry', async () => {
      const matchRows = [
        { id: 'note-a', headline: 'headline a' },
        { id: 'note-gone', headline: 'headline gone' },
        { id: 'note-c', headline: 'headline c' },
      ];
      const countRows = [{ count: 3n }];
      const noteA = baseNote({ id: 'note-a' });
      const noteC = baseNote({ id: 'note-c' });
      prisma.$queryRaw.mockResolvedValueOnce(matchRows).mockResolvedValueOnce(countRows);
      // note-gone is absent from findMany's result entirely.
      prisma.note.findMany.mockResolvedValue([noteA, noteC]);

      const query: SearchQuery = { q: 'foo', page: 1, pageSize: 10 };
      const result = await searchNotes(prisma, USER_ID, query);

      expect(result.items).toHaveLength(2);
      expect(result.items).toEqual([
        { note: noteA, headline: 'headline a' },
        { note: noteC, headline: 'headline c' },
      ]);
      expect(result.items.some((item) => item.note === undefined || item.note === null)).toBe(false);
    });
  });
});
