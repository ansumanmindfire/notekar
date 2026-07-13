import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import type { Note as PrismaNote } from '@prisma/client';
import { AppError } from '../lib/AppError';
import { ErrorCodes } from 'shared/errorCodes';

// Mock the service layer so the controller's calls into shares.service.ts are
// fully observable/controllable, without touching Prisma or a real database.
// Declared with vi.hoisted so these fns exist before the hoisted vi.mock
// factory below runs, and so tests can import/reset them directly.
const mockService = vi.hoisted(() => ({
  viewPublicShare: vi.fn(),
}));

vi.mock('../services/shares.service', () => mockService);

// The controller also imports the Prisma singleton directly (to pass it
// through to the mocked service function) - mock it too so no real DB
// connection is attempted at import time.
vi.mock('../lib/prisma', () => ({ prisma: {} }));

// Imported after the mocks are registered so createPublicController resolves
// the mocked '../services/shares.service' and '../lib/prisma' modules.
const { createPublicController } = await import('./public.controller');

function createMockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    query: {},
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
    userId: 'user-1',
    title: 'X',
    body: { type: 'doc', content: [] },
    bodyText: '',
    version: 1,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    updatedAt: new Date('2020-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  } as unknown as PrismaNote;
}

describe('public.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('view', () => {
    it('service resolves -> calls viewPublicShare with token from req.params, responds 200 with { title, body, viewCount, sharedAt } derived from shareLink (not note)', async () => {
      const controller = createPublicController();
      const note = makePrismaNote({
        title: 'X',
        body: { type: 'doc', content: [] },
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      });
      const shareLink = {
        id: 'share-1',
        noteId: 'note-1',
        token: 'tok_abc123',
        expiresAt: new Date('2026-01-08T00:00:00.000Z'),
        revokedAt: null,
        viewCount: 5,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      };
      mockService.viewPublicShare.mockResolvedValue({ note, shareLink });

      const req = createMockReq({ params: { token: 'tok_abc123' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.view(req, res, next);

      expect(mockService.viewPublicShare).toHaveBeenCalledWith(expect.anything(), 'tok_abc123');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        title: 'X',
        body: { type: 'doc', content: [] },
        viewCount: 5,
        sharedAt: '2026-01-01T00:00:00.000Z',
      });

      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(Object.keys(jsonArg).sort()).toEqual(['body', 'sharedAt', 'title', 'viewCount']);
      // sharedAt must come from shareLink.createdAt, not note.createdAt.
      expect(jsonArg.sharedAt).not.toBe(note.createdAt.toISOString());
      expect(next).not.toHaveBeenCalled();
    });

    it('viewPublicShare rejects with AppError(410 GONE_LINK_INVALID) -> next(err), no response sent', async () => {
      const controller = createPublicController();
      const goneError = new AppError(410, ErrorCodes.GONE_LINK_INVALID, 'Share link is invalid, expired, or revoked');
      mockService.viewPublicShare.mockRejectedValue(goneError);

      const req = createMockReq({ params: { token: 'missing-token' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.view(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(goneError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
