import type { TagWithCount } from 'shared';
import { useNotesViewStore } from '../../stores/notesViewStore';

interface TagFilterBarProps {
  tags: TagWithCount[];
}

export function TagFilterBar({ tags }: TagFilterBarProps) {
  const tagIds = useNotesViewStore((state) => state.tagIds);
  const toggleTag = useNotesViewStore((state) => state.toggleTag);
  const clearTagFilter = useNotesViewStore((state) => state.clearTagFilter);

  if (tags.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tags.map((tag) => {
        const isSelected = tagIds.includes(tag.id);
        return (
          <button
            key={tag.id}
            type="button"
            onClick={() => toggleTag(tag.id)}
            aria-pressed={isSelected}
            className={
              isSelected
                ? 'rounded-full border border-indigo-600 bg-indigo-600 px-3 py-1 text-xs font-medium text-white'
                : 'rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50'
            }
          >
            {tag.name}
          </button>
        );
      })}
      {tagIds.length > 0 && (
        <button
          type="button"
          onClick={clearTagFilter}
          className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
