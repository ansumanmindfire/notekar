import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UI_COPY } from '../../lib/uiCopy';

vi.mock('../../lib/notesApi');

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { revokeShareLink } from '../../lib/notesApi';
import { toast } from 'sonner';
import { RevokeShareLinkModal } from './RevokeShareLinkModal';

const mockRevokeShareLink = vi.mocked(revokeShareLink);
const mockToastError = vi.mocked(toast.error);

function renderConfirmModal(overrides: { onOpenChange?: (open: boolean) => void; onRevoked?: () => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onRevoked = overrides.onRevoked ?? vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <RevokeShareLinkModal noteId="note-1" token="token-123" open onOpenChange={onOpenChange} onRevoked={onRevoked} />
    </QueryClientProvider>,
  );
  return { onOpenChange, onRevoked };
}

describe('RevokeShareLinkModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the confirmation copy from UI_COPY.REVOKE_SHARE_CONFIRM', () => {
    renderConfirmModal();

    expect(screen.getByRole('heading', { name: UI_COPY.REVOKE_SHARE_CONFIRM.heading })).toBeInTheDocument();
    expect(screen.getByText(UI_COPY.REVOKE_SHARE_CONFIRM.body)).toBeInTheDocument();
  });

  it('focuses the Cancel button when the dialog opens', async () => {
    renderConfirmModal();

    const cancelButton = screen.getByRole('button', { name: UI_COPY.REVOKE_SHARE_CONFIRM.cancel });
    await waitFor(() => expect(document.activeElement).toBe(cancelButton));
  });

  it('calls onOpenChange(false) and never invokes the revoke mutation when Cancel is clicked', () => {
    const { onOpenChange } = renderConfirmModal();

    fireEvent.click(screen.getByRole('button', { name: UI_COPY.REVOKE_SHARE_CONFIRM.cancel }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockRevokeShareLink).not.toHaveBeenCalled();
  });

  it('calls the revoke mutation exactly once and shows the Loader2 pending state while it is in flight', async () => {
    let resolveRevoke!: () => void;
    const pending = new Promise<void>((resolve) => {
      resolveRevoke = resolve;
    });
    mockRevokeShareLink.mockReturnValueOnce(pending);
    const { onRevoked } = renderConfirmModal();

    const confirmButton = screen.getByRole('button', { name: UI_COPY.REVOKE_SHARE_CONFIRM.confirm });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(mockRevokeShareLink).toHaveBeenCalledTimes(1));
    expect(mockRevokeShareLink).toHaveBeenCalledWith('note-1', 'token-123');

    await waitFor(() => {
      expect(confirmButton).toBeDisabled();
      expect(confirmButton.querySelector('svg.animate-spin')).not.toBeNull();
    });

    resolveRevoke();

    await waitFor(() => expect(onRevoked).toHaveBeenCalledTimes(1));
    expect(mockRevokeShareLink).toHaveBeenCalledTimes(1);
  });

  it('shows an error toast when the mutation rejects, without calling onRevoked', async () => {
    mockRevokeShareLink.mockRejectedValueOnce(new Error('boom'));
    const { onRevoked } = renderConfirmModal();

    fireEvent.click(screen.getByRole('button', { name: UI_COPY.REVOKE_SHARE_CONFIRM.confirm }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledTimes(1));
    expect(onRevoked).not.toHaveBeenCalled();
  });
});
