import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Note } from 'shared';
import { NoteEditorPage } from './NoteEditorPage';
import { ApiRequestError } from '../../lib/apiClient';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

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
  TagCombobox: () => <div data-testid="tag-combobox" />,
}));

vi.mock('./DeleteNoteModal', () => ({
  DeleteNoteModal: ({ open }: { open: boolean }) => (open ? <div data-testid="delete-modal" /> : null),
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

describe('NoteEditorPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('mode="new" navigates to the new note\'s route once useAutosave reports a successful create', () => {
    render(<NoteEditorPage mode="new" />);

    // useAutosave itself is mocked (its own creation flow is covered by
    // useAutosave.test.ts); this exercises NoteEditorPage's onCreated wiring.
    const call = vi.mocked(useAutosave).mock.calls[0][0] as { onCreated: (note: Note) => void };
    call.onCreated(makeNote({ id: 'new-note-1' }));

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/notes/$noteId',
      params: { noteId: 'new-note-1' },
      replace: true,
    });
  });

  it('mode="new" renders an empty title input and no Delete button', () => {
    render(<NoteEditorPage mode="new" />);

    expect(screen.getByLabelText('Title')).toHaveValue('');
    expect(screen.queryByLabelText('Delete note')).not.toBeInTheDocument();
  });

  it('mode="new" shows an inline validation error when the title is cleared and blurred', () => {
    render(<NoteEditorPage mode="new" />);

    const titleInput = screen.getByLabelText('Title');
    fireEvent.change(titleInput, { target: { value: 'Hello' } });
    fireEvent.change(titleInput, { target: { value: '' } });
    fireEvent.blur(titleInput);

    expect(screen.getByText('Title is required')).toBeInTheDocument();
  });

  it('mode="existing" shows a loading skeleton while the note query is pending', () => {
    mockUseNoteQuery.mockReturnValue({ isPending: true, isError: false, data: undefined } as never);

    render(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('mode="existing" seeds the title input from the loaded note', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeNote({ title: 'Loaded Title' }),
    } as never);

    render(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.getByLabelText('Title')).toHaveValue('Loaded Title');
  });

  it('mode="existing" renders the Delete button', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: false,
      data: makeNote(),
    } as never);

    render(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.getByLabelText('Delete note')).toBeInTheDocument();
  });

  it('mode="existing" renders the full-page 404 error state with a "Return to Active Notes" action', () => {
    mockUseNoteQuery.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiRequestError({ code: 'NOTE_NOT_FOUND', message: 'not found' }),
      data: undefined,
    } as never);

    render(<NoteEditorPage mode="existing" noteId="note-1" />);

    expect(screen.getByText('This note could not be found.')).toBeInTheDocument();
    const returnButton = screen.getByRole('button', { name: 'Return to Active Notes' });
    fireEvent.click(returnButton);
    expect(navigateMock).toHaveBeenCalledWith({ to: '/notes' });
  });
});
