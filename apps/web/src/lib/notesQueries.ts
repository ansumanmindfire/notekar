import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateNoteParams, CreateTagParams, ListNotesParams, ListTrashParams, SearchParams, UpdateNoteParams } from './notesApi';
import { createNote, createTag, deleteNote, getNote, listNotes, listTags, listTrash, restoreNote, search, updateNote, listShareLinks, createShareLink, revokeShareLink, getPublicShare, listVersions, getVersionDetail, restoreVersion } from './notesApi';

export const notesKeys = {
  list: (params: ListNotesParams) => ['notes', 'list', params] as const,
  trash: (params: ListTrashParams) => ['notes', 'trash', params] as const,
  detail: (noteId: string) => ['notes', 'detail', noteId] as const,
  tags: () => ['tags', 'list'] as const,
  search: (params: SearchParams) => ['search', params.q, params.page, params.pageSize] as const,
};

export const sharesKeys = {
  list: (noteId: string) => ['shares', 'list', noteId] as const,
  detail: (token: string) => ['shares', 'public', token] as const,
};

export const versionsKeys = {
  list: (noteId: string) => ['versions', 'list', noteId] as const,
  detail: (noteId: string, versionId: string) => ['versions', 'detail', noteId, versionId] as const,
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

export function useNoteQuery(noteId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: notesKeys.detail(noteId),
    queryFn: () => getNote(noteId),
    enabled: options.enabled ?? true,
  });
}

export function useSearchQuery(params: SearchParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: notesKeys.search(params),
    queryFn: () => search(params),
    enabled: options.enabled ?? params.q.trim().length > 0,
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

export function useCreateNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateNoteParams) => createNote(params),
    onSuccess: (note) => {
      // Seed the detail cache with the just-created note so the route transition
      // to /notes/:id mounts already-populated - no refetch waterfall/content flash.
      queryClient.setQueryData(notesKeys.detail(note.id), note);
      void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
    },
  });
}

export function useUpdateNoteMutation(noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: UpdateNoteParams) => updateNote(noteId, params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notesKeys.detail(noteId) });
      void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
    },
  });
}

export function useDeleteNoteMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (noteId: string) => deleteNote(noteId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['notes', 'trash'] });
    },
  });
}

export function useCreateTagMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: CreateTagParams) => createTag(params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notesKeys.tags() });
    },
  });
}

export function useShareLinksQuery(noteId: string) {
  return useQuery({
    queryKey: sharesKeys.list(noteId),
    queryFn: () => listShareLinks(noteId),
  });
}

export function useCreateShareLinkMutation(noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { days?: number }) => createShareLink(noteId, params),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharesKeys.list(noteId) });
    },
  });
}

export function useRevokeShareLinkMutation(noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (token: string) => revokeShareLink(noteId, token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sharesKeys.list(noteId) });
    },
  });
}

export function usePublicShareQuery(token: string) {
  return useQuery({
    queryKey: sharesKeys.detail(token),
    queryFn: () => getPublicShare(token),
    enabled: token.length > 0,
  });
}

export function useVersionsQuery(noteId: string) {
  return useQuery({
    queryKey: versionsKeys.list(noteId),
    queryFn: () => listVersions(noteId),
  });
}

export function useVersionDetailQuery(noteId: string, versionId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: versionsKeys.detail(noteId, versionId),
    queryFn: () => getVersionDetail(noteId, versionId),
    enabled: options.enabled ?? true,
  });
}

export function useRestoreVersionMutation(noteId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (versionId: string) => restoreVersion(noteId, versionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notesKeys.detail(noteId) });
      void queryClient.invalidateQueries({ queryKey: versionsKeys.list(noteId) });
    },
  });
}
