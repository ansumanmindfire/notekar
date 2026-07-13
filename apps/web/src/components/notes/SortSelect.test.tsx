import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { NoteSort } from 'shared';
import { useNotesViewStore } from '../../stores/notesViewStore';
import { SortSelect } from './SortSelect';

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

describe('SortSelect', () => {
  beforeEach(() => {
    resetStore();
  });

  afterEach(() => {
    cleanup();
  });

  it('defaults to createdAt:desc ("Newest first") when the store is at its default sort', () => {
    render(<SortSelect />);

    expect(screen.getByRole('combobox', { name: 'Sort notes' })).toHaveValue('createdAt:desc');
  });

  it.each<[NoteSort, string]>([
    ['createdAt:desc', 'Newest first'],
    ['createdAt:asc', 'Oldest first'],
    ['updatedAt:desc', 'Recently updated'],
    ['updatedAt:asc', 'Least recently updated'],
  ])('selecting "%s" calls setSort with %s', (value) => {
    render(<SortSelect />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Sort notes' }), { target: { value } });

    expect(useNotesViewStore.getState().sort).toBe(value);
  });

  it('reflects the current store sort value as the selected option', () => {
    useNotesViewStore.setState({ sort: 'updatedAt:asc' });

    render(<SortSelect />);

    expect(screen.getByRole('combobox', { name: 'Sort notes' })).toHaveValue('updatedAt:asc');
  });
});
