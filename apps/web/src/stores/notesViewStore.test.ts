import { beforeEach, describe, expect, it } from 'vitest';
import { useNotesViewStore } from './notesViewStore';

const INITIAL_STATE = {
  sort: 'createdAt:desc' as const,
  tagIds: [] as string[],
  page: 1,
};

describe('notesViewStore', () => {
  beforeEach(() => {
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
  });

  describe('setSort', () => {
    it('updates sort and resets page to 1', () => {
      useNotesViewStore.getState().setPage(5);
      expect(useNotesViewStore.getState().page).toBe(5);

      useNotesViewStore.getState().setSort('updatedAt:asc');

      const state = useNotesViewStore.getState();
      expect(state.sort).toBe('updatedAt:asc');
      expect(state.page).toBe(1);
    });
  });

  describe('toggleTag', () => {
    it('adds a tagId not already present and resets page to 1', () => {
      useNotesViewStore.getState().setPage(3);

      useNotesViewStore.getState().toggleTag('tag-1');

      const state = useNotesViewStore.getState();
      expect(state.tagIds).toEqual(['tag-1']);
      expect(state.page).toBe(1);
    });

    it('removes a tagId already present and resets page to 1', () => {
      useNotesViewStore.setState({ tagIds: ['tag-1', 'tag-2'], page: 4 });

      useNotesViewStore.getState().toggleTag('tag-1');

      const state = useNotesViewStore.getState();
      expect(state.tagIds).toEqual(['tag-2']);
      expect(state.page).toBe(1);
    });
  });

  describe('clearTagFilter', () => {
    it('empties tagIds and resets page to 1', () => {
      useNotesViewStore.setState({ tagIds: ['tag-1', 'tag-2'], page: 7 });

      useNotesViewStore.getState().clearTagFilter();

      const state = useNotesViewStore.getState();
      expect(state.tagIds).toEqual([]);
      expect(state.page).toBe(1);
    });
  });

  describe('setPage', () => {
    it('updates only page, leaving sort and tagIds untouched', () => {
      useNotesViewStore.setState({ sort: 'updatedAt:asc', tagIds: ['tag-1'] });

      useNotesViewStore.getState().setPage(9);

      const state = useNotesViewStore.getState();
      expect(state.page).toBe(9);
      expect(state.sort).toBe('updatedAt:asc');
      expect(state.tagIds).toEqual(['tag-1']);
    });
  });
});
