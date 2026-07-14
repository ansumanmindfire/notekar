import { useState } from 'react';
import { Search } from 'lucide-react';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useSearchQuery, useTagsQuery } from '../../lib/notesQueries';
import { useMinLoadingTime } from '../../lib/useMinLoadingTime';
import { UI_COPY } from '../../lib/uiCopy';
import { EmptyState } from '../notes/EmptyState';
import { Pagination } from '../notes/Pagination';
import { Skeleton } from '../ui/Skeleton';
import { SearchResultCard } from './SearchResultCard';

const PAGE_SIZE = 10;
const DEBOUNCE_MS = 400;

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const trimmedQuery = debouncedQuery.trim();

  // Reset to page 1 as soon as the debounced query settles on a new value - a fresh
  // search result set, not a continuation of the previous query's pagination. Adjusted
  // during render (React's documented pattern for derived state) rather than in an
  // effect, so it takes effect before useSearchQuery below reads `page`.
  const [lastDebouncedQuery, setLastDebouncedQuery] = useState(debouncedQuery);
  if (debouncedQuery !== lastDebouncedQuery) {
    setLastDebouncedQuery(debouncedQuery);
    setPage(1);
  }

  const searchQuery = useSearchQuery(
    { q: trimmedQuery, page, pageSize: PAGE_SIZE },
    { enabled: trimmedQuery.length > 0 },
  );
  const tagsQuery = useTagsQuery();
  const showSkeleton = useMinLoadingTime(trimmedQuery.length > 0 && searchQuery.isPending);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Search</h1>

      <input
        type="text"
        autoFocus
        aria-label="Search notes"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search by title or content..."
        className="w-full rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 focus:border-indigo-500 focus:outline-none"
      />

      {trimmedQuery.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <Search className="h-10 w-10 text-slate-300" aria-hidden="true" />
          <h2 className="text-lg font-semibold text-slate-900">{UI_COPY.SEARCH_IDLE_PROMPT.heading}</h2>
          <p className="max-w-sm text-sm text-slate-500">{UI_COPY.SEARCH_IDLE_PROMPT.subtext}</p>
        </div>
      ) : showSkeleton ? (
        <div className="space-y-3">
          {Array.from({ length: PAGE_SIZE }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      ) : searchQuery.data && searchQuery.data.items.length === 0 ? (
        <EmptyState variant="no-search-results" />
      ) : (
        searchQuery.data && (
          <>
            <div className="space-y-3">
              {searchQuery.data.items.map((result) => (
                <SearchResultCard key={result.note.id} result={result} tags={tagsQuery.data?.items ?? []} />
              ))}
            </div>
            <Pagination
              page={searchQuery.data.page}
              totalPages={searchQuery.data.totalPages}
              onPageChange={setPage}
            />
          </>
        )
      )}
    </div>
  );
}
