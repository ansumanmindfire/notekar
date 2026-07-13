import { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import type { TagColor } from 'shared';
import { useCreateTagMutation, useTagsQuery, useUpdateNoteMutation } from '../../lib/notesQueries';
import { ApiRequestError } from '../../lib/apiClient';
import { getErrorMessage } from '../../lib/errorMessages';
import { pickRandomTagColor } from '../../lib/tagColor';
import { UI_COPY } from '../../lib/uiCopy';

const TAG_COLOR_CLASSES: Record<TagColor, string> = {
  red: 'bg-red-100 text-red-700',
  orange: 'bg-orange-100 text-orange-700',
  yellow: 'bg-yellow-100 text-yellow-700',
  green: 'bg-green-100 text-green-700',
  blue: 'bg-blue-100 text-blue-700',
  purple: 'bg-purple-100 text-purple-700',
  pink: 'bg-pink-100 text-pink-700',
  gray: 'bg-slate-100 text-slate-700',
};

export interface TagComboboxProps {
  noteId?: string | undefined;
  attachedTagIds: string[];
  onPendingTagIdsChange?: (tagIds: string[]) => void;
}

export function TagCombobox({ noteId, attachedTagIds, onPendingTagIdsChange }: TagComboboxProps) {
  const [inputValue, setInputValue] = useState('');
  const tagsQuery = useTagsQuery();
  const createTagMutation = useCreateTagMutation();
  const updateNoteMutation = useUpdateNoteMutation(noteId ?? '');

  const allTags = tagsQuery.data?.items ?? [];
  const attachedTags = allTags.filter((tag) => attachedTagIds.includes(tag.id));

  function applyTagIds(nextTagIds: string[]) {
    if (noteId) {
      updateNoteMutation.mutate(
        { tagIds: nextTagIds },
        {
          onError: (error) => {
            const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR';
            toast.error(getErrorMessage(code));
          },
        },
      );
    } else {
      onPendingTagIdsChange?.(nextTagIds);
    }
  }

  function attachTag(tagId: string) {
    if (attachedTagIds.includes(tagId)) {
      return;
    }
    applyTagIds([...attachedTagIds, tagId]);
  }

  function detachTag(tagId: string) {
    applyTagIds(attachedTagIds.filter((id) => id !== tagId));
  }

  function handleSubmit() {
    const name = inputValue.trim();
    if (!name) {
      return;
    }

    const existingMatch = allTags.find((tag) => tag.name.toLowerCase() === name.toLowerCase());
    if (existingMatch) {
      attachTag(existingMatch.id);
      setInputValue('');
      return;
    }

    createTagMutation.mutate(
      { name, color: pickRandomTagColor() },
      {
        onSuccess: (tag) => {
          attachTag(tag.id);
          setInputValue('');
        },
        onError: async (error) => {
          const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR';
          if (code === 'TAG_NAME_DUPLICATE') {
            const refetched = await tagsQuery.refetch();
            const resolved = refetched.data?.items.find(
              (tag) => tag.name.toLowerCase() === name.toLowerCase(),
            );
            if (resolved) {
              attachTag(resolved.id);
            }
            setInputValue('');
            return;
          }
          toast.error(getErrorMessage(code));
        },
      },
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {attachedTags.map((tag) => (
          <span
            key={tag.id}
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${TAG_COLOR_CLASSES[tag.color]}`}
          >
            {tag.name}
            <button
              type="button"
              onClick={() => detachTag(tag.id)}
              aria-label={`Remove ${tag.name}`}
              className="rounded-full hover:bg-black/10"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor="tag-combobox-input" className="sr-only">
          Add a tag
        </label>
        <input
          id="tag-combobox-input"
          type="text"
          value={inputValue}
          onChange={(event) => setInputValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              handleSubmit();
            }
          }}
          placeholder="Add a tag..."
          className="w-40 rounded-md border border-slate-300 px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/80"
        />
        {inputValue.trim() && (
          <button
            type="button"
            onClick={handleSubmit}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-500"
          >
            {UI_COPY.TAG_CREATE_LABEL(inputValue.trim())}
          </button>
        )}
      </div>
    </div>
  );
}
