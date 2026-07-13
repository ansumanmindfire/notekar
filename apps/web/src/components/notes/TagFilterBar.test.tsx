import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { TagWithCount } from 'shared';
import { useNotesViewStore } from '../../stores/notesViewStore';
import { TagFilterBar } from './TagFilterBar';

const INITIAL_STATE = {
  sort: 'createdAt:desc' as const,
  tagIds: [] as string[],
  page: 1,
};

function resetStore() {
  useNotesViewStore.setState(
    {
      ...INITIAL_STATE,
      setSort: useNotesViewStore.getState().setSort,
      toggleTag: useNotesViewStore.getState().toggleTag,
      clearTagFilter: useNotesViewStore.getState().clearTagFilter,
      setPage: useNotesViewStore.getState().setPage,
    },
    true,
  );
}

function makeTags(): TagWithCount[] {
  return [
    { id: 'tag-1', name: 'Work', color: 'blue', noteCount: 3 },
    { id: 'tag-2', name: 'Personal', color: 'green', noteCount: 1 },
  ];
}

describe('TagFilterBar', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders nothing when the tags prop is empty', () => {
    const { container } = render(<TagFilterBar tags={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders a chip per tag', () => {
    render(<TagFilterBar tags={makeTags()} />);

    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Personal' })).toBeInTheDocument();
  });

  it('clicking a tag chip calls toggleTag with that tag\'s id', () => {
    render(<TagFilterBar tags={makeTags()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));

    expect(useNotesViewStore.getState().tagIds).toEqual(['tag-1']);
  });

  it('does not render "Clear filters" when no tags are selected', () => {
    render(<TagFilterBar tags={makeTags()} />);

    expect(screen.queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument();
  });

  it('renders "Clear filters" when tagIds is non-empty, and clicking it calls clearTagFilter', () => {
    useNotesViewStore.setState({ tagIds: ['tag-1'] });
    render(<TagFilterBar tags={makeTags()} />);

    const clearButton = screen.getByRole('button', { name: 'Clear filters' });
    expect(clearButton).toBeInTheDocument();

    fireEvent.click(clearButton);

    expect(useNotesViewStore.getState().tagIds).toEqual([]);
  });

  it('marks a selected tag chip as pressed via aria-pressed', () => {
    useNotesViewStore.setState({ tagIds: ['tag-1'] });
    render(<TagFilterBar tags={makeTags()} />);

    expect(screen.getByRole('button', { name: 'Work' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Personal' })).toHaveAttribute('aria-pressed', 'false');
  });
});
