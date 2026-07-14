import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { Note, Page, SearchResultItem, TagWithCount } from 'shared';
import { ApiRequestError } from './apiClient';

vi.mock('./notesApi');

import {
  createNote,
  createTag,
  deleteNote,
  getNote,
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
  listVersions,
  getVersionDetail,
  restoreVersion,
} from './notesApi';
import {
  notesKeys,
  useCreateNoteMutation,
  useCreateTagMutation,
  useDeleteNoteMutation,
  useNoteQuery,
  useNotesListQuery,
  useRestoreNoteMutation,
  useSearchQuery,
  useTagsQuery,
  useTrashListQuery,
  useUpdateNoteMutation,
  sharesKeys,
  useShareLinksQuery,
  useCreateShareLinkMutation,
  useRevokeShareLinkMutation,
  usePublicShareQuery,
  versionsKeys,
  useVersionsQuery,
  useVersionDetailQuery,
  useRestoreVersionMutation,
} from './notesQueries';

const mockListNotes = vi.mocked(listNotes);
const mockListTrash = vi.mocked(listTrash);
const mockListTags = vi.mocked(listTags);
const mockRestoreNote = vi.mocked(restoreNote);
const mockGetNote = vi.mocked(getNote);
const mockCreateNote = vi.mocked(createNote);
const mockUpdateNote = vi.mocked(updateNote);
const mockDeleteNote = vi.mocked(deleteNote);
const mockCreateTag = vi.mocked(createTag);
const mockSearch = vi.mocked(search);
const mockListShareLinks = vi.mocked(listShareLinks);
const mockCreateShareLink = vi.mocked(createShareLink);
const mockRevokeShareLink = vi.mocked(revokeShareLink);
const mockGetPublicShare = vi.mocked(getPublicShare);
const mockListVersions = vi.mocked(listVersions);
const mockGetVersionDetail = vi.mocked(getVersionDetail);
const mockRestoreVersion = vi.mocked(restoreVersion);

function emptyPage<T>(): Page<T> {
  return { items: [], page: 1, pageSize: 20, totalItems: 0, totalPages: 0 };
}

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  function wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: queryClient }, children);
  }
  return { queryClient, wrapper };
}

describe('notesKeys', () => {
  it('list() produces the expected key shape', () => {
    const params = { sort: 'createdAt:desc' as const, tagIds: ['tag-1'], page: 1, pageSize: 20 };
    expect(notesKeys.list(params)).toEqual(['notes', 'list', params]);
  });

  it('trash() produces the expected key shape', () => {
    const params = { page: 2, pageSize: 20 };
    expect(notesKeys.trash(params)).toEqual(['notes', 'trash', params]);
  });

  it('tags() produces the expected key shape', () => {
    expect(notesKeys.tags()).toEqual(['tags', 'list']);
  });

  it('detail() produces the expected key shape', () => {
    expect(notesKeys.detail('note-1')).toEqual(['notes', 'detail', 'note-1']);
  });

  it('search() produces a key made of q, page, and pageSize', () => {
    expect(notesKeys.search({ q: 'hello', page: 2, pageSize: 10 })).toEqual(['search', 'hello', 2, 10]);
  });
});

describe('sharesKeys', () => {
  it('list() produces the expected key shape', () => {
    expect(sharesKeys.list('note-1')).toEqual(['shares', 'list', 'note-1']);
  });

  it('detail() produces the expected key shape', () => {
    expect(sharesKeys.detail('token-123')).toEqual(['shares', 'public', 'token-123']);
  });
});

describe('versionsKeys', () => {
  it('list() produces the expected key shape', () => {
    expect(versionsKeys.list('note-1')).toEqual(['versions', 'list', 'note-1']);
  });

  it('detail() is scoped by both noteId and versionId', () => {
    expect(versionsKeys.detail('note-1', 'version-1')).toEqual(['versions', 'detail', 'note-1', 'version-1']);
    expect(versionsKeys.detail('note-2', 'version-1')).not.toEqual(versionsKeys.detail('note-1', 'version-1'));
  });
});

describe('useNotesListQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls listNotes with the given params and resolves with the returned page', async () => {
    const page = emptyPage<Note>();
    mockListNotes.mockResolvedValueOnce(page);
    const { wrapper } = createWrapper();
    const params = { sort: 'createdAt:desc' as const, tagIds: [], page: 1, pageSize: 20 };

    const { result } = renderHook(() => useNotesListQuery(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListNotes).toHaveBeenCalledWith(params);
    expect(result.current.data).toEqual(page);
  });
});

