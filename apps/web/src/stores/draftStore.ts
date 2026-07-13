import { create } from 'zustand';
import type { TipTapDocument } from 'shared';

export interface Draft {
  title: string;
  body: TipTapDocument;
}

export interface DraftState {
  drafts: Record<string, Draft>;
  setDraft: (key: string, draft: Draft) => void;
  clearDraft: (key: string) => void;
}

export const useDraftStore = create<DraftState>((set) => ({
  drafts: {},

  setDraft: (key, draft) =>
    set((state) => ({
      drafts: { ...state.drafts, [key]: draft },
    })),

  clearDraft: (key) =>
    set((state) => {
      if (!(key in state.drafts)) {
        return state;
      }
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts };
    }),
}));
