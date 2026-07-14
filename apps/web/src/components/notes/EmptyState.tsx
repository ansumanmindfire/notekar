import { FileText, Search, Trash2 } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { UI_COPY } from '../../lib/uiCopy';

export type EmptyStateVariant = 'no-notes' | 'no-matches' | 'empty-trash' | 'no-search-results';

interface EmptyStateProps {
  variant: EmptyStateVariant;
  onClearFilters?: () => void;
}

export function EmptyState({ variant, onClearFilters }: EmptyStateProps) {
  if (variant === 'no-matches') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <FileText className="h-10 w-10 text-slate-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-900">{UI_COPY.EMPTY_NOTES_FILTERED.heading}</h2>
        <p className="max-w-sm text-sm text-slate-500">{UI_COPY.EMPTY_NOTES_FILTERED.subtext}</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          {UI_COPY.EMPTY_NOTES_FILTERED.cta}
        </button>
      </div>
    );
  }

  if (variant === 'empty-trash') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Trash2 className="h-10 w-10 text-slate-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-900">{UI_COPY.EMPTY_TRASH_BIN.heading}</h2>
        <p className="max-w-sm text-sm text-slate-500">{UI_COPY.EMPTY_TRASH_BIN.subtext}</p>
      </div>
    );
  }

  if (variant === 'no-search-results') {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <Search className="h-10 w-10 text-slate-300" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-slate-900">{UI_COPY.EMPTY_SEARCH_RESULTS.heading}</h2>
        <p className="max-w-sm text-sm text-slate-500">{UI_COPY.EMPTY_SEARCH_RESULTS.subtext}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <FileText className="h-10 w-10 text-slate-300" aria-hidden="true" />
      <h2 className="text-lg font-semibold text-slate-900">{UI_COPY.EMPTY_NOTES_LIST.heading}</h2>
      <p className="max-w-sm text-sm text-slate-500">{UI_COPY.EMPTY_NOTES_LIST.subtext}</p>
      <Link
        to="/notes/new"
        className="mt-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
      >
        {UI_COPY.EMPTY_NOTES_LIST.cta}
      </Link>
    </div>
  );
}
