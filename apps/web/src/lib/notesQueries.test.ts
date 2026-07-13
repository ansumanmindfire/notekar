import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { Note, Page, TagWithCount } from 'shared';

vi.mock('./notesApi', () => ({
  listNotes: vi.fn(),
  listTrash: vi.fn(),
  listTags: vi.fn(),
  restoreNote: vi.fn(),
}));

import { listNotes, listTags, listTrash, restoreNote } from './notesApi';
import { notesKeys, useNotesListQuery, useRestoreNoteMutation, useTagsQuery, useTrashListQuery } from './notesQueries';

const mockListNotes = vi.mocked(listNotes);
const mockListTrash = vi.mocked(listTrash);
const mockListTags = vi.mocked(listTags);
const mockRestoreNote = vi.mocked(restoreNote);

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
