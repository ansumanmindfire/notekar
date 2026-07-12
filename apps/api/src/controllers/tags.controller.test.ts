import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import type { Tag as PrismaTag } from '@prisma/client';
import { AppError } from '../lib/AppError';
import { ErrorCodes } from 'shared/errorCodes';

// Mock the service layer so the controller's calls into tags.service.ts are
// fully observable/controllable, without touching Prisma or a real database.
// Declared with vi.hoisted so these fns exist before the hoisted vi.mock
// factory below runs, and so tests can import/reset them directly.
const mockService = vi.hoisted(() => ({
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listTags: vi.fn(),
}));

vi.mock('../services/tags.service', () => mockService);

// The controller also imports the Prisma singleton directly (to pass it
// through to the mocked service functions) - mock it too so no real DB
// connection is attempted at import time.
vi.mock('../lib/prisma', () => ({ prisma: {} }));

// Imported after the mocks are registered so createTagsController resolves
// the mocked '../services/tags.service' and '../lib/prisma' modules.
const { createTagsController } = await import('./tags.controller');

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

function makePrismaTag(overrides: Partial<PrismaTag> = {}): PrismaTag {
  return {
    id: 'tag-1',
    userId: USER_ID,
    name: 'Work',
    color: 'blue',
    ...overrides,
  } as unknown as PrismaTag;
}

function makeTagWithCount(overrides: Record<string, unknown> = {}) {
  return {
    ...makePrismaTag(),
    _count: { notes: 0 },
    ...overrides,
  };
}

describe('tags.controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('valid body -> calls service with parsed input, responds 201 with mapped tag (no userId leaked)', async () => {
      const controller = createTagsController();
      const tag = makePrismaTag();
      mockService.createTag.mockResolvedValue(tag);

      const req = createMockReq({ body: { name: 'Work', color: 'blue' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(mockService.createTag).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        { name: 'Work', color: 'blue' },
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ id: 'tag-1', name: 'Work', color: 'blue' });
      expect(next).not.toHaveBeenCalled();
    });

    it('invalid body (empty name) -> next(ZodError), no service call, no response sent', async () => {
      const controller = createTagsController();
      const req = createMockReq({ body: { name: '', color: 'blue' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.createTag).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('invalid body (color outside fixed enum) -> next(ZodError), no service call', async () => {
      const controller = createTagsController();
      const req = createMockReq({ body: { name: 'Work', color: 'magenta' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.createTag).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('service throws AppError(409 TAG_NAME_DUPLICATE) -> next(err), no response sent', async () => {
      const controller = createTagsController();
      const duplicateError = new AppError(409, ErrorCodes.TAG_NAME_DUPLICATE, 'A tag with this name already exists');
      mockService.createTag.mockRejectedValue(duplicateError);

      const req = createMockReq({ body: { name: 'Work', color: 'blue' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(duplicateError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('valid partial body (name only) -> calls service with parsed input + id from req.params.id, responds 200 mapped', async () => {
      const controller = createTagsController();
      const updated = makePrismaTag({ name: 'Renamed' });
      mockService.updateTag.mockResolvedValue(updated);

      const req = createMockReq({ params: { id: 'tag-1' }, body: { name: 'Renamed' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(mockService.updateTag).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        'tag-1',
        { name: 'Renamed' },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ id: 'tag-1', name: 'Renamed', color: 'blue' });
      expect(next).not.toHaveBeenCalled();
    });

    it('valid partial body (color only) -> passes through to the service', async () => {
      const controller = createTagsController();
      const updated = makePrismaTag({ color: 'green' });
      mockService.updateTag.mockResolvedValue(updated);

      const req = createMockReq({ params: { id: 'tag-1' }, body: { color: 'green' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(mockService.updateTag).toHaveBeenCalledWith(
        expect.anything(),
        USER_ID,
        'tag-1',
        { color: 'green' },
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ id: 'tag-1', name: 'Work', color: 'green' });
    });

    it('invalid body (neither name nor color provided) -> next(ZodError), no service call', async () => {
      const controller = createTagsController();
      const req = createMockReq({ params: { id: 'tag-1' }, body: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.updateTag).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 TAG_NOT_FOUND) -> next(err), no response sent', async () => {
      const controller = createTagsController();
      const notFoundError = new AppError(404, ErrorCodes.TAG_NOT_FOUND, 'Tag not found');
      mockService.updateTag.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-tag' }, body: { name: 'Renamed' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(notFoundError);
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('service throws AppError(409 TAG_NAME_DUPLICATE) -> next(err), no response sent', async () => {
      const controller = createTagsController();
      const duplicateError = new AppError(409, ErrorCodes.TAG_NAME_DUPLICATE, 'A tag with this name already exists');
      mockService.updateTag.mockRejectedValue(duplicateError);

      const req = createMockReq({ params: { id: 'tag-1' }, body: { name: 'Existing' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((next as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(duplicateError);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('service resolves -> responds 204 with no body (res.send called with no arguments)', async () => {
      const controller = createTagsController();
      mockService.deleteTag.mockResolvedValue(undefined);

      const req = createMockReq({ params: { id: 'tag-1' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.remove(req, res, next);

      expect(mockService.deleteTag).toHaveBeenCalledWith(expect.anything(), USER_ID, 'tag-1');
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.send).toHaveBeenCalledTimes(1);
      expect(res.send).toHaveBeenCalledWith();
      expect(res.json).not.toHaveBeenCalled();
      expect(next).not.toHaveBeenCalled();
    });

    it('service throws AppError(404 TAG_NOT_FOUND) -> next(err), no response sent', async () => {
      const controller = createTagsController();
      const notFoundError = new AppError(404, ErrorCodes.TAG_NOT_FOUND, 'Tag not found');
      mockService.deleteTag.mockRejectedValue(notFoundError);

      const req = createMockReq({ params: { id: 'missing-tag' } });
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
    it('empty query -> pagination defaults (page: 1, pageSize: 10) reach the service call, responds 200 mapped Page<TagWithCount> with noteCount pulled from _count.notes', async () => {
      const controller = createTagsController();
      const tag = makeTagWithCount({ _count: { notes: 3 } });
      mockService.listTags.mockResolvedValue({
        items: [tag],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      });

      const req = createMockReq({ query: {} });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(mockService.listTags).toHaveBeenCalledWith(expect.anything(), USER_ID, {
        page: 1,
        pageSize: 10,
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        items: [{ id: 'tag-1', name: 'Work', color: 'blue', noteCount: 3 }],
        page: 1,
        pageSize: 10,
        totalItems: 1,
        totalPages: 1,
      });
      expect(next).not.toHaveBeenCalled();
    });

    it('explicit query values are coerced and passed through to the service', async () => {
      const controller = createTagsController();
      mockService.listTags.mockResolvedValue({
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

      expect(mockService.listTags).toHaveBeenCalledWith(expect.anything(), USER_ID, {
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
    });

    it('invalid pageSize (exceeds max 50) -> next(ZodError), no service call, no response sent', async () => {
      const controller = createTagsController();
      const req = createMockReq({ query: { pageSize: '999' } });
      const res = createMockRes();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      const err = (next as ReturnType<typeof vi.fn>).mock.calls[0]![0];
      expect(err).toBeInstanceOf(ZodError);
      expect(mockService.listTags).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });
  });
});
