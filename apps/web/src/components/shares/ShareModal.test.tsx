import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UI_COPY } from '../../lib/uiCopy';
import type { ShareLink } from 'shared';

vi.mock('../../lib/notesApi');

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import { listShareLinks, createShareLink } from '../../lib/notesApi';
import { toast } from 'sonner';
import { ShareModal } from './ShareModal';

const mockListShareLinks = vi.mocked(listShareLinks);
const mockCreateShareLink = vi.mocked(createShareLink);

function renderModal(overrides: { onOpenChange?: (open: boolean) => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  
  render(
    <QueryClientProvider client={queryClient}>
      <ShareModal noteId="note-1" open onOpenChange={onOpenChange} />
    </QueryClientProvider>,
  );
  
  return { onOpenChange, queryClient };
}

describe('ShareModal', () => {
  let user: ReturnType<typeof userEvent.setup>;
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    user = userEvent.setup();
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWriteText }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('Scenario 1 & 11: Opens and renders empty state without crashing when list is empty', async () => {
    let resolveList!: (l: ShareLink[]) => void;
    const pending = new Promise<ShareLink[]>((res) => { resolveList = res; });
    mockListShareLinks.mockReturnValueOnce(pending);

    renderModal();
    
    // Shows loader initially
    expect(screen.getByRole('heading', { name: UI_COPY.SHARE_MODAL.heading })).toBeInTheDocument();
    
    resolveList([]);

    await waitFor(() => {
      expect(screen.getByText(UI_COPY.SHARE_MODAL.emptyState)).toBeInTheDocument();
    });
    
    expect(mockListShareLinks).toHaveBeenCalledWith('note-1');
  });

  it('Scenario 2: Create with no days sends no expiresAt', async () => {
    mockListShareLinks.mockResolvedValueOnce([]);
    mockCreateShareLink.mockResolvedValueOnce({ shareUrl: 'http', expiresAt: null, token: '1' } as never);
    
    renderModal();
    await waitFor(() => expect(screen.getByText(UI_COPY.SHARE_MODAL.emptyState)).toBeInTheDocument());

    const createBtn = screen.getByRole('button', { name: UI_COPY.SHARE_MODAL.createLinkButton });
    await user.click(createBtn);

    await waitFor(() => expect(mockCreateShareLink).toHaveBeenCalledTimes(1));
    expect(mockCreateShareLink).toHaveBeenCalledWith('note-1', { days: undefined });
  });

  it('Scenario 3: Create with days=14 sends the days correctly', async () => {
    mockListShareLinks.mockResolvedValueOnce([]);
    mockCreateShareLink.mockResolvedValueOnce({ shareUrl: 'http', expiresAt: '2027', token: '1' } as never);
    
    renderModal();
    await waitFor(() => expect(screen.getByText(UI_COPY.SHARE_MODAL.emptyState)).toBeInTheDocument());

    const input = screen.getByLabelText(UI_COPY.SHARE_MODAL.createLinkLabel);
    await user.type(input, '14');

    const createBtn = screen.getByRole('button', { name: UI_COPY.SHARE_MODAL.createLinkButton });
    await user.click(createBtn);

    await waitFor(() => expect(mockCreateShareLink).toHaveBeenCalledTimes(1));
    expect(mockCreateShareLink).toHaveBeenCalledWith('note-1', { days: 14 });
    
    // Input is cleared on success
    await waitFor(() => expect(input).toHaveValue(null));
  });

  it('Scenario 4: Boundary cases - browser validation intercepts out of bounds before submit', async () => {
    mockListShareLinks.mockResolvedValueOnce([]);
    
    renderModal();
    await waitFor(() => expect(screen.getByText(UI_COPY.SHARE_MODAL.emptyState)).toBeInTheDocument());

    const input = screen.getByLabelText(UI_COPY.SHARE_MODAL.createLinkLabel);
    const form = input.closest('form')!;
    
    // Setup form submit listener to see if it dispatches
    form.addEventListener('submit', (e) => {
      e.preventDefault();
    });

    const createBtn = screen.getByRole('button', { name: UI_COPY.SHARE_MODAL.createLinkButton });
    
    // We type 0, because it's < min="1" it should be caught by our manual validation or native
    await user.type(input, '0');
    await user.click(createBtn);
    expect(mockCreateShareLink).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, '31');
    await user.click(createBtn);
    expect(mockCreateShareLink).not.toHaveBeenCalled();
    
    await user.clear(input);
    await user.type(input, '1');
    mockCreateShareLink.mockResolvedValueOnce({ shareUrl: 'http', expiresAt: '2027', token: '1' } as never);
    await user.click(createBtn);
    await waitFor(() => expect(mockCreateShareLink).toHaveBeenCalledWith('note-1', { days: 1 }));
    
    await user.clear(input);
    await user.type(input, '30');
    mockCreateShareLink.mockResolvedValueOnce({ shareUrl: 'http', expiresAt: '2027', token: '1' } as never);
    await user.click(createBtn);
    await waitFor(() => expect(mockCreateShareLink).toHaveBeenCalledWith('note-1', { days: 30 }));
  });

  it('Scenario 5: Copy button uses navigator.clipboard', async () => {
    mockListShareLinks.mockResolvedValueOnce([{
      token: 'token-abc',
      shareUrl: 'https://example.com/shares/token-abc',
      viewCount: 0,
      createdAt: '2026',
      expiresAt: null,
      revokedAt: null
    }]);
    
    renderModal();
    await waitFor(() => expect(screen.getByText('https://example.com/shares/token-abc')).toBeInTheDocument());

    const copyBtn = screen.getByRole('button', { name: /Copy/i });
    await user.click(copyBtn);

    expect(clipboardWriteText).toHaveBeenCalledWith('https://example.com/shares/token-abc');
    expect(toast.success).toHaveBeenCalledWith(UI_COPY.SHARE_LINK_COPIED);
  });

  it('Scenario 7: Two simultaneous links render and are manageable', async () => {
    mockListShareLinks.mockResolvedValueOnce([
      {
        token: 'token-1',
        shareUrl: 'https://example.com/shares/token-1',
        viewCount: 1,
        createdAt: '2026',
        expiresAt: null,
        revokedAt: null
      },
      {
        token: 'token-2',
        shareUrl: 'https://example.com/shares/token-2',
        viewCount: 5,
        createdAt: '2026',
        expiresAt: null,
        revokedAt: null
      }
    ]);
    
    renderModal();
    await waitFor(() => expect(screen.getByText('https://example.com/shares/token-1')).toBeInTheDocument());
    expect(screen.getByText('https://example.com/shares/token-2')).toBeInTheDocument();

    const revokeButtons = screen.getAllByRole('button', { name: /Revoke/i });
    expect(revokeButtons).toHaveLength(2);
    
    // Clicking one opens the nested modal for it
    await user.click(revokeButtons[0]);
    expect(screen.getByRole('heading', { name: UI_COPY.REVOKE_SHARE_CONFIRM.heading })).toBeInTheDocument();
  });
});
