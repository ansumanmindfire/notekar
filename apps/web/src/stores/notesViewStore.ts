import { create } from 'zustand';
import type { NoteSort } from 'shared';

export interface NotesViewState {
  sort: NoteSort;
  tagIds: string[];
  page: number;
  setSort: (sort: NoteSort) => void;
  toggleTag: (tagId: string) => void;
  clearTagFilter: () => void;
  setPage: (page: number) => void;
}

export const useNotesViewStore = create<NotesViewState>((set) => ({
  sort: 'createdAt:desc',
  tagIds: [],
  page: 1,

  setSort: (sort) => set({ sort, page: 1 }),

  toggleTag: (tagId) =>
    set((state) => ({
      tagIds: state.tagIds.includes(tagId)
        ? state.tagIds.filter((id) => id !== tagId)
        : [...state.tagIds, tagId],
      page: 1,
    })),

  clearTagFilter: () => set({ tagIds: [], page: 1 }),

  setPage: (page) => set({ page }),
}));
