import { useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import type { TipTapDocument } from 'shared';
import { Dialog, DialogContent, DialogTitle } from '../ui/Dialog';
import { useVersionsQuery, useVersionDetailQuery } from '../../lib/notesQueries';
import { sanitizeNoteBody } from '../../lib/sanitize';
import { UI_COPY } from '../../lib/uiCopy';
import { RestoreVersionConfirmModal } from './RestoreVersionConfirmModal';

interface VersionHistoryModalProps {
  noteId: string;
  currentTitle: string;
  currentBody: TipTapDocument;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function VersionHistoryModal({
  noteId,
  currentTitle,
  currentBody,
  open,
  onOpenChange,
}: VersionHistoryModalProps) {
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);

  const { data: versions = [], isPending: isListPending } = useVersionsQuery(noteId);
  const selectedDetailQuery = useVersionDetailQuery(noteId, selectedVersionId ?? '', {
    enabled: selectedVersionId !== null,
  });
  const selectedDetail = selectedVersionId !== null ? selectedDetailQuery.data : undefined;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setSelectedVersionId(null);
    }
    onOpenChange(nextOpen);
  }

  function handleRestored() {
    setRestoringVersionId(null);
    setSelectedVersionId(null);
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <History className="h-5 w-5" aria-hidden="true" />
            {UI_COPY.VERSION_HISTORY.heading}
          </DialogTitle>

          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-[200px_1fr]">
            <div className="border-b border-slate-200 pb-4 md:border-b-0 md:border-r md:pb-0 md:pr-4">
              {isListPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              ) : versions.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">{UI_COPY.VERSION_HISTORY.emptyState}</p>
              ) : (
                <ul className="space-y-1">
                  {versions.map((version) => (
                    <li key={version.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedVersionId(version.id)}
                        className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${
                          selectedVersionId === version.id
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <span className="block font-medium">Version {version.version}</span>
                        <span className="block text-xs text-slate-500">
                          {new Date(version.savedAt).toLocaleString()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              {selectedVersionId === null ? (
                <p className="py-8 text-center text-sm text-slate-500">Select a version to preview it.</p>
              ) : selectedDetailQuery.isPending ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" aria-hidden="true" />
                </div>
              ) : selectedDetail ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-slate-900">
                      {UI_COPY.VERSION_HISTORY.currentLabel}
                    </h3>
                    <p className="mb-1 text-sm font-semibold text-slate-800">{currentTitle}</p>
                    <div
                      className="prose prose-sm max-w-none rounded-md border border-slate-200 bg-slate-50 p-3"
                      dangerouslySetInnerHTML={{ __html: sanitizeNoteBody(currentBody) }}
                    />
                  </div>
                  <div>
                    <h3 className="mb-2 text-sm font-medium text-slate-900">
                      Version {selectedDetail.version} · {new Date(selectedDetail.savedAt).toLocaleString()}
                    </h3>
                    <p className="mb-1 text-sm font-semibold text-slate-800">{selectedDetail.title}</p>
                    <div
                      className="prose prose-sm max-w-none rounded-md border border-slate-200 bg-white p-3"
                      dangerouslySetInnerHTML={{ __html: sanitizeNoteBody(selectedDetail.body) }}
                    />
                    <button
                      type="button"
                      onClick={() => setRestoringVersionId(selectedDetail.id)}
                      className="mt-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
                    >
                      {UI_COPY.VERSION_HISTORY.restoreButton}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {restoringVersionId && (
        <RestoreVersionConfirmModal
          noteId={noteId}
          versionId={restoringVersionId}
          open={true}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) setRestoringVersionId(null);
          }}
          onRestored={handleRestored}
        />
      )}
    </>
  );
}
