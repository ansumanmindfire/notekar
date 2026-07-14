import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import type { Editor } from '@tiptap/react';
import { Share2, Trash2 } from 'lucide-react';
import type { Note, TipTapDocument } from 'shared';
import { titleSchema } from 'shared';
import { useAutosave } from '../../hooks/useAutosave';
import { useNoteQuery } from '../../lib/notesQueries';
import { useEditorStatusStore } from '../../stores/editorStatusStore';
import { useMinLoadingTime } from '../../lib/useMinLoadingTime';
import { ApiRequestError } from '../../lib/apiClient';
import { getErrorMessage } from '../../lib/errorMessages';
import { Skeleton } from '../ui/Skeleton';
import { NoteEditor } from './NoteEditor';
import { EditorToolbar } from './EditorToolbar';
import { AutosaveStatusPill } from './AutosaveStatusPill';
import { TagCombobox } from './TagCombobox';
import { DeleteNoteModal } from './DeleteNoteModal';
import { ShareModal } from '../shares/ShareModal';

const EMPTY_BODY: TipTapDocument = { type: 'doc', content: [{ type: 'paragraph' }] };

export interface NoteEditorPageProps {
  mode: 'new' | 'existing';
  noteId?: string;
}

export function NoteEditorPage({ mode, noteId }: NoteEditorPageProps) {
  const navigate = useNavigate();
  const resetStatus = useEditorStatusStore((state) => state.reset);

  useEffect(() => {
    resetStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noteQuery = useNoteQuery(noteId ?? '', { enabled: mode === 'existing' });
  const showSkeleton = useMinLoadingTime(mode === 'existing' && noteQuery.isPending);

  if (mode === 'existing' && showSkeleton) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-2/3" />
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (mode === 'existing' && noteQuery.isError) {
    const code = noteQuery.error instanceof ApiRequestError ? noteQuery.error.code : 'UNKNOWN_ERROR';
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-slate-200 bg-white py-16 text-center">
        <h1 className="text-xl font-semibold text-slate-900">{getErrorMessage(code)}</h1>
        <button
          type="button"
          onClick={() => void navigate({ to: '/notes' })}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Return to Active Notes
        </button>
      </div>
    );
  }

  if (mode === 'existing' && !noteQuery.data) {
    return null;
  }

  function handleCreated(note: Note) {
    void navigate({ to: '/notes/$noteId', params: { noteId: note.id }, replace: true });
  }

  return (
    <EditorBody
      mode={mode}
      noteId={noteId}
      initialTitle={mode === 'existing' ? noteQuery.data!.title : ''}
      initialBody={mode === 'existing' ? noteQuery.data!.body : EMPTY_BODY}
      existingTagIds={mode === 'existing' ? noteQuery.data!.tagIds : undefined}
      onCreated={handleCreated}
    />
  );
}

interface EditorBodyProps {
  mode: 'new' | 'existing';
  noteId?: string | undefined;
  initialTitle: string;
  initialBody: TipTapDocument;
  existingTagIds?: string[] | undefined;
  onCreated: (note: Note) => void;
}

function EditorBody({ mode, noteId, initialTitle, initialBody, existingTagIds, onCreated }: EditorBodyProps) {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [pendingTagIds, setPendingTagIds] = useState<string[]>([]);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [editorInstance, setEditorInstance] = useState<Editor | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  const autosave = useAutosave({
    mode,
    noteId,
    title,
    body,
    tagIds: pendingTagIds,
    onCreated,
  });

  function handleTitleBlur() {
    const result = titleSchema.safeParse(title);
    setTitleError(result.success ? null : (result.error.issues[0]?.message ?? 'Invalid title'));
  }

  const attachedTagIds = mode === 'existing' ? (existingTagIds ?? []) : pendingTagIds;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <label htmlFor="note-title" className="sr-only">
            Title
          </label>
          <input
            id="note-title"
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={handleTitleBlur}
            placeholder="Untitled note"
            className={`w-full rounded-lg border px-3 py-2 text-2xl font-bold text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/80 ${
              titleError ? 'border-red-500 focus-visible:ring-red-500' : 'border-transparent'
            }`}
          />
          {titleError && <p className="mt-1 text-xs text-red-500">{titleError}</p>}
        </div>
        <div className="flex items-center gap-3 pt-2">
          <AutosaveStatusPill onRetry={autosave.retry} />
          {mode === 'existing' && noteId && (
            <>
              <button
                type="button"
                onClick={() => setShareModalOpen(true)}
                aria-label="Share note"
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-indigo-600"
              >
                <Share2 className="h-4 w-4" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => setDeleteModalOpen(true)}
                aria-label="Delete note"
                className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      </div>

      <TagCombobox
        noteId={mode === 'existing' ? noteId : undefined}
        attachedTagIds={attachedTagIds}
        onPendingTagIdsChange={setPendingTagIds}
      />

      <EditorToolbar editor={editorInstance} />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <NoteEditor content={body} onUpdate={setBody} onEditorReady={setEditorInstance} />
      </div>

      {mode === 'existing' && noteId && (
        <>
          <DeleteNoteModal noteId={noteId} open={deleteModalOpen} onOpenChange={setDeleteModalOpen} />
          <ShareModal noteId={noteId} open={shareModalOpen} onOpenChange={setShareModalOpen} />
        </>
      )}
    </div>
  );
}
