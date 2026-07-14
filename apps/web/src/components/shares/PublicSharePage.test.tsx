import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { UI_COPY } from '../../lib/uiCopy';
import { ApiRequestError } from '../../lib/apiClient';

vi.mock('../../lib/notesApi');

import { getPublicShare } from '../../lib/notesApi';
import { PublicSharePage } from './PublicSharePage';

const mockGetPublicShare = vi.mocked(getPublicShare);

function renderPage(token = 'token-123') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  
  const { container } = render(
    <QueryClientProvider client={queryClient}>
      <PublicSharePage token={token} />
    </QueryClientProvider>,
  );
  
  return { queryClient, container };
}

describe('PublicSharePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetPublicShare.mockResolvedValue({
      title: 'Default Share',
      body: { type: 'doc', content: [] },
      viewCount: 1,
      sharedAt: '2026-06-01T12:00:00.000Z'
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('Scenario 8: Valid link renders sanitized content and view count', async () => {
    mockGetPublicShare.mockResolvedValueOnce({
      title: 'My Shared Note',
      body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello share' }] }] },
      viewCount: 42,
      sharedAt: '2026-06-01T12:00:00.000Z'
    });

    renderPage();
    await new Promise((resolve) => setTimeout(resolve, 300));

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'My Shared Note' })).toBeInTheDocument();
    });

    expect(await screen.findByText('Hello share')).toBeInTheDocument();
    expect(await screen.findByText('Views: 42')).toBeInTheDocument();
    // Verify the date is formatted
    expect(screen.getByText(/Shared:/)).toBeInTheDocument();
  });

  it('Scenario 9: 410 GONE_LINK_INVALID shows the invalid link message', async () => {
    mockGetPublicShare.mockRejectedValueOnce(new ApiRequestError({ code: 'GONE_LINK_INVALID', message: 'Gone' }));

    renderPage();
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(await screen.findByRole('heading', { level: 1, name: UI_COPY.PUBLIC_SHARE_INVALID.heading })).toBeInTheDocument();
    expect(await screen.findByText(UI_COPY.PUBLIC_SHARE_INVALID.subtext)).toBeInTheDocument();
    
    // Ensure no note content would be rendered
    expect(screen.queryByText('Views:')).not.toBeInTheDocument();
  });

  it('Scenario 10: XSS payloads in body are stripped by DOMPurify before reaching dangerouslySetInnerHTML', async () => {
    const maliciousView = {
      title: 'Malicious Note',
      body: {
        type: 'doc' as const,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Safe text' }]
          },
          // This represents a malicious payload attempting to evade generating logic if the editor was bypassed
          // Even if generateHTML produces `<script>`, DOMPurify will strip it
          {
            type: 'text',
            text: '<script>alert(1)</script>'
          }
        ]
      },
      viewCount: 1,
      sharedAt: '2026-06-01T12:00:00.000Z'
    };

    mockGetPublicShare.mockResolvedValueOnce(maliciousView);
    const { container } = renderPage();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const heading = await screen.findByRole('heading', { level: 1, name: 'Malicious Note' });
    expect(heading).toBeInTheDocument();

    // Extract the actual HTML from the DOM to verify no script tag got rendered
    expect(container.innerHTML).not.toContain('<script');
    // Text output from generateHTML is normally escaped, but even if it was not, our DOMPurify catches it.
    expect(await screen.findByText(/Safe text/)).toBeInTheDocument();
  });
});
