import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TAG_COLORS } from 'shared';
import { TagCombobox } from './TagCombobox';
import { ApiRequestError } from '../../lib/apiClient';

vi.mock('../../lib/notesQueries', () => ({
  useTagsQuery: vi.fn(),
  useCreateTagMutation: vi.fn(),
  useUpdateNoteMutation: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { useCreateTagMutation, useTagsQuery, useUpdateNoteMutation } from '../../lib/notesQueries';
import { toast } from 'sonner';

const mockUseTagsQuery = vi.mocked(useTagsQuery);
const mockUseCreateTagMutation = vi.mocked(useCreateTagMutation);
const mockUseUpdateNoteMutation = vi.mocked(useUpdateNoteMutation);

const EXISTING_TAGS = [
  { id: 'tag-work', name: 'Work', color: 'blue' as const, noteCount: 2 },
  { id: 'tag-home', name: 'Home', color: 'green' as const, noteCount: 1 },
];

function mockTagsData(items = EXISTING_TAGS) {
  return {
    data: { items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 },
    refetch: vi.fn().mockResolvedValue({
      data: { items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 },
    }),
  };
}

function typeTagName(name: string) {
  const input = screen.getByLabelText('Add a tag');
  fireEvent.change(input, { target: { value: name } });
}

describe('TagCombobox', () => {
  let createTagMutate: ReturnType<typeof vi.fn>;
  let updateNoteMutate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createTagMutate = vi.fn();
    updateNoteMutate = vi.fn();
    mockUseTagsQuery.mockReturnValue(mockTagsData() as never);
    mockUseCreateTagMutation.mockReturnValue({ mutate: createTagMutate } as never);
    mockUseUpdateNoteMutation.mockReturnValue({ mutate: updateNoteMutate } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('selects an existing tag case-insensitively without calling createTag', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={[]} />);

    typeTagName('work');
    act(() => {
      screen.getByText('Create "work"').click();
    });

    expect(createTagMutate).not.toHaveBeenCalled();
    expect(updateNoteMutate).toHaveBeenCalledWith({ tagIds: ['tag-work'] }, expect.anything());
  });

  it('creates a genuinely new tag with a color drawn from TAG_COLORS', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={[]} />);

    typeTagName('Personal');
    act(() => {
      screen.getByText('Create "Personal"').click();
    });

    expect(createTagMutate).toHaveBeenCalledTimes(1);
    const [params] = createTagMutate.mock.calls[0] as [{ name: string; color: string }];
    expect(params.name).toBe('Personal');
    expect(TAG_COLORS).toContain(params.color);
  });

  it('submits on pressing Enter in the input, not just via the button click', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={[]} />);

    const input = screen.getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: 'work' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(updateNoteMutate).toHaveBeenCalledWith({ tagIds: ['tag-work'] }, expect.anything());
  });

  it('attaches the newly created tag and clears the input when createTag succeeds', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={[]} />);

    typeTagName('Personal');
    act(() => {
      screen.getByText('Create "Personal"').click();
    });

    const [, options] = createTagMutate.mock.calls[0] as [
      unknown,
      { onSuccess: (tag: { id: string; name: string; color: string }) => void },
    ];

    act(() => {
      options.onSuccess({ id: 'tag-personal', name: 'Personal', color: 'gray' });
    });

    expect(updateNoteMutate).toHaveBeenCalledWith({ tagIds: ['tag-personal'] }, expect.anything());
    expect(screen.getByLabelText('Add a tag')).toHaveValue('');
  });

  it('shows an error toast for a non-409 createTag failure', async () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={[]} />);

    typeTagName('Personal');
    act(() => {
      screen.getByText('Create "Personal"').click();
    });

    const [, options] = createTagMutate.mock.calls[0] as [
      unknown,
      { onError: (error: unknown) => Promise<void> },
    ];

    await act(async () => {
      await options.onError(new ApiRequestError({ code: 'VALIDATION_FAILED', message: 'bad' }));
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('on a 409 TAG_NAME_DUPLICATE race, refetches tags and attaches the resolved tag without an error toast', async () => {
    const tagsData = mockTagsData();
    mockUseTagsQuery.mockReturnValue(tagsData as never);
    render(<TagCombobox noteId="note-1" attachedTagIds={[]} />);

    typeTagName('Urgent');
    act(() => {
      screen.getByText('Create "Urgent"').click();
    });

    const [, options] = createTagMutate.mock.calls[0] as [
      unknown,
      { onError: (error: unknown) => Promise<void> },
    ];
    const refetchedTags = [...EXISTING_TAGS, { id: 'tag-urgent', name: 'Urgent', color: 'red' as const, noteCount: 1 }];
    tagsData.refetch.mockResolvedValueOnce({
      data: { items: refetchedTags, page: 1, pageSize: 50, totalItems: refetchedTags.length, totalPages: 1 },
    });

    await act(async () => {
      await options.onError(new ApiRequestError({ code: 'TAG_NAME_DUPLICATE', message: 'dup' }));
    });

    expect(tagsData.refetch).toHaveBeenCalledTimes(1);
    expect(updateNoteMutate).toHaveBeenCalledWith({ tagIds: ['tag-urgent'] }, expect.anything());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('attaching a tag on an existing note fires an immediate updateNote call', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={['tag-home']} />);

    typeTagName('work');
    act(() => {
      screen.getByText('Create "work"').click();
    });

    expect(updateNoteMutate).toHaveBeenCalledWith(
      { tagIds: ['tag-home', 'tag-work'] },
      expect.anything(),
    );
  });

  it('attaching a tag on a new (id-less) note only updates local pendingTagIds state', () => {
    const onPendingTagIdsChange = vi.fn();
    render(<TagCombobox attachedTagIds={[]} onPendingTagIdsChange={onPendingTagIdsChange} />);

    typeTagName('work');
    act(() => {
      screen.getByText('Create "work"').click();
    });

    expect(updateNoteMutate).not.toHaveBeenCalled();
    expect(onPendingTagIdsChange).toHaveBeenCalledWith(['tag-work']);
  });

  it('removing an attached tag chip on an existing note fires an immediate updateNote excluding it', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={['tag-work', 'tag-home']} />);

    act(() => {
      screen.getByLabelText('Remove Work').click();
    });

    expect(updateNoteMutate).toHaveBeenCalledWith({ tagIds: ['tag-home'] }, expect.anything());
  });

  it('does not attach a tag that is already attached', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={['tag-work']} />);

    typeTagName('work');
    act(() => {
      screen.getByText('Create "work"').click();
    });

    expect(updateNoteMutate).not.toHaveBeenCalled();
  });

  it('submitting an empty/whitespace-only input is a no-op', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={[]} />);

    const input = screen.getByLabelText('Add a tag');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(createTagMutate).not.toHaveBeenCalled();
    expect(updateNoteMutate).not.toHaveBeenCalled();
  });

  it('shows an error toast when attaching a tag on an existing note fails', () => {
    render(<TagCombobox noteId="note-1" attachedTagIds={[]} />);

    typeTagName('work');
    act(() => {
      screen.getByText('Create "work"').click();
    });

    const [, options] = updateNoteMutate.mock.calls[0] as [
      unknown,
      { onError: (error: unknown) => void },
    ];

    act(() => {
      options.onError(new ApiRequestError({ code: 'NOTE_NOT_FOUND', message: 'gone' }));
    });

    expect(toast.error).toHaveBeenCalledTimes(1);
  });

  it('removing an attached tag chip on a new note only mutates local state', () => {
    const onPendingTagIdsChange = vi.fn();
    render(
      <TagCombobox
        attachedTagIds={['tag-work', 'tag-home']}
        onPendingTagIdsChange={onPendingTagIdsChange}
      />,
    );

    act(() => {
      screen.getByLabelText('Remove Work').click();
    });

    expect(updateNoteMutate).not.toHaveBeenCalled();
    expect(onPendingTagIdsChange).toHaveBeenCalledWith(['tag-home']);
  });
});
