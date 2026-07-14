import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Note } from 'shared';
import { UI_COPY } from '../../lib/uiCopy';

// AB-1011 task T28 - TrashPreviewModal renders straight from the `note` prop
// (already fetched by TrashListPage's trash-list query) with no truncation of
// the excerpt, unlike NoteCard/the trash row (see TrashListPage.tsx's
// ROW_EXCERPT_MAX_LENGTH truncate() call). It also owns opening
// RestoreConfirmModal, which is exercised here only far enough to prove the
// wiring - RestoreConfirmModal's own behavior is covered by
// RestoreConfirmModal.test.tsx.

vi.mock('../../lib/notesApi');

import { getNote, listNotes, listTags, listTrash, restoreNote } from '../../lib/notesApi';
import { TrashPreviewModal } from './TrashPreviewModal';

const mockListNotes = vi.mocked(listNotes);
const mockListTags = vi.mocked(listTags);
const mockListTrash = vi.mocked(listTrash);
const mockRestoreNote = vi.mocked(restoreNote);
const mockGetNote = vi.mocked(getNote);

const LONG_BODY_TEXT = 'a'.repeat(200);

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'A Trashed Note',
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: LONG_BODY_TEXT }],
        },
      ],
    },
    tagIds: [],
    version: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    deletedAt: '2026-06-02T12:00:00.000Z',
    ...overrides,
  };
}

function renderModal(note: Note | null, onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TrashPreviewModal note={note} onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe('TrashPreviewModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when note is null', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <TrashPreviewModal note={null} onOpenChange={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the note title and the FULL untruncated plain-text excerpt, with no network call for the note itself', () => {
    renderModal(makeNote());

    expect(screen.getByRole('heading', { name: 'A Trashed Note' })).toBeInTheDocument();
    // If this were truncated like NoteCard (160 chars) it would read
    // `${'a'.repeat(160)}…` instead - assert the full 200-char body is present.
    expect(screen.getByText(LONG_BODY_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(`${'a'.repeat(160)}…`)).not.toBeInTheDocument();

    expect(mockListNotes).not.toHaveBeenCalled();
    expect(mockListTags).not.toHaveBeenCalled();
    expect(mockListTrash).not.toHaveBeenCalled();
    expect(mockRestoreNote).not.toHaveBeenCalled();
    expect(mockGetNote).not.toHaveBeenCalled();
  });

  it('opens RestoreConfirmModal when "Restore" is clicked', () => {
    renderModal(makeNote());

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));

    expect(screen.getByRole('heading', { name: UI_COPY.RESTORE_CONFIRM.heading })).toBeInTheDocument();
    expect(screen.getByText(UI_COPY.RESTORE_CONFIRM.body)).toBeInTheDocument();
    // The preview dialog's own title should no longer be showing once the
    // confirm dialog has taken over (TrashPreviewModal's Dialog is `open={!isConfirmOpen}`).
    expect(screen.queryByRole('heading', { name: 'A Trashed Note' })).not.toBeInTheDocument();
  });
});
