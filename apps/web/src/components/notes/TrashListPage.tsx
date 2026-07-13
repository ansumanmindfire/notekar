import { useState } from 'react';
import type { Note } from 'shared';
import { useTrashListQuery } from '../../lib/notesQueries';
import { useMinLoadingTime } from '../../lib/useMinLoadingTime';
import { extractPlainText, truncate } from '../../lib/noteExcerpt';
import { EmptyState } from './EmptyState';
import { Skeleton } from '../ui/Skeleton';
import { Pagination } from './Pagination';
import { TrashPreviewModal } from './TrashPreviewModal';

const PAGE_SIZE = 10;
const ROW_EXCERPT_MAX_LENGTH = 120;

export function TrashListPage() {
  const [page, setPage] = useState(1);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);

  const trashQuery = useTrashListQuery({ page, pageSize: PAGE_SIZE });
  const showSkeleton = useMinLoadingTime(trashQuery.isPending);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Trash</h1>

      {showSkeleton ? (
        <div className="space-y-3">
          {Array.from({ length: PAGE_SIZE }, (_, index) => (
            <Skeleton key={index} className="h-16" />
          ))}
        </div>
      ) : trashQuery.data && trashQuery.data.items.length === 0 ? (
        <EmptyState variant="empty-trash" />
      ) : (
        trashQuery.data && (
          <>
            <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
              {trashQuery.data.items.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedNote(note)}
                    className="block w-full px-4 py-3 text-left hover:bg-slate-50"
                  >
                    <p className="font-medium text-slate-900">{note.title}</p>
                    <p className="mt-0.5 text-sm text-slate-500">
                      {truncate(extractPlainText(note.body), ROW_EXCERPT_MAX_LENGTH)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
            <Pagination
              page={trashQuery.data.page}
              totalPages={trashQuery.data.totalPages}
              onPageChange={setPage}
            />
          </>
        )
      )}

      <TrashPreviewModal note={selectedNote} onOpenChange={(open) => !open && setSelectedNote(null)} />
    </div>
  );
}
