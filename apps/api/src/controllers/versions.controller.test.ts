import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { NoteVersion as PrismaNoteVersion, Note as PrismaNote } from '@prisma/client';
import { AppError } from '../lib/AppError';
import { ErrorCodes } from 'shared/errorCodes';

// Mock the service layer so the controller's calls into versions.service.ts are
// fully observable/controllable, without touching Prisma or a real database.
// Declared with vi.hoisted so these fns exist before the hoisted vi.mock
// factory below runs, and so tests can import/reset them directly.
const mockService = vi.hoisted(() => ({
  listVersions: vi.fn(),
  getVersion: vi.fn(),
  restoreVersion: vi.fn(),
}));

vi.mock('../services/versions.service', () => mockService);

// The controller also imports the Prisma singleton directly (to pass it
// through to the mocked service functions) - mock it too so no real DB
// connection is attempted at import time.
vi.mock('../lib/prisma', () => ({ prisma: {} }));

// Imported after the mocks are registered so createVersionsController resolves
// the mocked '../services/versions.service' and '../lib/prisma' modules.
const { createVersionsController } = await import('./versions.controller');

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

function makePrismaNoteVersion(overrides: Partial<PrismaNoteVersion> = {}): PrismaNoteVersion {
  return {
    id: 'version-1',
    noteId: 'note-1',
    version: 1,
    title: 'Historical title',
    body: { type: 'doc', content: [{ type: 'text', text: 'historical' }] },
    savedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as PrismaNoteVersion;
}

// NoteWithTags shape (Note & { tags: { tagId: string }[] }), as returned by
// restoreVersion -- the controller reuses notes.controller.ts's toNoteResponse,
// which maps `tags` -> `tagIds` on the response.
function makePrismaNote(
  overrides: Partial<PrismaNote> & { tags?: { tagId: string }[] } = {},
): PrismaNote & { tags: { tagId: string }[] } {
  const { tags, ...rest } = overrides;
  return {
    id: 'note-1',
    userId: USER_ID,
    title: 'Restored title',
    body: { type: 'doc', content: [] },
    bodyText: '',
    version: 2,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-03T00:00:00.000Z'),
    deletedAt: null,
    tags: tags ?? [],
    ...rest,
  } as unknown as PrismaNote & { tags: { tagId: string }[] };
}

describe('versions.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('list', () => {
    it('service resolves with versions -> 200 with an array mapped to summaries (id/version/title/savedAt only, no body)', async () => {
      const controller = createVersionsController();
      const v1 = makePrismaNoteVersion({
        id: 'version-2',
        version: 2,
        title: 'Newer',
        savedAt: new Date('2026-01-03T00:00:00.000Z'),
      });
      const v2 = makePrismaNoteVersion({
        id: 'version-1',
        version: 1,
        title: 'Older',
        savedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      mockService.listVersions.mockResolvedValue([v1, v2]);

      const req = createMockReq({ params: { id: 'note-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(mockService.listVersions).toHaveBeenCalledWith(expect.anything(), USER_ID, 'note-1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([
        { id: 'version-2', version: 2, title: 'Newer', savedAt: '2026-01-03T00:00:00.000Z' },
        { id: 'version-1', version: 1, title: 'Older', savedAt: '2026-01-01T00:00:00.000Z' },
      ]);

      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<
        Record<string, unknown>
      >;
      expect(Array.isArray(jsonArg)).toBe(true);
      for (const item of jsonArg) {
        expect(Object.keys(item).sort()).toEqual(['id', 'savedAt', 'title', 'version'].sort());
        expect(item).not.toHaveProperty('body');
      }
      expect(next).not.toHaveBeenCalled();
    });

    it('service resolves with an empty array (never-updated note) -> 200 with []', async () => {
      const controller = createVersionsController();
      mockService.listVersions.mockResolvedValue([]);

      const req = createMockReq({ params: { id: 'note-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([]);
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 NOTE_NOT_FOUND) -> next(err), not thrown/swallowed, no response sent', async () => {
      const controller = createVersionsController();
      const notFoundError = new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
      mockService.listVersions.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-note' } });
      const res = createMockRes();
      const next = createMockNext();

      await expect(controller.list(req, res, next)).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('preview', () => {
    it('service resolves -> 200 with full detail (id/version/title/savedAt/body)', async () => {
      const controller = createVersionsController();
      const version = makePrismaNoteVersion({
        id: 'version-1',
        version: 1,
        title: 'Historical title',
        body: { type: 'doc', content: [{ type: 'text', text: 'hello' }] },
        savedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      mockService.getVersion.mockResolvedValue(version);

      const req = createMockReq({ params: { id: 'note-1', versionId: 'version-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.preview(req, res, next);

      expect(mockService.getVersion).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        'note-1',
        'version-1',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        id: 'version-1',
        version: 1,
        title: 'Historical title',
        savedAt: '2026-01-01T00:00:00.000Z',
        body: { type: 'doc', content: [{ type: 'text', text: 'hello' }] },
      });

      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(jsonArg).sort()).toEqual(
        ['body', 'id', 'savedAt', 'title', 'version'].sort(),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 NOTE_NOT_FOUND) -> next(err), no response sent', async () => {
      const controller = createVersionsController();
      const notFoundError = new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
      mockService.getVersion.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-note', versionId: 'version-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await expect(controller.preview(req, res, next)).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 VERSION_NOT_FOUND) -> next(err), no response sent', async () => {
      const controller = createVersionsController();
      const versionNotFoundError = new AppError(404, ErrorCodes.VERSION_NOT_FOUND, 'Version not found');
      mockService.getVersion.mockRejectedValue(versionNotFoundError);

      const req = createMockReq({ params: { id: 'note-1', versionId: 'missing-version' } });
      const res = createMockRes();
      const next = createMockNext();

      await expect(controller.preview(req, res, next)).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(versionNotFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('service resolves -> calls service with id/versionId from req.params, responds 200 with full Note shape (via toNoteResponse)', async () => {
      const controller = createVersionsController();
      const restoredNote = makePrismaNote({
        title: 'Reverted title',
        version: 3,
        tags: [{ tagId: 'tag-1' }],
      });
      mockService.restoreVersion.mockResolvedValue(restoredNote);

      const req = createMockReq({ params: { id: 'note-1', versionId: 'version-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.restore(req, res, next);

      expect(mockService.restoreVersion).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        'note-1',
        'version-1',
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        id: 'note-1',
        title: 'Reverted title',
        body: { type: 'doc', content: [] },
        tagIds: ['tag-1'],
        version: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-03T00:00:00.000Z',
        deletedAt: null,
      });

      // Confirms restore reuses notes.controller.ts's Note response shape
      // exactly (same 7 fields as PATCH /notes/:id), not a version-shaped body.
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<
        string,
        unknown
      >;
      expect(Object.keys(jsonArg).sort()).toEqual(
        ['body', 'createdAt', 'deletedAt', 'id', 'tagIds', 'title', 'updatedAt', 'version'].sort(),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('restore on a currently-trashed note -> deletedAt passed through as an ISO string (unchanged, still trashed)', async () => {
      const controller = createVersionsController();
      const restoredNote = makePrismaNote({
        deletedAt: new Date('2026-01-02T00:00:00.000Z'),
      });
      mockService.restoreVersion.mockResolvedValue(restoredNote);

      const req = createMockReq({ params: { id: 'note-1', versionId: 'version-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.restore(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ deletedAt: '2026-01-02T00:00:00.000Z' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 NOTE_NOT_FOUND) -> next(err), no response sent, no mutation observable', async () => {
      const controller = createVersionsController();
      const notFoundError = new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
      mockService.restoreVersion.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-note', versionId: 'version-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await expect(controller.restore(req, res, next)).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 VERSION_NOT_FOUND) -> next(err), no response sent', async () => {
      const controller = createVersionsController();
      const versionNotFoundError = new AppError(404, ErrorCodes.VERSION_NOT_FOUND, 'Version not found');
      mockService.restoreVersion.mockRejectedValue(versionNotFoundError);

      const req = createMockReq({ params: { id: 'note-1', versionId: 'missing-version' } });
      const res = createMockRes();
      const next = createMockNext();

      await expect(controller.restore(req, res, next)).resolves.toBeUndefined();

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(versionNotFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
