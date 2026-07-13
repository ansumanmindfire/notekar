import type { Note, NoteSort, Page, Tag, TagColor, TipTapDocument, TagWithCount } from 'shared';
import { apiRequest } from './apiClient';

export interface ListNotesParams {
  sort: NoteSort;
  tagIds: string[];
  page: number;
  pageSize: number;
}

export interface ListTrashParams {
  page: number;
  pageSize: number;
}

function buildQueryString(params: Record<string, string | number | undefined>): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  }
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export function listNotes({ sort, tagIds, page, pageSize }: ListNotesParams): Promise<Page<Note>> {
  const query = buildQueryString({
    sort,
    tagIds: tagIds.length > 0 ? tagIds.join(',') : undefined,
    page,
    pageSize,
  });
  return apiRequest<Page<Note>>(`/notes${query}`);
}

export function listTrash({ page, pageSize }: ListTrashParams): Promise<Page<Note>> {
  const query = buildQueryString({ page, pageSize });
  return apiRequest<Page<Note>>(`/notes/trash${query}`);
}

// Matches packages/shared/src/schemas.ts's paginationQuerySchema max bound (50) -
// the filter bar fetches every tag in one page rather than paginating (see spec.md).
const TAGS_FILTER_PAGE_SIZE = 50;

export function listTags(): Promise<Page<TagWithCount>> {
  const query = buildQueryString({ pageSize: TAGS_FILTER_PAGE_SIZE });
  return apiRequest<Page<TagWithCount>>(`/tags${query}`);
}

export function restoreNote(id: string): Promise<Note> {
  return apiRequest<Note>(`/notes/${id}/restore`, { method: 'POST' });
}

// Backs the throwaway /notes/:id stub route (notes.$noteId.tsx) - AB-1012 replaces
// both with the real editor/renderer.
export function getNote(id: string): Promise<Note> {
  return apiRequest<Note>(`/notes/${id}`);
}

export interface CreateNoteParams {
  title: string;
  body: TipTapDocument;
  tagIds?: string[];
}

export interface UpdateNoteParams {
  title?: string;
  body?: TipTapDocument;
  tagIds?: string[];
}

export function createNote(params: CreateNoteParams): Promise<Note> {
  return apiRequest<Note>('/notes', { method: 'POST', body: params });
}

export function updateNote(id: string, params: UpdateNoteParams): Promise<Note> {
  return apiRequest<Note>(`/notes/${id}`, { method: 'PATCH', body: params });
}

export function deleteNote(id: string): Promise<void> {
  return apiRequest<void>(`/notes/${id}`, { method: 'DELETE' });
}

export interface CreateTagParams {
  name: string;
  color: TagColor;
}

export function createTag(params: CreateTagParams): Promise<Tag> {
  return apiRequest<Tag>('/tags', { method: 'POST', body: params });
}
