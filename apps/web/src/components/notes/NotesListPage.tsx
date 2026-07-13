import { Link } from '@tanstack/react-router';
import { useNotesListQuery, useTagsQuery } from '../../lib/notesQueries';
import { useNotesViewStore } from '../../stores/notesViewStore';
import { useMinLoadingTime } from '../../lib/useMinLoadingTime';
import { NoteCard } from './NoteCard';
import { TagFilterBar } from './TagFilterBar';
import { SortSelect } from './SortSelect';
import { Pagination } from './Pagination';
import { EmptyState } from './EmptyState';
import { Skeleton } from '../ui/Skeleton';

const PAGE_SIZE = 10;

export function NotesListPage() {
  const sort = useNotesViewStore((state) => state.sort);
  const tagIds = useNotesViewStore((state) => state.tagIds);
  const page = useNotesViewStore((state) => state.page);
  const setPage = useNotesViewStore((state) => state.setPage);
  const clearTagFilter = useNotesViewStore((state) => state.clearTagFilter);

  const notesQuery = useNotesListQuery({ sort, tagIds, page, pageSize: PAGE_SIZE });
  const tagsQuery = useTagsQuery();

  const showSkeleton = useMinLoadingTime(notesQuery.isPending);
  const tags = tagsQuery.data?.items ?? [];
  const timestampField = sort.startsWith('updatedAt') ? 'updatedAt' : 'createdAt';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Notes</h1>
        <Link
          to="/notes/new"
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          New Note
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <TagFilterBar tags={tags} />
        <SortSelect />
      </div>

      {showSkeleton ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: PAGE_SIZE }, (_, index) => (
            <Skeleton key={index} className="h-32" />
          ))}
        </div>
      ) : notesQuery.data && notesQuery.data.items.length === 0 ? (
        <EmptyState variant={tagIds.length > 0 ? 'no-matches' : 'no-notes'} onClearFilters={clearTagFilter} />
      ) : (
        notesQuery.data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {notesQuery.data.items.map((note) => (
                <NoteCard key={note.id} note={note} tags={tags} timestampField={timestampField} />
              ))}
            </div>
            <Pagination page={notesQuery.data.page} totalPages={notesQuery.data.totalPages} onPageChange={setPage} />
          </>
        )
      )}
    </div>
  );
}
