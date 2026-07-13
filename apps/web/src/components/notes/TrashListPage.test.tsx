import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Note, Page } from 'shared';
import { UI_COPY } from '../../lib/uiCopy';
import { ApiRequestError } from '../../lib/apiClient';
import { getErrorMessage } from '../../lib/errorMessages';

// AB-1011 task T34 - TrashListPage renders a read-only list of soft-deleted
// notes (no edit/delete affordances - only restore, via TrashPreviewModal ->
// RestoreConfirmModal), reuses the already-fetched row data for the preview
// (no extra per-note fetch), and must gracefully surface + recover from the
// "already-purged/restored elsewhere" 404 race on restore (NOTE_NOT_FOUND).
//
// NOTE on timing: useMinLoadingTime.ts holds the skeleton for a minimum of
// 200ms (MIN_LOADING_MS) *after* data has already arrived, via a passive
// effect that fires one commit after the "loaded" render. That means there is
// a genuine one-commit window where the real content is briefly visible
// before the hook's effect flips back to the skeleton for the remainder of
// the 200ms hold - a real (if imperceptible at 60fps) flicker bug, not a test
// artifact. `settleMinLoadingTime()` waits past that whole hold-then-reveal
// cycle with a real timer so assertions observe the final, stable DOM.
const MIN_LOADING_SETTLE_MS = 300;

async function settleMinLoadingTime() {
  await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_SETTLE_MS));
}

vi.mock('../../lib/notesApi', () => ({
  listNotes: vi.fn(),
  listTags: vi.fn(),
  listTrash: vi.fn(),
  restoreNote: vi.fn(),
  getNote: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { getNote, listTrash, restoreNote } from '../../lib/notesApi';
import { toast } from 'sonner';
import { TrashListPage } from './TrashListPage';

const mockListTrash = vi.mocked(listTrash);
const mockRestoreNote = vi.mocked(restoreNote);
const mockGetNote = vi.mocked(getNote);
const mockToastError = vi.mocked(toast.error);

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'A Trashed Note',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b'.repeat(150) }] }],
    },
    tagIds: [],
    version: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    deletedAt: '2026-06-02T12:00:00.000Z',
    ...overrides,
  };
}

function makeTrashPage(overrides: Partial<Page<Note>> = {}): Page<Note> {
  return {
    items: [],
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0,
    ...overrides,
  };
}

async function renderTrashListPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <TrashListPage />
    </QueryClientProvider>,
  );
  await settleMinLoadingTime();
  return { queryClient };
}

describe('TrashListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the empty-trash state when totalItems is 0', async () => {
    mockListTrash.mockResolvedValue(makeTrashPage());

    await renderTrashListPage();

    expect(screen.getByRole('heading', { name: UI_COPY.EMPTY_TRASH_BIN.heading })).toBeInTheDocument();
  });

  it('renders trash rows with no edit/delete affordances - just the read-only row', async () => {
    mockListTrash.mockResolvedValue(
      makeTrashPage({
        items: [
          makeNote({
            id: 'note-1',
            title: 'First Trashed',
            body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a'.repeat(150) }] }] },
          }),
          makeNote({
            id: 'note-2',
            title: 'Second Trashed',
            body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b'.repeat(150) }] }] },
          }),
        ],
        totalItems: 2,
        totalPages: 1,
      }),
    );

    await renderTrashListPage();

    expect(screen.getByText('First Trashed')).toBeInTheDocument();
    expect(screen.getByText('Second Trashed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
    // The row's truncated excerpt (120 chars) should be visible, distinct from
    // the full untruncated excerpt TrashPreviewModal shows once opened.
    expect(screen.getByText(`${'a'.repeat(120)}…`)).toBeInTheDocument();
    expect(screen.getByText(`${'b'.repeat(120)}…`)).toBeInTheDocument();
  });

  it("clicking a row opens TrashPreviewModal populated from that row's already-fetched data, with no extra network call", async () => {
    mockListTrash.mockResolvedValue(
      makeTrashPage({ items: [makeNote({ title: 'First Trashed' })], totalItems: 1, totalPages: 1 }),
    );

    await renderTrashListPage();
    const callsBeforeClick = mockListTrash.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /First Trashed/ }));

    await waitFor(() => {
      expect(screen.getByText('b'.repeat(150))).toBeInTheDocument();
    });
    expect(mockListTrash.mock.calls.length).toBe(callsBeforeClick);
    expect(mockGetNote).not.toHaveBeenCalled();
  });

  it('completes the full restore flow: preview -> confirm -> mutation success -> preview closes', async () => {
    mockListTrash.mockResolvedValue(
      makeTrashPage({ items: [makeNote({ id: 'note-1', title: 'First Trashed' })], totalItems: 1, totalPages: 1 }),
    );
    mockRestoreNote.mockResolvedValueOnce(makeNote({ id: 'note-1', deletedAt: null }));

    await renderTrashListPage();

    fireEvent.click(screen.getByRole('button', { name: /First Trashed/ }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'First Trashed' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: UI_COPY.RESTORE_CONFIRM.heading })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: UI_COPY.RESTORE_CONFIRM.confirm }));

    await waitFor(() => {
      expect(mockRestoreNote).toHaveBeenCalledWith('note-1');
    });
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: UI_COPY.RESTORE_CONFIRM.heading })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('heading', { name: 'First Trashed' })).not.toBeInTheDocument();
  });

  it('shows an error toast and refetches the trash list when restore rejects with a 404 NOTE_NOT_FOUND race', async () => {
    mockListTrash.mockResolvedValue(
      makeTrashPage({ items: [makeNote({ id: 'note-1', title: 'First Trashed' })], totalItems: 1, totalPages: 1 }),
    );
    mockRestoreNote.mockRejectedValueOnce(new ApiRequestError({ code: 'NOTE_NOT_FOUND', message: 'Not found' }));

    await renderTrashListPage();
    const callsBeforeRestore = mockListTrash.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: /First Trashed/ }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: UI_COPY.RESTORE_CONFIRM.confirm })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: UI_COPY.RESTORE_CONFIRM.confirm }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(getErrorMessage('NOTE_NOT_FOUND'));
    });
    // useRestoreNoteMutation's onSettled invalidates the ["notes"] prefix regardless
    // of success/failure, so the (now-stale) trash query refetches - the row would
    // disappear once the server confirms it is already gone.
    await waitFor(() => {
      expect(mockListTrash.mock.calls.length).toBeGreaterThan(callsBeforeRestore);
    });
  });
});
