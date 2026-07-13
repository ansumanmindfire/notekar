import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import type { Note, Page, TagWithCount } from 'shared';
import { ApiRequestError } from './apiClient';

vi.mock('./notesApi');

import { createNote, createTag, deleteNote, getNote, listNotes, listTags, listTrash, restoreNote, updateNote } from './notesApi';
import {
  notesKeys,
  useCreateNoteMutation,
  useCreateTagMutation,
  useDeleteNoteMutation,
  useNoteQuery,
  useNotesListQuery,
  useRestoreNoteMutation,
  useTagsQuery,
  useTrashListQuery,
  useUpdateNoteMutation,
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
