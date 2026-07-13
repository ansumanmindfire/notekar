import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from 'shared';

vi.mock('../lib/notesQueries', () => ({
  useCreateNoteMutation: vi.fn(),
  useUpdateNoteMutation: vi.fn(),
}));

import { useCreateNoteMutation, useUpdateNoteMutation } from '../lib/notesQueries';
import { useAutosave } from './useAutosave';
import { useDraftStore } from '../stores/draftStore';
import { useEditorStatusStore } from '../stores/editorStatusStore';

const mockUseCreateNoteMutation = vi.mocked(useCreateNoteMutation);
const mockUseUpdateNoteMutation = vi.mocked(useUpdateNoteMutation);

const DEBOUNCE_MS = 2000;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAutosave', () => {
  let createMutateAsync: ReturnType<typeof vi.fn>;
  let updateMutateAsync: ReturnType<typeof vi.fn>;
  let onCreated: ReturnType<typeof vi.fn<(note: Note) => void>>;

  beforeEach(() => {
    vi.useFakeTimers();
    createMutateAsync = vi.fn();
    updateMutateAsync = vi.fn();
    onCreated = vi.fn<(note: Note) => void>();
    mockUseCreateNoteMutation.mockReturnValue({ mutateAsync: createMutateAsync } as never);
    mockUseUpdateNoteMutation.mockReturnValue({ mutateAsync: updateMutateAsync } as never);
    useEditorStatusStore.setState({ status: 'idle' });
    useDraftStore.setState({ drafts: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    useEditorStatusStore.setState({ status: 'idle' });
    useDraftStore.setState({ drafts: {} });
  });

  it('debounces 2000ms after the last change before firing a create', async () => {
    createMutateAsync.mockResolvedValueOnce({ id: 'note-1' } as Note);
    const { rerender } = renderHook(
      (props: { title: string }) =>
        useAutosave({ mode: 'new', title: props.title, body: {}, tagIds: [], onCreated }),
      { initialProps: { title: '' } },
    );

    rerender({ title: 'Hello' });
    expect(createMutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(createMutateAsync).toHaveBeenCalledTimes(1);
    expect(createMutateAsync).toHaveBeenCalledWith({ title: 'Hello', body: {}, tagIds: [] });
  });

  it('never fires while the title is empty, even with body content', async () => {
    const { rerender } = renderHook(
      (props: { body: Record<string, unknown> }) =>
        useAutosave({ mode: 'new', title: '', body: props.body, tagIds: [], onCreated }),
      { initialProps: { body: {} } },
    );

    rerender({ body: { type: 'doc', content: [{ type: 'paragraph' }] } });

    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });

    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it('holds a second debounce tick during an in-flight create instead of double-creating, then saves the latest edit once the first resolves', async () => {
    const first = deferred<Note>();
    createMutateAsync.mockReturnValueOnce(first.promise);
    createMutateAsync.mockResolvedValueOnce({ id: 'note-1' } as Note);

    const { rerender } = renderHook(
      (props: { title: string }) =>
        useAutosave({ mode: 'new', title: props.title, body: {}, tagIds: [], onCreated }),
      { initialProps: { title: '' } },
    );

    rerender({ title: 'Hello' });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(createMutateAsync).toHaveBeenCalledTimes(1);

    rerender({ title: 'Hello World' });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    // Still in flight - the second debounce tick must not have fired a second create.
    expect(createMutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ id: 'note-1' } as Note);
      await first.promise;
    });

    expect(createMutateAsync).toHaveBeenCalledTimes(2);
    expect(createMutateAsync).toHaveBeenLastCalledWith({ title: 'Hello World', body: {}, tagIds: [] });
  });

  it('retries exactly once automatically on failure, and shows no error if the retry succeeds', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('network blip'));
    updateMutateAsync.mockResolvedValueOnce({ id: 'note-1' } as Note);

    const { rerender } = renderHook(
      (props: { title: string }) =>
        useAutosave({ mode: 'existing', noteId: 'note-1', title: props.title, body: {}, tagIds: [], onCreated }),
      { initialProps: { title: 'Original' } },
    );

    rerender({ title: 'Updated' });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(updateMutateAsync).toHaveBeenCalledTimes(2);
    expect(useEditorStatusStore.getState().status).toBe('saved');
  });

  it('shows the error state after the retry also fails, preserving the draft content', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('fail 1'));
    updateMutateAsync.mockRejectedValueOnce(new Error('fail 2'));

    const { rerender } = renderHook(
      (props: { title: string }) =>
        useAutosave({ mode: 'existing', noteId: 'note-1', title: props.title, body: {}, tagIds: [], onCreated }),
      { initialProps: { title: 'Original' } },
    );

    rerender({ title: 'Updated' });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(updateMutateAsync).toHaveBeenCalledTimes(2);
    expect(useEditorStatusStore.getState().status).toBe('error');
    expect(useDraftStore.getState().drafts['note-1']).toEqual({ title: 'Updated', body: {} });
  });

  it('re-invokes the save via the manual retry function, itself eligible for one further automatic retry', async () => {
    updateMutateAsync.mockRejectedValueOnce(new Error('fail 1'));
    updateMutateAsync.mockRejectedValueOnce(new Error('fail 2'));
    updateMutateAsync.mockResolvedValueOnce({ id: 'note-1' } as Note);

    const { rerender, result } = renderHook(
      (props: { title: string }) =>
        useAutosave({ mode: 'existing', noteId: 'note-1', title: props.title, body: {}, tagIds: [], onCreated }),
      { initialProps: { title: 'Original' } },
    );

    rerender({ title: 'Updated' });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(useEditorStatusStore.getState().status).toBe('error');
    expect(updateMutateAsync).toHaveBeenCalledTimes(2);

    await act(async () => {
      result.current.retry();
    });

    expect(updateMutateAsync).toHaveBeenCalledTimes(3);
    expect(useEditorStatusStore.getState().status).toBe('saved');
  });

  it('on a 404 NOTE_NOT_FOUND updating an existing note, sets the error state without falling back to createNote', async () => {
    updateMutateAsync.mockRejectedValue(new Error('NOTE_NOT_FOUND'));

    const { rerender } = renderHook(
      (props: { title: string }) =>
        useAutosave({ mode: 'existing', noteId: 'note-1', title: props.title, body: {}, tagIds: [], onCreated }),
      { initialProps: { title: 'Original' } },
    );

    rerender({ title: 'Updated' });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(useEditorStatusStore.getState().status).toBe('error');
    expect(createMutateAsync).not.toHaveBeenCalled();
  });

  it('fires a PATCH with only the changed field(s) for an existing note', async () => {
    updateMutateAsync.mockResolvedValueOnce({ id: 'note-1' } as Note);
    const unchangedBody = { type: 'doc' };

    const { rerender } = renderHook(
      (props: { title: string; body: Record<string, unknown> }) =>
        useAutosave({
          mode: 'existing',
          noteId: 'note-1',
          title: props.title,
          body: props.body,
          tagIds: [],
          onCreated,
        }),
      { initialProps: { title: 'Original', body: unchangedBody } },
    );

    rerender({ title: 'Updated', body: unchangedBody });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(updateMutateAsync).toHaveBeenCalledWith({ title: 'Updated' });
  });

  it('calls onCreated with the new note on a successful first create', async () => {
    const note = { id: 'note-1', title: 'Hello' } as Note;
    createMutateAsync.mockResolvedValueOnce(note);

    const { rerender } = renderHook(
      (props: { title: string }) =>
        useAutosave({ mode: 'new', title: props.title, body: {}, tagIds: [], onCreated }),
      { initialProps: { title: '' } },
    );

    rerender({ title: 'Hello' });
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });

    expect(onCreated).toHaveBeenCalledWith(note);
  });
});
