import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { ErrorCodes } from 'shared/errorCodes';
import type { CreateShareLinkInput } from 'shared/schemas';
import { AppError } from '../lib/AppError';
import { createShareLink, listShareLinks, revokeShareLink, viewPublicShare } from './shares.service';

const USER_ID = 'user-1';
const NOTE_ID = 'note-1';
const DAY_MS = 24 * 60 * 60 * 1000;

function createMockPrisma() {
  return {
    $queryRaw: vi.fn(),
    note: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    shareLink: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as PrismaClient & {
    $queryRaw: ReturnType<typeof vi.fn>;
    note: {
      findFirst: ReturnType<typeof vi.fn>;
      findUniqueOrThrow: ReturnType<typeof vi.fn>;
    };
    shareLink: {
      create: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
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

function baseNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    userId: USER_ID,
    title: 'Title',
    body: { type: 'doc', content: [] },
    bodyText: 'Title body',
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function baseShareLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'share-1',
    noteId: NOTE_ID,
    token: 'tok-123',
    expiresAt: new Date(Date.now() + 7 * DAY_MS),
    revokedAt: null,
    viewCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('shares.service', () => {
  let prisma: MockPrisma;

  beforeEach(() => {
    prisma = createMockPrisma();
  });

  describe('createShareLink', () => {
    it('throws 404 NOTE_NOT_FOUND when the note lookup (scoped by id + userId + deletedAt: null) returns null', async () => {
      prisma.note.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await createShareLink(prisma, USER_ID, NOTE_ID, {});
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
      expect(prisma.note.findFirst).toHaveBeenCalledWith({
        where: { id: NOTE_ID, userId: USER_ID, deletedAt: null },
      });
      expect(prisma.shareLink.create).not.toHaveBeenCalled();
    });

    it('defaults expiresAt to now + 7 days when omitted from input', async () => {
      prisma.note.findFirst.mockResolvedValue(baseNote());
      prisma.shareLink.create.mockImplementation((args: { data: { expiresAt: Date } }) =>
        Promise.resolve(baseShareLink({ expiresAt: args.data.expiresAt })),
      );

      const before = Date.now();
      await createShareLink(prisma, USER_ID, NOTE_ID, {});
      const after = Date.now();

      expect(prisma.shareLink.create).toHaveBeenCalledTimes(1);
      const callArgs = prisma.shareLink.create.mock.calls[0]![0] as {
        data: { noteId: string; token: string; expiresAt: Date };
      };
      expect(callArgs.data.noteId).toBe(NOTE_ID);
      expect(typeof callArgs.data.token).toBe('string');
      expect(callArgs.data.token.length).toBeGreaterThan(0);

      const expiresAtMs = callArgs.data.expiresAt.getTime();
      expect(expiresAtMs).toBeGreaterThanOrEqual(before + 7 * DAY_MS - 1000);
      expect(expiresAtMs).toBeLessThanOrEqual(after + 7 * DAY_MS + 1000);
    });

    it('rejects an expiresAt exactly equal to now with 400 VALIDATION_FAILED', async () => {
      prisma.note.findFirst.mockResolvedValue(baseNote());
      const now = new Date();
      const input: CreateShareLinkInput = { expiresAt: now.toISOString() };

      let caught: unknown;
      try {
        await createShareLink(prisma, USER_ID, NOTE_ID, input);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 400, ErrorCodes.VALIDATION_FAILED);
      expect((caught as AppError).fields).toEqual(['expiresAt']);
      expect(prisma.shareLink.create).not.toHaveBeenCalled();
    });

    it('accepts an expiresAt exactly at now + 30 days (upper boundary, inclusive)', async () => {
      prisma.note.findFirst.mockResolvedValue(baseNote());
      const exactlyThirtyDays = new Date(Date.now() + 30 * DAY_MS);
      const created = baseShareLink({ expiresAt: exactlyThirtyDays });
      prisma.shareLink.create.mockResolvedValue(created);

      const input: CreateShareLinkInput = { expiresAt: exactlyThirtyDays.toISOString() };
      const result = await createShareLink(prisma, USER_ID, NOTE_ID, input);

      expect(result).toBe(created);
      expect(prisma.shareLink.create).toHaveBeenCalledWith({
        data: {
          noteId: NOTE_ID,
          token: expect.any(String),
          expiresAt: exactlyThirtyDays,
        },
      });
    });

    it('rejects an expiresAt at now + 30 days + 1ms (just past the upper boundary) with 400 VALIDATION_FAILED', async () => {
      prisma.note.findFirst.mockResolvedValue(baseNote());
      const justOverThirtyDays = new Date(Date.now() + 30 * DAY_MS + 1);
      const input: CreateShareLinkInput = { expiresAt: justOverThirtyDays.toISOString() };

      let caught: unknown;
      try {
        await createShareLink(prisma, USER_ID, NOTE_ID, input);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 400, ErrorCodes.VALIDATION_FAILED);
      expect(prisma.shareLink.create).not.toHaveBeenCalled();
    });
  });

  describe('listShareLinks', () => {
    it('looks up the note by id + userId only (no deletedAt filter), succeeding even for a soft-deleted note', async () => {
      // A soft-deleted note (deletedAt set) still satisfies the findFirst mock
      // because the service's query does not filter on deletedAt at all.
      prisma.note.findFirst.mockResolvedValue(baseNote({ deletedAt: new Date('2026-02-01T00:00:00.000Z') }));
      const links = [baseShareLink()];
      prisma.shareLink.findMany.mockResolvedValue(links);

      const result = await listShareLinks(prisma, USER_ID, NOTE_ID);

      expect(prisma.note.findFirst).toHaveBeenCalledWith({ where: { id: NOTE_ID, userId: USER_ID } });
      expect(prisma.shareLink.findMany).toHaveBeenCalledWith({
        where: { noteId: NOTE_ID },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toBe(links);
    });

    it('throws 404 NOTE_NOT_FOUND when the note lookup returns null', async () => {
      prisma.note.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await listShareLinks(prisma, USER_ID, NOTE_ID);
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.NOTE_NOT_FOUND);
      expect(prisma.shareLink.findMany).not.toHaveBeenCalled();
    });
  });

  describe('revokeShareLink', () => {
    it('throws 404 SHARE_NOT_FOUND when no matching share link is found (scoped by token + noteId + note.userId)', async () => {
      prisma.shareLink.findFirst.mockResolvedValue(null);

      let caught: unknown;
      try {
        await revokeShareLink(prisma, USER_ID, NOTE_ID, 'tok-123');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 404, ErrorCodes.SHARE_NOT_FOUND);
      expect(prisma.shareLink.findFirst).toHaveBeenCalledWith({
        where: { token: 'tok-123', noteId: NOTE_ID, note: { userId: USER_ID } },
      });
      expect(prisma.shareLink.update).not.toHaveBeenCalled();
    });

    it('is an idempotent no-op when the share link is already revoked (does not call update)', async () => {
      const alreadyRevoked = baseShareLink({ revokedAt: new Date('2026-01-05T00:00:00.000Z') });
      prisma.shareLink.findFirst.mockResolvedValue(alreadyRevoked);

      await expect(revokeShareLink(prisma, USER_ID, NOTE_ID, 'tok-123')).resolves.toBeUndefined();

      expect(prisma.shareLink.update).not.toHaveBeenCalled();
    });

    it('revokes an active share link by setting revokedAt to a Date', async () => {
      const active = baseShareLink({ revokedAt: null });
      prisma.shareLink.findFirst.mockResolvedValue(active);
      prisma.shareLink.update.mockResolvedValue({ ...active, revokedAt: new Date() });

      await revokeShareLink(prisma, USER_ID, NOTE_ID, 'tok-123');

      expect(prisma.shareLink.update).toHaveBeenCalledWith({
        where: { id: active.id },
        data: { revokedAt: expect.any(Date) },
      });
    });
  });

  describe('viewPublicShare', () => {
    it('throws 410 GONE_LINK_INVALID when the raw query returns no rows', async () => {
      prisma.$queryRaw.mockResolvedValue([]);

      let caught: unknown;
      try {
        await viewPublicShare(prisma, 'tok-123');
      } catch (err) {
        caught = err;
      }

      expectAppError(caught, 410, ErrorCodes.GONE_LINK_INVALID);
      expect(prisma.note.findUniqueOrThrow).not.toHaveBeenCalled();
    });

    it('returns the note and shareLink row when the raw query returns exactly one row', async () => {
      const row = baseShareLink({ viewCount: 1 });
      prisma.$queryRaw.mockResolvedValue([row]);
      const note = baseNote();
      prisma.note.findUniqueOrThrow.mockResolvedValue(note);

      const result = await viewPublicShare(prisma, 'tok-123');

      expect(prisma.note.findUniqueOrThrow).toHaveBeenCalledWith({ where: { id: row.noteId } });
      expect(result).toEqual({ note, shareLink: row });
    });

    it('issues the atomic view-count increment via a Prisma.sql tagged template, never a plain interpolated string (SQL-injection safety guard)', async () => {
      prisma.$queryRaw.mockResolvedValue([]);
      const maliciousToken = "'; DROP TABLE \"ShareLink\"; --";

      let caught: unknown;
      try {
        await viewPublicShare(prisma, maliciousToken);
      } catch (err) {
        caught = err;
      }

      // Regardless of outcome (GONE_LINK_INVALID here, since we mocked an
      // empty result), the raw query call itself must be inspected.
      expect(caught).toBeInstanceOf(AppError);
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      const arg = prisma.$queryRaw.mock.calls[0]![0] as unknown as { strings: string[]; values: unknown[] };
      // A Prisma.Sql tagged-template value, never a plain string.
      expect(typeof arg).not.toBe('string');
      expect(Array.isArray(arg.strings)).toBe(true);
      expect(Array.isArray(arg.values)).toBe(true);
      // The raw literal SQL text fragments must never contain the
      // user-supplied token directly (that would indicate string
      // concatenation instead of parameter binding); it must only appear
      // as a bound parameter in .values.
      expect(arg.strings.some((part) => part.includes(maliciousToken))).toBe(false);
      expect(arg.values).toContain(maliciousToken);
    });
  });
});
