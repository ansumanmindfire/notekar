import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './apiClient';
import { listNotes, listTags, listTrash, restoreNote } from './notesApi';

vi.mock('./apiClient', () => ({
  apiRequest: vi.fn(),
}));

describe('notesApi', () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
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
});