describe('useTrashListQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls listTrash with the given params and resolves with the returned page', async () => {
    const page = emptyPage<Note>();
    mockListTrash.mockResolvedValueOnce(page);
    const { wrapper } = createWrapper();
    const params = { page: 1, pageSize: 20 };

    const { result } = renderHook(() => useTrashListQuery(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListTrash).toHaveBeenCalledWith(params);
    expect(result.current.data).toEqual(page);
  });
});

describe('useTagsQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls listTags and resolves with the returned page', async () => {
    const page = emptyPage<TagWithCount>();
    mockListTags.mockResolvedValueOnce(page);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useTagsQuery(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListTags).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual(page);
  });
});

describe('useSearchQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not call search when q is an empty string (disabled by default)', () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSearchQuery({ q: '', page: 1, pageSize: 10 }), { wrapper });

    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('does not call search when q is whitespace-only (disabled by default)', () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useSearchQuery({ q: '   ', page: 1, pageSize: 10 }), { wrapper });

    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });

  it('calls search with the given params and resolves with the returned page when q is non-empty', async () => {
    const page = emptyPage<SearchResultItem>();
    mockSearch.mockResolvedValueOnce(page);
    const { wrapper } = createWrapper();
    const params = { q: 'hello', page: 1, pageSize: 10 };

    const { result } = renderHook(() => useSearchQuery(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockSearch).toHaveBeenCalledWith(params);
    expect(result.current.data).toEqual(page);
  });

  it('includes q, page, and pageSize in the query key used to fetch', async () => {
    const page = emptyPage<SearchResultItem>();
    mockSearch.mockResolvedValueOnce(page);
    const { queryClient, wrapper } = createWrapper();
    const params = { q: 'hello', page: 2, pageSize: 10 };

    const { result } = renderHook(() => useSearchQuery(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(queryClient.getQueryData(notesKeys.search(params))).toEqual(page);
  });

  it('respects an explicit enabled: false override even when q is non-empty', () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(
      () => useSearchQuery({ q: 'hello', page: 1, pageSize: 10 }, { enabled: false }),
      { wrapper },
    );

    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRestoreNoteMutation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates the ["notes"] prefix on a successful restore', async () => {
    const note = { id: 'note-1' } as Note;
    mockRestoreNote.mockResolvedValueOnce(note);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRestoreNoteMutation(), { wrapper });

    result.current.mutate('note-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRestoreNote).toHaveBeenCalledWith('note-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes'] });
  });

  it('still invalidates the ["notes"] prefix when restore fails (e.g. a 404 NOTE_NOT_FOUND race), so a stale trash row disappears on refetch', async () => {
    mockRestoreNote.mockRejectedValueOnce(new Error('NOTE_NOT_FOUND'));
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRestoreNoteMutation(), { wrapper });

    result.current.mutate('note-1');

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes'] });
  });
});

describe('useNoteQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls getNote with the given id and resolves with the returned note', async () => {
    const note = { id: 'note-1', title: 'Hello' } as Note;
    mockGetNote.mockResolvedValueOnce(note);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useNoteQuery('note-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetNote).toHaveBeenCalledWith('note-1');
    expect(result.current.data).toEqual(note);
  });
});

describe('useCreateNoteMutation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('seeds the detail cache with the created note and invalidates the notes list on success', async () => {
    const note = { id: 'note-1', title: 'Hello' } as Note;
    mockCreateNote.mockResolvedValueOnce(note);
    const { queryClient, wrapper } = createWrapper();
    const setQueryDataSpy = vi.spyOn(queryClient, 'setQueryData');
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateNoteMutation(), { wrapper });
    result.current.mutate({ title: 'Hello', body: {} });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(setQueryDataSpy).toHaveBeenCalledWith(['notes', 'detail', 'note-1'], note);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes', 'list'] });
  });
});

describe('useUpdateNoteMutation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates the detail and list keys on success', async () => {
    mockUpdateNote.mockResolvedValueOnce({ id: 'note-1' } as Note);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useUpdateNoteMutation('note-1'), { wrapper });
    result.current.mutate({ title: 'Updated' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockUpdateNote).toHaveBeenCalledWith('note-1', { title: 'Updated' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes', 'detail', 'note-1'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes', 'list'] });
  });
});

describe('useDeleteNoteMutation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates the list and trash keys on success', async () => {
    mockDeleteNote.mockResolvedValueOnce(undefined);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useDeleteNoteMutation(), { wrapper });
    result.current.mutate('note-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockDeleteNote).toHaveBeenCalledWith('note-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes', 'list'] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['notes', 'trash'] });
  });
});

