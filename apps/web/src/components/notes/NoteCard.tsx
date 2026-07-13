import { Link } from '@tanstack/react-router';
import type { Note, TagColor, TagWithCount } from 'shared';
import { extractPlainText, truncate } from '../../lib/noteExcerpt';

const EXCERPT_MAX_LENGTH = 160;

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

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMinutes = Math.round((Date.now() - date.getTime()) / 60_000);

  if (diffMinutes < 1) return 'just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

interface NoteCardProps {
  note: Note;
  tags: TagWithCount[];
  /** Which timestamp field to display, matching the active sort field. */
  timestampField: 'createdAt' | 'updatedAt';
}

export function NoteCard({ note, tags, timestampField }: NoteCardProps) {
  const excerpt = truncate(extractPlainText(note.body), EXCERPT_MAX_LENGTH);
  const noteTags = tags.filter((tag) => note.tagIds.includes(tag.id));
  const timestampLabel = timestampField === 'updatedAt' ? 'Updated' : 'Created';

  return (
    <Link
      to="/notes/$noteId"
      params={{ noteId: note.id }}
      className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      <h3 className="font-semibold text-slate-900">{note.title}</h3>
      {excerpt && <p className="mt-1 text-sm text-slate-600">{excerpt}</p>}
      {noteTags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {noteTags.map((tag) => (
            <span
              key={tag.id}
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${TAG_COLOR_CLASSES[tag.color]}`}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">
        {timestampLabel} {formatRelativeTime(note[timestampField])}
      </p>
    </Link>
  );
}
