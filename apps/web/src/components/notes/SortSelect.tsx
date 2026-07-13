import type { NoteSort } from 'shared';
import { useNotesViewStore } from '../../stores/notesViewStore';

const SORT_OPTIONS: { value: NoteSort; label: string }[] = [
  { value: 'createdAt:desc', label: 'Newest first' },
  { value: 'createdAt:asc', label: 'Oldest first' },
  { value: 'updatedAt:desc', label: 'Recently updated' },
  { value: 'updatedAt:asc', label: 'Least recently updated' },
];

export function SortSelect() {
  const sort = useNotesViewStore((state) => state.sort);
  const setSort = useNotesViewStore((state) => state.setSort);

  return (
    <select
      aria-label="Sort notes"
      value={sort}
      onChange={(event) => setSort(event.target.value as NoteSort)}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
    >
      {SORT_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
