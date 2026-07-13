import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ListNotesParams, ListTrashParams } from './notesApi';
import { listNotes, listTags, listTrash, restoreNote } from './notesApi';

export const notesKeys = {
  list: (params: ListNotesParams) => ['notes', 'list', params] as const,
  trash: (params: ListTrashParams) => ['notes', 'trash', params] as const,
  tags: () => ['tags', 'list'] as const,
};

const TAGS_STALE_TIME_MS = 60_000;

export function useNotesListQuery(params: ListNotesParams) {
  return useQuery({
    queryKey: notesKeys.list(params),
    queryFn: () => listNotes(params),
  });
}

export function useTrashListQuery(params: ListTrashParams) {
  return useQuery({
    queryKey: notesKeys.trash(params),
    queryFn: () => listTrash(params),
  });
}

export function useTagsQuery() {
  return useQuery({
    queryKey: notesKeys.tags(),
    queryFn: () => listTags(),
    staleTime: TAGS_STALE_TIME_MS,
  });
}

export function useRestoreNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => restoreNote(noteId),
    onSettled: () => {
      // Invalidate by prefix so no page/sort/filter-parameterized variant of either
      // the active list or trash is missed - covers both the success path (note
      // moves from trash to the active list) and the 404 race (stale trash row
      // must disappear on refetch even though the mutation itself failed).
      void queryClient.invalidateQueries({ queryKey: ['notes'] });
    },
  });
}
