import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './apiClient';
import {
  createNote,
  createTag,
  deleteNote,
  listNotes,
  listTags,
  listTrash,
  restoreNote,
  search,
  updateNote,
  listShareLinks,
  createShareLink,
  revokeShareLink,
  getPublicShare,
} from './notesApi';

vi.mock('./apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('notesApi', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('listNotes', () => {
    it('builds the query string with sort, page, and pageSize when tagIds is empty', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
      });

      await listNotes({ sort: 'createdAt:desc', tagIds: [], page: 1, pageSize: 20 });

      expect(apiRequest).toHaveBeenCalledTimes(1);
      const [path] = vi.mocked(apiRequest).mock.calls[0] as [string];
      expect(path).toBe('/notes?sort=createdAt%3Adesc&page=1&pageSize=20');
    });

    it('comma-joins tagIds into the query string when non-empty', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        items: [],
        page: 2,
        pageSize: 10,
        totalItems: 0,
        totalPages: 0,
      });

      await listNotes({
        sort: 'updatedAt:asc',
        tagIds: ['tag-1', 'tag-2'],
        page: 2,
        pageSize: 10,
      });

      const [path] = vi.mocked(apiRequest).mock.calls[0] as [string];
      expect(path).toBe('/notes?sort=updatedAt%3Aasc&tagIds=tag-1%2Ctag-2&page=2&pageSize=10');
    });
  });

  describe('listTrash', () => {
    it('builds a query string with only page and pageSize, no sort or tagIds', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        items: [],
        page: 1,
        pageSize: 20,
        totalItems: 0,
        totalPages: 0,
      });

      await listTrash({ page: 1, pageSize: 20 });

      expect(apiRequest).toHaveBeenCalledTimes(1);
      const [path] = vi.mocked(apiRequest).mock.calls[0] as [string];
      expect(path).toBe('/notes/trash?page=1&pageSize=20');
    });
  });

  describe('search', () => {
    it('builds the query string with q, page, and pageSize against /search', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        items: [],
        page: 1,
        pageSize: 10,
        totalItems: 0,
        totalPages: 0,
      });

      await search({ q: 'hello world', page: 1, pageSize: 10 });

      expect(apiRequest).toHaveBeenCalledTimes(1);
      const [path] = vi.mocked(apiRequest).mock.calls[0] as [string];
      expect(path).toBe('/search?q=hello+world&page=1&pageSize=10');
    });

    it('omits q from the query string when it is an empty string', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        items: [],
        page: 1,
        pageSize: 10,
        totalItems: 0,
        totalPages: 0,
      });

      await search({ q: '', page: 1, pageSize: 10 });

      const [path] = vi.mocked(apiRequest).mock.calls[0] as [string];
      expect(path).toBe('/search?page=1&pageSize=10');
    });
  });

  describe('listTags', () => {
    it('calls apiRequest with a fixed pageSize of 50 and no other params', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        items: [],
        page: 1,
        pageSize: 50,
        totalItems: 0,
        totalPages: 0,
      });

      await listTags();

      expect(apiRequest).toHaveBeenCalledTimes(1);
      const [path] = vi.mocked(apiRequest).mock.calls[0] as [string];
      expect(path).toBe('/tags?pageSize=50');
    });
  });

  describe('restoreNote', () => {
    it('POSTs to /notes/{id}/restore with no body', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({
        id: 'note-1',
      } as never);

      await restoreNote('note-1');

      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(apiRequest).toHaveBeenCalledWith('/notes/note-1/restore', { method: 'POST' });
    });
  });

  describe('createNote', () => {
    it('POSTs to /notes with title, body, and tagIds', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'note-1' } as never);
      const params = { title: 'Hello', body: {}, tagIds: ['tag-1'] };

      await createNote(params);

      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(apiRequest).toHaveBeenCalledWith('/notes', { method: 'POST', body: params });
    });
  });

  describe('updateNote', () => {
    it('PATCHes to /notes/{id} with only the provided fields', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'note-1' } as never);

      await updateNote('note-1', { title: 'Updated' });

      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(apiRequest).toHaveBeenCalledWith('/notes/note-1', {
        method: 'PATCH',
        body: { title: 'Updated' },
      });
    });
  });

  describe('deleteNote', () => {
    it('DELETEs /notes/{id} with no body', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce(undefined as never);

      await deleteNote('note-1');

      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(apiRequest).toHaveBeenCalledWith('/notes/note-1', { method: 'DELETE' });
    });
  });

  describe('createTag', () => {
    it('POSTs to /tags with name and color', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({ id: 'tag-1' } as never);
      const params = { name: 'Work', color: 'blue' as const };

      await createTag(params);

      expect(apiRequest).toHaveBeenCalledTimes(1);
      expect(apiRequest).toHaveBeenCalledWith('/tags', { method: 'POST', body: params });
    });
  });

  describe('shares', () => {
    it('listShareLinks GETs /notes/{id}/shares', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce([] as never);
      await listShareLinks('note-1');
      expect(apiRequest).toHaveBeenCalledWith('/notes/note-1/shares');
    });

    it('createShareLink with days present sends the correctly-computed ISO expiresAt', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
      vi.mocked(apiRequest).mockResolvedValueOnce({} as never);
      
      await createShareLink('note-1', { days: 14 });
      
      expect(apiRequest).toHaveBeenCalledWith('/notes/note-1/shares', {
        method: 'POST',
        body: { expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString() }
      });
      vi.useRealTimers();
    });

    it('createShareLink with days omitted sends no expiresAt field at all', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({} as never);
      
      await createShareLink('note-1', {});
      
      expect(apiRequest).toHaveBeenCalledWith('/notes/note-1/shares', {
        method: 'POST',
        body: {}
      });
    });

    it('revokeShareLink DELETEs /notes/{id}/shares/{token}', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce(undefined as never);
      await revokeShareLink('note-1', 'token-123');
      expect(apiRequest).toHaveBeenCalledWith('/notes/note-1/shares/token-123', { method: 'DELETE' });
    });

    it('getPublicShare GETs /public/shares/:token', async () => {
      vi.mocked(apiRequest).mockResolvedValueOnce({} as never);
      await getPublicShare('token-123');
      expect(apiRequest).toHaveBeenCalledWith('/public/shares/token-123');
    });
  });
});

