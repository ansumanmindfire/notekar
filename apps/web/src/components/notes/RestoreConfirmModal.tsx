import { useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '../ui/Dialog';
import { useRestoreNoteMutation } from '../../lib/notesQueries';
import { ApiRequestError } from '../../lib/apiClient';
import { getErrorMessage } from '../../lib/errorMessages';
import { UI_COPY } from '../../lib/uiCopy';

interface RestoreConfirmModalProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired only after the restore mutation succeeds, distinct from onOpenChange
   * (which also fires for Cancel/Escape/overlay-click) - see TrashPreviewModal. */
  onRestored: () => void;
}

export function RestoreConfirmModal({ noteId, open, onOpenChange, onRestored }: RestoreConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreMutation = useRestoreNoteMutation();

  function handleRestore() {
    restoreMutation.mutate(noteId, {
      onSuccess: onRestored,
      onError: (error) => {
        const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR';
        toast.error(getErrorMessage(code));
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent initialFocusRef={cancelRef}>
        <DialogTitle className="text-lg font-semibold text-slate-900">
          {UI_COPY.RESTORE_CONFIRM.heading}
        </DialogTitle>
        <p className="mt-2 text-sm text-slate-600">{UI_COPY.RESTORE_CONFIRM.body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={restoreMutation.isPending}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {UI_COPY.RESTORE_CONFIRM.cancel}
          </button>
          <button
            type="button"
            onClick={handleRestore}
            disabled={restoreMutation.isPending}
            className="flex min-w-[96px] items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {restoreMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              UI_COPY.RESTORE_CONFIRM.confirm
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
