import { useState } from 'react';
import type { Note } from 'shared';
import { Dialog, DialogContent, DialogTitle } from '../ui/Dialog';
import { extractPlainText } from '../../lib/noteExcerpt';
import { RestoreConfirmModal } from './RestoreConfirmModal';

interface TrashPreviewModalProps {
  note: Note | null;
  onOpenChange: (open: boolean) => void;
}

export function TrashPreviewModal({ note, onOpenChange }: TrashPreviewModalProps) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  if (!note) {
    return null;
  }

  const excerpt = extractPlainText(note.body);

  return (
    <>
      <Dialog open={!isConfirmOpen} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle className="text-lg font-semibold text-slate-900">{note.title}</DialogTitle>
          <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">{excerpt}</p>
          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={() => setIsConfirmOpen(true)}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Restore
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <RestoreConfirmModal
        noteId={note.id}
        open={isConfirmOpen}
        onOpenChange={setIsConfirmOpen}
        onRestored={() => {
          setIsConfirmOpen(false);
          onOpenChange(false);
        }}
      />
    </>
  );
}
