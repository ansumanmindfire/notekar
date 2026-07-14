import { useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '../ui/Dialog';
import { useRestoreVersionMutation } from '../../lib/notesQueries';
import { ApiRequestError } from '../../lib/apiClient';
import { getErrorMessage } from '../../lib/errorMessages';
import { UI_COPY } from '../../lib/uiCopy';

interface RestoreVersionConfirmModalProps {
  noteId: string;
  versionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRestored: () => void;
}

export function RestoreVersionConfirmModal({
  noteId,
  versionId,
  open,
  onOpenChange,
  onRestored,
}: RestoreVersionConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restoreMutation = useRestoreVersionMutation(noteId);

  function handleRestore() {
    restoreMutation.mutate(versionId, {
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
          {UI_COPY.RESTORE_VERSION_CONFIRM.heading}
        </DialogTitle>
        <p className="mt-2 text-sm text-slate-600">{UI_COPY.RESTORE_VERSION_CONFIRM.body}</p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={restoreMutation.isPending}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {UI_COPY.RESTORE_VERSION_CONFIRM.cancel}
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
              UI_COPY.RESTORE_VERSION_CONFIRM.confirm
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
