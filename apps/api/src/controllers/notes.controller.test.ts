import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { Note as PrismaNote } from '@prisma/client';
import { AppError } from '../lib/AppError';
import { ErrorCodes } from 'shared/errorCodes';

// Mock the service layer so the controller's calls into notes.service.ts are
// fully observable/controllable, without touching Prisma or a real database.
// Declared with vi.hoisted so these fns exist before the hoisted vi.mock
// factory below runs, and so tests can import/reset them directly.
const mockService = vi.hoisted(() => ({
  createNote: vi.fn(),
  getNote: vi.fn(),
  updateNote: vi.fn(),
  softDeleteNote: vi.fn(),
  restoreNote: vi.fn(),
  listNotes: vi.fn(),
  listTrash: vi.fn(),
}));

vi.mock('../services/notes.service', () => mockService);

// The controller also imports the Prisma singleton directly (to pass it
// through to the mocked service functions) - mock it too so no real DB
// connection is attempted at import time.
vi.mock('../lib/prisma', () => ({ prisma: {} }));

// Imported after the mocks are registered so createNotesController resolves
// the mocked '../services/notes.service' and '../lib/prisma' modules.
const { createNotesController } = await import('./notes.controller');

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

function makePrismaNote(overrides: Partial<PrismaNote> = {}): PrismaNote {
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
    ...overrides,
  } as unknown as PrismaNote;
}

describe('notes.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('valid body -> calls service with parsed input, responds 201 with mapped note (ISO date strings)', async () => {
      const controller = createNotesController();
      const note = makePrismaNote();
      mockService.createNote.mockResolvedValue(note);

      const req = createMockReq({ body: { title: 'A note', body: { type: 'doc', content: [] } } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(mockService.createNote).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        { title: 'A note', body: { type: 'doc', content: [] } },
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        id: 'note-1',
        title: 'A note',
        body: { type: 'doc', content: [] },
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
        deletedAt: null,
      });
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        createdAt: unknown;
        updatedAt: unknown;
      };
      expect(typeof jsonArg.createdAt).toBe('string');
      expect(typeof jsonArg.updatedAt).toBe('string');
      expect(next).not.toHaveBeenCalled();
    });

    it('invalid body (missing title) -> next(ZodError), no service call, no response sent', async () => {
      const controller = createNotesController();
      const req = createMockReq({ body: { body: { type: 'doc', content: [] } } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.createNote).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it('service returns a note -> 200 with mapped body', async () => {
      const controller = createNotesController();
      const note = makePrismaNote();
      mockService.getNote.mockResolvedValue(note);

      const req = createMockReq({ params: { id: 'note-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(mockService.getNote).toHaveBeenCalledWith(expect.anything(), USER_ID, 'note-1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'note-1', createdAt: '2026-01-01T00:00:00.000Z' }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404) -> next(err), no response sent', async () => {
      const controller = createNotesController();
      const notFoundError = new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
      mockService.getNote.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-note' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBe(notFoundError);
      expect((err as AppError).statusCode).toBe(404);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('valid partial body -> calls service with parsed input + id from req.params.id, responds 200 mapped', async () => {
      const controller = createNotesController();
      const updated = makePrismaNote({ title: 'Updated title', version: 2 });
      mockService.updateNote.mockResolvedValue(updated);

      const req = createMockReq({ params: { id: 'note-1' }, body: { title: 'Updated title' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(mockService.updateNote).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        'note-1',
        { title: 'Updated title' },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Updated title', version: 2 }),
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('invalid body (neither title nor body provided) -> next(ZodError), no service call', async () => {
      const controller = createNotesController();
      const req = createMockReq({ params: { id: 'note-1' }, body: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.updateNote).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('service resolves -> responds 204 with no body (res.send called with no arguments)', async () => {
      const controller = createNotesController();
      mockService.softDeleteNote.mockResolvedValue(undefined);

      const req = createMockReq({ params: { id: 'note-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.remove(req, res, next);

      expect(mockService.softDeleteNote).toHaveBeenCalledWith(expect.anything(), USER_ID, 'note-1');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404) -> next(err), no response sent', async () => {
      const controller = createNotesController();
      const notFoundError = new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
      mockService.softDeleteNote.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-note' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.remove(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('empty query -> pagination defaults (page: 1, pageSize: 10) reach the service call, responds 200 mapped Page<Note>', async () => {
      const controller = createNotesController();
      const note = makePrismaNote();
      mockService.listNotes.mockResolvedValue({
        items: [note],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      });

      const req = createMockReq({ query: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(mockService.listNotes).toHaveBeenCalledWith(expect.anything(), USER_ID, {
        page: 1,
        pageSize: 10,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        items: [
          {
            id: 'note-1',
            title: 'A note',
            body: { type: 'doc', content: [] },
            version: 1,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-02T00:00:00.000Z',
            deletedAt: null,
          },
        ],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('explicit query values are coerced and passed through to the service', async () => {
      const controller = createNotesController();
      mockService.listNotes.mockResolvedValue({
        items: [],
        page: 2,
        pageSize: 5,
        totalItems: 0,
        totalPages: 0,
      });

      const req = createMockReq({ query: { page: '2', pageSize: '5' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(mockService.listNotes).toHaveBeenCalledWith(expect.anything(), USER_ID, {
        page: 2,
        pageSize: 5,
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('listTrash', () => {
    it('empty query -> pagination defaults reach the service call, responds 200 mapped Page<Note> with non-null deletedAt as ISO string', async () => {
      const controller = createNotesController();
      const trashedNote = makePrismaNote({ deletedAt: new Date('2026-01-03T00:00:00.000Z') });
      mockService.listTrash.mockResolvedValue({
        items: [trashedNote],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      });

      const req = createMockReq({ query: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.listTrash(req, res, next);

      expect(mockService.listTrash).toHaveBeenCalledWith(expect.anything(), USER_ID, {
        page: 1,
        pageSize: 10,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as {
        items: Array<{ deletedAt: unknown }>;
        page: number;
        pageSize: number;
        totalItems: number;
        totalPages: number;
      };
      expect(jsonArg.items[0]!.deletedAt).toBe('2026-01-03T00:00:00.000Z');
      expect(typeof jsonArg.items[0]!.deletedAt).toBe('string');
      expect(jsonArg.page).toBe(1);
      expect(jsonArg.pageSize).toBe(10);
      expect(jsonArg.totalItems).toBe(1);
      expect(jsonArg.totalPages).toBe(1);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('restore', () => {
    it('service returns a note -> 200 mapped, with deletedAt mapped back to null', async () => {
      const controller = createNotesController();
      const restored = makePrismaNote({ deletedAt: null });
      mockService.restoreNote.mockResolvedValue(restored);

      const req = createMockReq({ params: { id: 'note-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.restore(req, res, next);

      expect(mockService.restoreNote).toHaveBeenCalledWith(expect.anything(), USER_ID, 'note-1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ deletedAt: null }));
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { deletedAt: unknown };
      expect(jsonArg.deletedAt).toBeNull();
      expect(jsonArg.deletedAt).not.toBeUndefined();
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404) -> next(err), no response sent', async () => {
      const controller = createNotesController();
      const notFoundError = new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
      mockService.restoreNote.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-note' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.restore(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
