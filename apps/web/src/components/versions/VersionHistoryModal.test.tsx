import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NoteVersionDetail, NoteVersionSummary } from 'shared';
import { UI_COPY } from '../../lib/uiCopy';

vi.mock('../../lib/notesApi');

import { listVersions, getVersionDetail } from '../../lib/notesApi';
import { VersionHistoryModal } from './VersionHistoryModal';

const mockListVersions = vi.mocked(listVersions);
const mockGetVersionDetail = vi.mocked(getVersionDetail);

function makeSummary(overrides: Partial<NoteVersionSummary> = {}): NoteVersionSummary {
  return {
    id: 'version-1',
    version: 2,
    title: 'An older title',
    savedAt: '2026-06-01T12:00:00.000Z',
    ...overrides,
  };
}

function makeDetail(overrides: Partial<NoteVersionDetail> = {}): NoteVersionDetail {
  return {
    id: 'version-1',
    version: 2,
    title: 'An older title',
    savedAt: '2026-06-01T12:00:00.000Z',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old body text' }] }] },
    ...overrides,
  };
}

function renderModal(overrides: { onOpenChange?: (open: boolean) => void } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenChange = overrides.onOpenChange ?? vi.fn();

  const { container, rerender } = render(
    <QueryClientProvider client={queryClient}>
      <VersionHistoryModal
        noteId="note-1"
        currentTitle="Current title"
        currentBody={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Current body text' }] }] }}
        open
        onOpenChange={onOpenChange}
      />
    </QueryClientProvider>,
  );

  return { onOpenChange, queryClient, container, rerender };
}

describe('VersionHistoryModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('Scenario 1: opens with the version list newest-first and nothing preselected', async () => {
    mockListVersions.mockResolvedValueOnce([
      makeSummary({ id: 'version-2', version: 3, savedAt: '2026-06-03T12:00:00.000Z' }),
      makeSummary({ id: 'version-1', version: 2, savedAt: '2026-06-01T12:00:00.000Z' }),
    ]);

    renderModal();

    expect(screen.getByRole('heading', { name: UI_COPY.VERSION_HISTORY.heading })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Version 3')).toBeInTheDocument());
    expect(screen.getByText('Version 2')).toBeInTheDocument();
    expect(mockGetVersionDetail).not.toHaveBeenCalled();
    expect(screen.queryByText(UI_COPY.VERSION_HISTORY.restoreButton)).not.toBeInTheDocument();
  });

  it('Scenario 2: a note with zero historical versions shows the empty state and no restore control', async () => {
    mockListVersions.mockResolvedValueOnce([]);

    renderModal();

    await waitFor(() => expect(screen.getByText(UI_COPY.VERSION_HISTORY.emptyState)).toBeInTheDocument());
    expect(screen.queryByText(UI_COPY.VERSION_HISTORY.restoreButton)).not.toBeInTheDocument();
  });

  it('Scenario 3: selecting a version fetches its detail and renders both sanitized panes', async () => {
    mockListVersions.mockResolvedValueOnce([makeSummary()]);
    mockGetVersionDetail.mockResolvedValueOnce(makeDetail());

    renderModal();

    await waitFor(() => expect(screen.getByText('Version 2')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Version 2'));

    await waitFor(() => expect(mockGetVersionDetail).toHaveBeenCalledWith('note-1', 'version-1'));
    expect(await screen.findByText('Current body text')).toBeInTheDocument();
    expect(await screen.findByText('Old body text')).toBeInTheDocument();
    expect(screen.getByText(UI_COPY.VERSION_HISTORY.restoreButton)).toBeInTheDocument();
  });

  it('Scenario 8: a malicious version body is stripped before reaching dangerouslySetInnerHTML', async () => {
    mockListVersions.mockResolvedValueOnce([makeSummary()]);
    mockGetVersionDetail.mockResolvedValueOnce(
      makeDetail({
        body: {
          type: 'doc',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Safe old text' }] },
            { type: 'text', text: '<script>alert(1)</script>' },
          ],
        },
      }),
    );

    const { container } = renderModal();

    await waitFor(() => expect(screen.getByText('Version 2')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Version 2'));

    expect(await screen.findByText(/Safe old text/)).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('<script');
    expect(container.innerHTML).not.toContain('alert(1)');
  });

  it('Scenario 9: closing without restoring sends no request, and reopening resets the selection', async () => {
    mockListVersions.mockResolvedValue([makeSummary()]);
    mockGetVersionDetail.mockResolvedValueOnce(makeDetail());

    const onOpenChange = vi.fn();
    const { rerender, queryClient } = renderModal({ onOpenChange });

    await waitFor(() => expect(screen.getByText('Version 2')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Version 2'));
    await waitFor(() => expect(mockGetVersionDetail).toHaveBeenCalledTimes(1));

    // Close the dialog (Escape triggers Radix's onOpenChange(false))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

    // Reopen: selection must have reset, so no new detail request fires until re-selected
    rerender(
      <QueryClientProvider client={queryClient}>
        <VersionHistoryModal
          noteId="note-1"
          currentTitle="Current title"
          currentBody={{ type: 'doc', content: [] }}
          open
          onOpenChange={onOpenChange}
        />
      </QueryClientProvider>,
    );

    expect(screen.queryByText(UI_COPY.VERSION_HISTORY.restoreButton)).not.toBeInTheDocument();
    expect(mockGetVersionDetail).toHaveBeenCalledTimes(1);
  });

  it('Scenario 10: version list/detail load the same way regardless of what trash state the parent note is in', async () => {
    // VersionHistoryModal has no deletedAt prop at all - it only ever receives
    // noteId/currentTitle/currentBody, so a note that's currently soft-deleted
    // (per FR-VER-1, history stays accessible during the 30-day window) behaves
    // identically to an active one from this component's perspective.
    mockListVersions.mockResolvedValueOnce([makeSummary()]);
    mockGetVersionDetail.mockResolvedValueOnce(makeDetail());

    renderModal();

    await waitFor(() => expect(screen.getByText('Version 2')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Version 2'));

    await waitFor(() => expect(mockGetVersionDetail).toHaveBeenCalledWith('note-1', 'version-1'));
    expect(await screen.findByText('Old body text')).toBeInTheDocument();
  });
});