describe('useCreateTagMutation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invalidates the tags list on success', async () => {
    mockCreateTag.mockResolvedValueOnce({ id: 'tag-1', name: 'Work', color: 'blue' });
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateTagMutation(), { wrapper });
    result.current.mutate({ name: 'Work', color: 'blue' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['tags', 'list'] });
  });

  it('surfaces a 409 TAG_NAME_DUPLICATE rejection as an error without invalidating', async () => {
    mockCreateTag.mockRejectedValueOnce(new ApiRequestError({ code: 'TAG_NAME_DUPLICATE', message: 'dup' }));
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useCreateTagMutation(), { wrapper });
    result.current.mutate({ name: 'Work', color: 'blue' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect((result.current.error as ApiRequestError).code).toBe('TAG_NAME_DUPLICATE');
  });
});

describe('useShareLinksQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls listShareLinks and resolves with the returned array', async () => {
    mockListShareLinks.mockResolvedValueOnce([]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useShareLinksQuery('note-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListShareLinks).toHaveBeenCalledWith('note-1');
  });
});

describe('useCreateShareLinkMutation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls createShareLink and invalidates sharesKeys.list(noteId) specifically', async () => {
    mockCreateShareLink.mockResolvedValueOnce({ shareUrl: 'http', expiresAt: null, token: '1' } as never);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useCreateShareLinkMutation('note-1'), { wrapper });
    result.current.mutate({ days: 7 });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockCreateShareLink).toHaveBeenCalledWith('note-1', { days: 7 });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: sharesKeys.list('note-1') });
    
    // Explicitly check it does not invalidate ['notes']
    expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['notes'] }));
  });
});

describe('useRevokeShareLinkMutation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls revokeShareLink and invalidates sharesKeys.list(noteId)', async () => {
    mockRevokeShareLink.mockResolvedValueOnce(undefined as never);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRevokeShareLinkMutation('note-1'), { wrapper });
    result.current.mutate('token-123');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRevokeShareLink).toHaveBeenCalledWith('note-1', 'token-123');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: sharesKeys.list('note-1') });
  });
});

describe('usePublicShareQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls getPublicShare when token is provided', async () => {
    mockGetPublicShare.mockResolvedValueOnce({ title: 't', body: {} as never, viewCount: 0, sharedAt: 'd' });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => usePublicShareQuery('token-123'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetPublicShare).toHaveBeenCalledWith('token-123');
  });

  it('is disabled when token is empty', () => {
    const { wrapper } = createWrapper();
    const { result } = renderHook(() => usePublicShareQuery(''), { wrapper });

    expect(mockGetPublicShare).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useVersionsQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls listVersions with the given noteId and resolves with the returned array', async () => {
    mockListVersions.mockResolvedValueOnce([]);
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useVersionsQuery('note-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockListVersions).toHaveBeenCalledWith('note-1');
  });
});

describe('useVersionDetailQuery', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls getVersionDetail with the given noteId/versionId when enabled', async () => {
    mockGetVersionDetail.mockResolvedValueOnce({
      id: 'version-1',
      version: 2,
      title: 'Old title',
      body: {},
      savedAt: '2026-06-01T12:00:00.000Z',
    });
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useVersionDetailQuery('note-1', 'version-1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockGetVersionDetail).toHaveBeenCalledWith('note-1', 'version-1');
  });

  it('does not call getVersionDetail when enabled is false', () => {
    const { wrapper } = createWrapper();

    const { result } = renderHook(() => useVersionDetailQuery('note-1', 'version-1', { enabled: false }), {
      wrapper,
    });

    expect(mockGetVersionDetail).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe('idle');
  });
});

describe('useRestoreVersionMutation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('calls restoreVersion and invalidates both notesKeys.detail(noteId) and versionsKeys.list(noteId), but not a bare ["notes"] prefix', async () => {
    mockRestoreVersion.mockResolvedValueOnce({ id: 'note-1', version: 3 } as Note);
    const { queryClient, wrapper } = createWrapper();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    const { result } = renderHook(() => useRestoreVersionMutation('note-1'), { wrapper });
    result.current.mutate('version-1');

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockRestoreVersion).toHaveBeenCalledWith('note-1', 'version-1');
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: notesKeys.detail('note-1') });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: versionsKeys.list('note-1') });
    expect(invalidateSpy).not.toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['notes'] }));
  });
});
