import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UI_COPY } from '../../lib/uiCopy';

const navigateMock = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('../../lib/notesApi');

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { deleteNote } from '../../lib/notesApi';
import { toast } from 'sonner';
import { DeleteNoteModal } from './DeleteNoteModal';

const mockDeleteNote = vi.mocked(deleteNote);
const mockToastError = vi.mocked(toast.error);

function renderModal(onOpenChange = vi.fn()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <DeleteNoteModal noteId="note-1" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe('DeleteNoteModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the confirmation copy from UI_COPY.DELETE_NOTE_CONFIRM', () => {
    renderModal();

    expect(screen.getByRole('heading', { name: UI_COPY.DELETE_NOTE_CONFIRM.heading })).toBeInTheDocument();
    expect(screen.getByText(UI_COPY.DELETE_NOTE_CONFIRM.body)).toBeInTheDocument();
  });

  it('calls onOpenChange(false) and never invokes deleteNote when Cancel is clicked', () => {
    const { onOpenChange } = renderModal();

    fireEvent.click(screen.getByRole('button', { name: UI_COPY.DELETE_NOTE_CONFIRM.cancel }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockDeleteNote).not.toHaveBeenCalled();
  });

  it('shows the Loader2 pending state on the confirm button while the mutation is in flight', async () => {
    let resolveDelete!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    mockDeleteNote.mockReturnValueOnce(pending);
    renderModal();

    const confirmButton = screen.getByRole('button', { name: UI_COPY.DELETE_NOTE_CONFIRM.confirm });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
      expect(confirmButton.querySelector('svg.animate-spin')).not.toBeNull();
    });

    resolveDelete();
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/notes' }));
  });

  it('calls deleteNote once and navigates to /notes on confirm success', async () => {
    mockDeleteNote.mockResolvedValueOnce(undefined);
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: UI_COPY.DELETE_NOTE_CONFIRM.confirm }));

    await waitFor(() => expect(mockDeleteNote).toHaveBeenCalledTimes(1));
    expect(mockDeleteNote).toHaveBeenCalledWith('note-1');
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/notes' }));
  });

  it('shows an error toast and does not navigate when deleteNote rejects', async () => {
    mockDeleteNote.mockRejectedValueOnce(new Error('boom'));
    renderModal();

    fireEvent.click(screen.getByRole('button', { name: UI_COPY.DELETE_NOTE_CONFIRM.confirm }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
