import { create } from 'zustand';

export type EditorStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface EditorStatusState {
  status: EditorStatus;
  setSaving: () => void;
  setSaved: () => void;
  setError: () => void;
  reset: () => void;
}

export const useEditorStatusStore = create<EditorStatusState>((set) => ({
  status: 'idle',
  setSaving: () => set({ status: 'saving' }),
  setSaved: () => set({ status: 'saved' }),
  setError: () => set({ status: 'error' }),
  reset: () => set({ status: 'idle' }),
}));
