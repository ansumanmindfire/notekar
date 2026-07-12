import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { Note as PrismaNote } from '@prisma/client';

// Mock the service layer so the controller's calls into search.service.ts are
// fully observable/controllable, without touching Prisma or a real database.
// Declared with vi.hoisted so these fns exist before the hoisted vi.mock
// factory below runs, and so tests can import/reset them directly.
const mockService = vi.hoisted(() => ({
  searchNotes: vi.fn(),
}));

vi.mock('../services/search.service', () => mockService);

// The controller also imports the Prisma singleton directly (to pass it
// through to the mocked service function) - mock it too so no real DB
// connection is attempted at import time.
vi.mock('../lib/prisma', () => ({ prisma: {} }));

// Imported after the mocks are registered so createSearchController resolves
// the mocked '../services/search.service' and '../lib/prisma' modules.
const { createSearchController } = await import('./search.controller');

const USER_ID = 'user-1';

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
    userId: USER_ID,
    ...overrides,
  } as unknown as Request;
}

function createMockRes(): Response {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    send: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// NoteWithTags shape (Note & { tags: { tagId: string }[] }), as returned by
// notes.service.ts / search.service.ts -- the controller's toNoteResponse
// maps `tags` -> `tagIds` on every response.
function makePrismaNote(
  overrides: Partial<PrismaNote> & { tags?: { tagId: string }[] } = {},
): PrismaNote & { tags: { tagId: string }[] } {
  const { tags, ...rest } = overrides;
  return {
    id: 'note-1',
    userId: USER_ID,
    title: 'A note',
    body: { type: 'doc', content: [] },
    bodyText: '',
    version: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    deletedAt: null,
    tags: tags ?? [],
    ...rest,
  } as unknown as PrismaNote & { tags: { tagId: string }[] };
}

describe('search.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('search', () => {
    it('valid q -> calls searchNotes with parsed query + req.userId, responds 200 with mapped { note, headline } items', async () => {
      const controller = createSearchController();
      const note = makePrismaNote({ tags: [{ tagId: 'tag-1' }] });
      mockService.searchNotes.mockResolvedValue({
        items: [{ note, headline: 'A <mark>note</mark> about things' }],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      });

      const req = createMockReq({ query: { q: 'note' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.search(req, res, next);

      expect(mockService.searchNotes).toHaveBeenCalledWith(expect.anything(), USER_ID, {
        q: 'note',
        page: 1,
        pageSize: 10,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        items: [
          {
            note: {
              id: 'note-1',
              title: 'A note',
              body: { type: 'doc', content: [] },
              tagIds: ['tag-1'],
              version: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-02T00:00:00.000Z',
              deletedAt: null,
            },
            headline: 'A <mark>note</mark> about things',
          },
        ],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      });
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        items: Array<{ note: { createdAt: unknown; updatedAt: unknown } }>;
      };
      expect(typeof jsonArg.items[0]!.note.createdAt).toBe('string');
      expect(typeof jsonArg.items[0]!.note.updatedAt).toBe('string');
      expect(next).not.toHaveBeenCalled();
    });

    it('explicit page/pageSize query values are coerced and passed through to the service alongside q', async () => {
      const controller = createSearchController();
      mockService.searchNotes.mockResolvedValue({
        items: [],
        page: 2,
        pageSize: 5,
        totalItems: 0,
        totalPages: 0,
      });

      const req = createMockReq({ query: { q: 'note', page: '2', pageSize: '5' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.search(req, res, next);

      expect(mockService.searchNotes).toHaveBeenCalledWith(expect.anything(), USER_ID, {
        q: 'note',
        page: 2,
        pageSize: 5,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        items: [],
        page: 2,
        pageSize: 5,
        totalItems: 0,
        totalPages: 0,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('missing q query param -> next(ZodError), no service call, no response sent', async () => {
      const controller = createSearchController();
      const req = createMockReq({ query: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.search(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.searchNotes).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('empty-string q -> next(ZodError), no service call, no response sent', async () => {
      const controller = createSearchController();
      const req = createMockReq({ query: { q: '' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.search(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.searchNotes).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('whitespace-only q -> next(ZodError), no service call, no response sent', async () => {
      const controller = createSearchController();
      const req = createMockReq({ query: { q: '   ' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.search(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.searchNotes).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('searchNotes rejects with an unexpected error -> next(err), no response sent', async () => {
      const controller = createSearchController();
      const dbError = new Error('unexpected database error');
      mockService.searchNotes.mockRejectedValue(dbError);

      const req = createMockReq({ query: { q: 'note' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.search(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(dbError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('multiple items in the result page -> maps every item with its own distinct headline and note tagIds', async () => {
      const controller = createSearchController();
      const noteA = makePrismaNote({ id: 'note-a', title: 'First note', tags: [{ tagId: 'tag-1' }] });
      const noteB = makePrismaNote({ id: 'note-b', title: 'Second note', tags: [] });
      mockService.searchNotes.mockResolvedValue({
        items: [
          { note: noteA, headline: 'headline for <mark>first</mark>' },
          { note: noteB, headline: 'headline for <mark>second</mark>' },
        ],
        page: 1,
        pageSize: 10,
        totalItems: 2,
        totalPages: 1,
      });

      const req = createMockReq({ query: { q: 'note' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.search(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        items: Array<{ note: { id: string; tagIds: string[] }; headline: string }>;
      };
      expect(jsonArg.items).toHaveLength(2);
      expect(jsonArg.items[0]).toEqual({
        note: expect.objectContaining({ id: 'note-a', tagIds: ['tag-1'] }),
        headline: 'headline for <mark>first</mark>',
      });
      expect(jsonArg.items[1]).toEqual({
        note: expect.objectContaining({ id: 'note-b', tagIds: [] }),
        headline: 'headline for <mark>second</mark>',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });
});
