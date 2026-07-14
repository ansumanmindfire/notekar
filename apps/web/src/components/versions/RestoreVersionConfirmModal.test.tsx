import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Note } from 'shared';
import { UI_COPY } from '../../lib/uiCopy';

// AB-1015 - RestoreVersionConfirmModal is the destructive-action confirmation
// modal for restoring a note to a historical version (FR-UI-4 / apps/web/CLAUDE.md
// §5): Cancel must be the default-focused element, Cancel must never trigger the
// mutation, and Restore must show a Loader2 spinner while the mutation is in flight.

vi.mock('../../lib/notesApi');

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { restoreVersion } from '../../lib/notesApi';
import { toast } from 'sonner';
import { RestoreVersionConfirmModal } from './RestoreVersionConfirmModal';

const mockRestoreVersion = vi.mocked(restoreVersion);
const mockToastError = vi.mocked(toast.error);

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'Restored title',
    body: { type: 'doc', content: [] },
    tagIds: [],
    version: 2,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function renderConfirmModal(
  overrides: { onOpenChange?: (open: boolean) => void; onRestored?: () => void } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onRestored = overrides.onRestored ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <RestoreVersionConfirmModal
        noteId="note-1"
        versionId="version-1"
        open
        onOpenChange={onOpenChange}
        onRestored={onRestored}
      />
    </QueryClientProvider>,
  );
  return { onOpenChange, onRestored };
}

describe('RestoreVersionConfirmModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the confirmation copy from UI_COPY.RESTORE_VERSION_CONFIRM', () => {
    renderConfirmModal();

    expect(screen.getByRole('heading', { name: UI_COPY.RESTORE_VERSION_CONFIRM.heading })).toBeInTheDocument();
    expect(screen.getByText(UI_COPY.RESTORE_VERSION_CONFIRM.body)).toBeInTheDocument();
  });

  it('focuses the Cancel button when the dialog opens', async () => {
    renderConfirmModal();

    const cancelButton = screen.getByRole('button', { name: UI_COPY.RESTORE_VERSION_CONFIRM.cancel });
    await waitFor(() => expect(document.activeElement).toBe(cancelButton));
  });

  it('calls onOpenChange(false) and never invokes the restore mutation when Cancel is clicked', () => {
    const { onOpenChange } = renderConfirmModal();

    fireEvent.click(screen.getByRole('button', { name: UI_COPY.RESTORE_VERSION_CONFIRM.cancel }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockRestoreVersion).not.toHaveBeenCalled();
  });

  it('calls the restore mutation with (noteId, versionId) and shows the Loader2 pending state while it is in flight', async () => {
    let resolveRestore!: (note: Note) => void;
    const pending = new Promise<Note>((resolve) => {
      resolveRestore = resolve;
    });
    mockRestoreVersion.mockReturnValueOnce(pending);
    const { onRestored } = renderConfirmModal();

    const confirmButton = screen.getByRole('button', { name: UI_COPY.RESTORE_VERSION_CONFIRM.confirm });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockRestoreVersion).toHaveBeenCalledTimes(1));
    expect(mockRestoreVersion).toHaveBeenCalledWith('note-1', 'version-1');

    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
      expect(confirmButton.querySelector('svg.animate-spin')).not.toBeNull();
    });

    resolveRestore(makeNote());

    await waitFor(() => expect(onRestored).toHaveBeenCalledTimes(1));
    expect(mockRestoreVersion).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast when the mutation rejects, without calling onRestored', async () => {
    mockRestoreVersion.mockRejectedValueOnce(new Error('boom'));
    const { onRestored } = renderConfirmModal();

    fireEvent.click(screen.getByRole('button', { name: UI_COPY.RESTORE_VERSION_CONFIRM.confirm }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(onRestored).not.toHaveBeenCalled();
  });
});
