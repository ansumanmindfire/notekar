import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutosaveStatusPill } from './AutosaveStatusPill';
import { useEditorStatusStore } from '../../stores/editorStatusStore';

describe('AutosaveStatusPill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStatusStore.setState({ status: 'idle' });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
    useEditorStatusStore.setState({ status: 'idle' });
  });

  it('renders nothing when idle', () => {
    const { container } = render(<AutosaveStatusPill onRetry={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the saving copy while saving', () => {
    useEditorStatusStore.setState({ status: 'saving' });
    render(<AutosaveStatusPill onRetry={vi.fn()} />);
    expect(screen.getByText('Syncing changes...')).toBeInTheDocument();
  });

  it('shows the saved copy and auto-hides after 2 seconds', () => {
    useEditorStatusStore.setState({ status: 'saved' });
    render(<AutosaveStatusPill onRetry={vi.fn()} />);
    expect(screen.getByText('All changes saved')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.queryByText('All changes saved')).not.toBeInTheDocument();
  });

  it('shows the error copy with a retry button that calls the provided callback', () => {
    useEditorStatusStore.setState({ status: 'error' });
    const onRetry = vi.fn();
    render(<AutosaveStatusPill onRetry={onRetry} />);

    expect(screen.getByText('Sync failed — Retrying...')).toBeInTheDocument();

    act(() => {
      screen.getByLabelText('Retry saving').click();
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
