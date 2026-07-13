import { useEffect, useRef } from 'react';
import type { Note, TipTapDocument } from 'shared';
import type { UpdateNoteParams } from '../lib/notesApi';
import { useCreateNoteMutation, useUpdateNoteMutation } from '../lib/notesQueries';
import { useDraftStore } from '../stores/draftStore';
import { useEditorStatusStore } from '../stores/editorStatusStore';

const DEBOUNCE_MS = 2000;

export interface UseAutosaveOptions {
  mode: 'new' | 'existing';
  noteId?: string | undefined;
  title: string;
  body: TipTapDocument;
  tagIds: string[];
  onCreated: (note: Note) => void;
}

export interface UseAutosaveResult {
  retry: () => void;
}

export function useAutosave({ mode, noteId, title, body, tagIds, onCreated }: UseAutosaveOptions): UseAutosaveResult {
  const setSaving = useEditorStatusStore((state) => state.setSaving);
  const setSaved = useEditorStatusStore((state) => state.setSaved);
  const setError = useEditorStatusStore((state) => state.setError);
  const setDraft = useDraftStore((state) => state.setDraft);
  const clearDraft = useDraftStore((state) => state.clearDraft);

  const createMutation = useCreateNoteMutation();
  const updateMutation = useUpdateNoteMutation(noteId ?? '');

  const key = noteId ?? 'new';

  const lastSavedTitleRef = useRef(mode === 'existing' ? title : '');
  const lastSavedBodyRef = useRef(mode === 'existing' ? body : ({} as TipTapDocument));
  const hasMountedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const pendingRef = useRef(false);
  const performSaveRef = useRef<() => Promise<void>>(async () => {});

  // Reassigned after every render (no dependency array) so this closure always
  // sees the latest title/body/tagIds/onCreated - the debounce timer and the
  // manual-retry button only ever call performSaveRef.current(), never this
  // function directly, so they always run the freshest version regardless of
  // which render scheduled them.
  useEffect(() => {
    performSaveRef.current = async () => {
      if (inFlightRef.current) {
        pendingRef.current = true;
        return;
      }

      const currentTitle = title;
      const currentBody = body;

      if (currentTitle.trim().length === 0) {
        return;
      }

      const titleChanged = currentTitle !== lastSavedTitleRef.current;
      const bodyChanged = currentBody !== lastSavedBodyRef.current;
      if (!titleChanged && !bodyChanged) {
        return;
      }

      inFlightRef.current = true;
      setSaving();

      const attempt = async (isRetry: boolean): Promise<void> => {
        try {
          if (mode === 'new') {
            const note = await createMutation.mutateAsync({
              title: currentTitle,
              body: currentBody,
              tagIds,
            });
            lastSavedTitleRef.current = currentTitle;
            lastSavedBodyRef.current = currentBody;
            clearDraft('new');
            setSaved();
            onCreated(note);
          } else {
            const patch: UpdateNoteParams = {};
            if (titleChanged) patch.title = currentTitle;
            if (bodyChanged) patch.body = currentBody;
            await updateMutation.mutateAsync(patch);
            lastSavedTitleRef.current = currentTitle;
            lastSavedBodyRef.current = currentBody;
            clearDraft(key);
            setSaved();
          }
        } catch {
          if (!isRetry) {
            await attempt(true);
            return;
          }
          setError();
          setDraft(key, { title: currentTitle, body: currentBody });
        }
      };

      try {
        await attempt(false);
      } finally {
        inFlightRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          void performSaveRef.current();
        }
      }
    };
  });

  useEffect(() => {
    setDraft(key, { title, body });

    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    if (title.trim().length === 0) {
      return;
    }

    timerRef.current = setTimeout(() => {
      void performSaveRef.current();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body]);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        void performSaveRef.current();
      }
    };
    // Empty deps: this cleanup must only fire on true unmount, to flush a
    // pending debounced save - not on every title/body-triggered re-run of
    // the debounce-scheduling effect above.
  }, []);

  return {
    retry: () => {
      void performSaveRef.current();
    },
  };
}
