import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { Note } from 'shared';
import { NoteEditorPage } from './NoteEditorPage';
import { ApiRequestError } from '../../lib/apiClient';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../hooks/useAutosave', () => ({
  useAutosave: vi.fn(() => ({ retry: vi.fn() })),
}));

vi.mock('../../lib/notesQueries', () => ({
  useNoteQuery: vi.fn(),
}));

vi.mock('./NoteEditor', () => ({
  NoteEditor: () => <div data-testid="note-editor" />,
}));

vi.mock('./EditorToolbar', () => ({
  EditorToolbar: () => <div data-testid="editor-toolbar" />,
}));

vi.mock('./TagCombobox', () => ({
  TagCombobox: ({ attachedTagIds }: { attachedTagIds: string[] }) => (
    <div data-testid="tag-combobox" data-tag-ids={attachedTagIds.join(',')} />
  ),
}));

vi.mock('./DeleteNoteModal', () => ({
  DeleteNoteModal: ({ open }: { open: boolean }) => (open ? <div data-testid="delete-modal" /> : null),
}));

vi.mock('../shares/ShareModal', () => ({
  ShareModal: ({ open }: { open: boolean }) => (open ? <div data-testid="share-modal" /> : null),
}));

vi.mock('../versions/VersionHistoryModal', () => ({
  VersionHistoryModal: ({ open }: { open: boolean }) => (open ? <div data-testid="version-history-modal" /> : null),
}));

vi.mock('./AutosaveStatusPill', () => ({
  AutosaveStatusPill: () => <div data-testid="autosave-pill" />,
}));

import { useNoteQuery } from '../../lib/notesQueries';
import { useAutosave } from '../../hooks/useAutosave';

const mockUseNoteQuery = vi.mocked(useNoteQuery);

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Existing Note',
    body: { type: 'doc', content: [] },
    tagIds: [],
    version: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function renderWithRouter(ui: React.ReactNode) {
  const rootRoute = createRootRoute({ 
    component: () => (
      <QueryClientProvider client={queryClient}>
        {ui}
      </QueryClientProvider>
    ) 
  });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/' });
  const routeTree = rootRoute.addChildren([indexRoute]);
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: ['/'] }) });
  
  return render(<RouterProvider router={router} />);
}

describe('NoteEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('mode="new" navigates to the new note\'s route once useAutosave reports a successful create', () => {
    renderWithRouter(<NoteEditorPage mode="new" />);

    // useAutosave itself is mocked (its own creation flow is covered by
    // useAutosave.test.ts); this exercises NoteEditorPage's onCreated wiring.
    const call = vi.mocked(useAutosave).mock.calls[0]![0] as { onCreated: (note: Note) => void };
    call.onCreated(makeNote({ id: 'new-note-1' }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/notes/$noteId',
      params: { noteId: 'new-note-1' },
      replace: true,
    });
  });

  it('mode="new" renders an empty title input and no Delete button', () => {
    renderWithRouter(<NoteEditorPage mode="new" />);

    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.queryByLabelText('Delete note')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Share note')).not.toBeInTheDocument();
  });

  it('mode="new" shows an inline validation error when the title is cleared and blurred', () => {
    renderWithRouter(<NoteEditorPage mode="new" />);

    const titleInput = screen.getByLabelText('Title');
    fireEvent.change(titleInput, { target: { value: 'Hello' } });
    fireEvent.change(titleInput, { target: { value: '' } });
    fireEvent.blur(titleInput);

    expect(screen.getByText('Title is required')).toBeInTheDocument();
  });

  it('mode="existing" shows a loading skeleton while the note query is pending', () => {
    mockUseNoteQuery.mockReturnValue({ isPending: true, isError: false, data: undefined } as never);

    renderWithRouter(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('mode="existing" seeds the title input from the loaded note', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeNote({ title: 'Loaded Title' }),
    } as never);

    renderWithRouter(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.getByLabelText('Title')).toHaveValue('Loaded Title');
  });

  it('mode="existing" renders the Delete button', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeNote(),
    } as never);

    renderWithRouter(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.getByLabelText('Delete note')).toBeInTheDocument();
  });

  it('mode="existing" renders the Share button, and clicking it opens the ShareModal', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeNote(),
    } as never);

    renderWithRouter(<NoteEditorPage mode="existing" noteId="note-1" />);

    const shareBtn = screen.getByLabelText('Share note');
    expect(shareBtn).toBeInTheDocument();

    expect(screen.queryByTestId('share-modal')).not.toBeInTheDocument();
    fireEvent.click(shareBtn);
    expect(screen.getByTestId('share-modal')).toBeInTheDocument();
  });

  it('mode="existing" renders the History button, and clicking it opens the VersionHistoryModal', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeNote(),
    } as never);

    renderWithRouter(<NoteEditorPage mode="existing" noteId="note-1" />);

    const historyBtn = screen.getByLabelText('Version history');
    expect(historyBtn).toBeInTheDocument();

    expect(screen.queryByTestId('version-history-modal')).not.toBeInTheDocument();
    fireEvent.click(historyBtn);
    expect(screen.getByTestId('version-history-modal')).toBeInTheDocument();
  });

  it('mode="new" renders no History button', () => {
    renderWithRouter(<NoteEditorPage mode="new" />);

    expect(screen.queryByLabelText('Version history')).not.toBeInTheDocument();
  });

  it('remounts EditorBody (resetting the title input to the freshly-loaded value) when noteQuery.data.version changes, e.g. after a version restore', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeNote({ version: 1, title: 'Original title', tagIds: ['tag-a'] }),
    } as never);

    const { rerender } = render(<NoteEditorPage mode="existing" noteId="note-1" />);
    expect(screen.getByLabelText('Title')).toHaveValue('Original title');
    expect(screen.getByTestId('tag-combobox')).toHaveAttribute('data-tag-ids', 'tag-a');

    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeNote({ version: 2, title: 'Restored title', tagIds: ['tag-a'] }),
    } as never);
    rerender(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.getByLabelText('Title')).toHaveValue('Restored title');
    // Tags are current-state metadata, unaffected by the version-triggered remount (FR-VER-2).
    expect(screen.getByTestId('tag-combobox')).toHaveAttribute('data-tag-ids', 'tag-a');
  });

  it('mode="existing" renders the full-page 404 error state with a "Return to Active Notes" action', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiRequestError({ code: 'NOTE_NOT_FOUND', message: 'not found' }),
      data: undefined,
    } as never);

    renderWithRouter(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.getByText('This note could not be found.')).toBeInTheDocument();
    const returnButton = screen.getByRole('button', { name: 'Return to Active Notes' });
    fireEvent.click(returnButton);
    expect(navigateMock).toHaveBeenCalledWith({ to: '/notes' });
  });
});
