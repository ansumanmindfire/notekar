import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { ShareLink as PrismaShareLink } from '@prisma/client';
import { AppError } from '../lib/AppError';
import { ErrorCodes } from 'shared/errorCodes';

// Mock the service layer so the controller's calls into shares.service.ts are
// fully observable/controllable, without touching Prisma or a real database.
// Declared with vi.hoisted so these fns exist before the hoisted vi.mock
// factory below runs, and so tests can import/reset them directly.
const mockService = vi.hoisted(() => ({
  createShareLink: vi.fn(),
  listShareLinks: vi.fn(),
  revokeShareLink: vi.fn(),
}));

vi.mock('../services/shares.service', () => mockService);

// The controller also imports the Prisma singleton directly (to pass it
// through to the mocked service functions) - mock it too so no real DB
// connection is attempted at import time.
vi.mock('../lib/prisma', () => ({ prisma: {} }));

// Imported after the mocks are registered so createSharesController resolves
// the mocked '../services/shares.service' and '../lib/prisma' modules.
const { createSharesController } = await import('./shares.controller');

const USER_ID = 'user-1';
const WEB_ORIGIN = 'http://localhost:5173';

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

function makePrismaShareLink(overrides: Partial<PrismaShareLink> = {}): PrismaShareLink {
  return {
    id: 'share-1',
    noteId: 'note-1',
    token: 'tok_abc123',
    expiresAt: new Date('2026-01-08T00:00:00.000Z'),
    revokedAt: null,
    viewCount: 0,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as unknown as PrismaShareLink;
}

describe('shares.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('valid body -> calls service with parsed input, responds 201 with mapped share (token/shareUrl/expiresAt/viewCount only)', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      const shareLink = makePrismaShareLink();
      mockService.createShareLink.mockResolvedValue(shareLink);

      const req = createMockReq({
        params: { id: 'note-1' },
        body: { expiresAt: '2026-01-08T00:00:00.000Z' },
      });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(mockService.createShareLink).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        'note-1',
        { expiresAt: '2026-01-08T00:00:00.000Z' },
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        token: 'tok_abc123',
        shareUrl: 'http://localhost:5173/shares/tok_abc123',
        expiresAt: '2026-01-08T00:00:00.000Z',
        viewCount: 0,
      });
      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Record<string, unknown>;
      expect(Object.keys(jsonArg).sort()).toEqual(['expiresAt', 'shareUrl', 'token', 'viewCount']);
      expect(next).not.toHaveBeenCalled();
    });

    it('valid body with no expiresAt -> passes undefined through to the service (schema field is optional)', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      const shareLink = makePrismaShareLink();
      mockService.createShareLink.mockResolvedValue(shareLink);

      const req = createMockReq({ params: { id: 'note-1' }, body: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(mockService.createShareLink).toHaveBeenCalledWith(expect.anything(), USER_ID, 'note-1', {});
      expect(res.status).toHaveBeenCalledWith(201);
      expect(next).not.toHaveBeenCalled();
    });

    it('different WEB_ORIGIN injected -> shareUrl is built from that origin', async () => {
      const controller = createSharesController({ WEB_ORIGIN: 'https://notes.example.com' });
      const shareLink = makePrismaShareLink({ token: 'tok_xyz' });
      mockService.createShareLink.mockResolvedValue(shareLink);

      const req = createMockReq({ params: { id: 'note-1' }, body: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ shareUrl: 'https://notes.example.com/shares/tok_xyz' }),
      );
    });

    it('invalid body (malformed expiresAt) -> next(ZodError), service never called, no response sent', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      const req = createMockReq({ params: { id: 'note-1' }, body: { expiresAt: 'not-a-date' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.createShareLink).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 NOTE_NOT_FOUND) -> next(err), no response sent', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      const notFoundError = new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
      mockService.createShareLink.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-note' }, body: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('service resolves -> 200 with an array; each item has all 7 fields, revokedAt mapped per item (active -> null, revoked -> ISO string)', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      const activeLink = makePrismaShareLink({ id: 'share-1', token: 'tok_active', revokedAt: null });
      const revokedLink = makePrismaShareLink({
        id: 'share-2',
        token: 'tok_revoked',
        revokedAt: new Date('2026-01-05T00:00:00.000Z'),
      });
      mockService.listShareLinks.mockResolvedValue([activeLink, revokedLink]);

      const req = createMockReq({ params: { id: 'note-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(mockService.listShareLinks).toHaveBeenCalledWith(expect.anything(), USER_ID, 'note-1');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([
        {
          id: 'share-1',
          token: 'tok_active',
          shareUrl: 'http://localhost:5173/shares/tok_active',
          expiresAt: '2026-01-08T00:00:00.000Z',
          revokedAt: null,
          viewCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'share-2',
          token: 'tok_revoked',
          shareUrl: 'http://localhost:5173/shares/tok_revoked',
          expiresAt: '2026-01-08T00:00:00.000Z',
          revokedAt: '2026-01-05T00:00:00.000Z',
          viewCount: 0,
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ]);

      const jsonArg = (res.json as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Array<Record<string, unknown>>;
      expect(Array.isArray(jsonArg)).toBe(true);
      for (const item of jsonArg) {
        expect(Object.keys(item).sort()).toEqual(
          ['createdAt', 'expiresAt', 'id', 'revokedAt', 'shareUrl', 'token', 'viewCount'].sort(),
        );
      }
      expect(jsonArg[0]!.revokedAt).toBeNull();
      expect(typeof jsonArg[1]!.revokedAt).toBe('string');
      expect(jsonArg[1]!.revokedAt).toBe('2026-01-05T00:00:00.000Z');
      expect(next).not.toHaveBeenCalled();
    });

    it('service resolves with an empty array -> 200 with []', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      mockService.listShareLinks.mockResolvedValue([]);

      const req = createMockReq({ params: { id: 'note-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith([]);
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 NOTE_NOT_FOUND) -> passed to next, not caught/swallowed, no response sent', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      const notFoundError = new AppError(404, ErrorCodes.NOTE_NOT_FOUND, 'Note not found');
      mockService.listShareLinks.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-note' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('revoke', () => {
    it('service resolves -> calls service with id and token from req.params, responds 204 with no body', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      mockService.revokeShareLink.mockResolvedValue(undefined);

      const req = createMockReq({ params: { id: 'note-1', token: 'tok_abc123' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.revoke(req, res, next);

      expect(mockService.revokeShareLink).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        'note-1',
        'tok_abc123',
      );
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 SHARE_NOT_FOUND) -> next(err), no response sent', async () => {
      const controller = createSharesController({ WEB_ORIGIN });
      const notFoundError = new AppError(404, ErrorCodes.SHARE_NOT_FOUND, 'Share link not found');
      mockService.revokeShareLink.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'note-1', token: 'missing-token' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.revoke(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});
