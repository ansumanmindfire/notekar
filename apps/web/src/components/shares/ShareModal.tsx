import { useState, type FormEvent } from 'react';
import { Copy, Loader2, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogTitle } from '../ui/Dialog';
import { useShareLinksQuery, useCreateShareLinkMutation } from '../../lib/notesQueries';
import { UI_COPY } from '../../lib/uiCopy';
import { ApiRequestError } from '../../lib/apiClient';
import { getErrorMessage } from '../../lib/errorMessages';
import { RevokeShareLinkModal } from './RevokeShareLinkModal';
import type { ShareLink } from 'shared';

interface ShareModalProps {
  noteId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareModal({ noteId, open, onOpenChange }: ShareModalProps) {
  const [days, setDays] = useState<string>('');
  const [revokingToken, setRevokingToken] = useState<string | null>(null);

  const { data: shareLinks = [], isPending: isQueryPending } = useShareLinksQuery(noteId);
  const createMutation = useCreateShareLinkMutation(noteId);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (days !== '' && (Number(days) < 1 || Number(days) > 30)) {
      return; // Handled by native form validation, but guard just in case
    }
    
    const payload = days === '' ? {} : { days: Number(days) };
    
    createMutation.mutate(
      payload,
      {
        onSuccess: () => {
          setDays('');
        },
        onError: (error) => {
          const code = error instanceof ApiRequestError ? error.code : 'UNKNOWN_ERROR';
          toast.error(getErrorMessage(code));
        },
      }
    );
  }

  async function handleCopy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(UI_COPY.SHARE_LINK_COPIED);
    } catch {
      toast.error('Failed to copy link');
    }
  }

  function isActive(link: ShareLink) {
    if (link.revokedAt) return false;
    // eslint-disable-next-line react-hooks/purity
    if (link.expiresAt && new Date(link.expiresAt).getTime() <= Date.now()) return false;
    return true;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogTitle className="text-lg font-semibold text-slate-900 flex items-center gap-2">
            <Share2 className="w-5 h-5" />
            {UI_COPY.SHARE_MODAL.heading}
          </DialogTitle>
          
          <div className="mt-4 border-b border-slate-200 pb-6">
            <form onSubmit={handleCreate} className="flex items-end gap-4">
              <div className="flex-1">
                <label htmlFor="share-days" className="block text-sm font-medium text-slate-700 mb-1">
                  {UI_COPY.SHARE_MODAL.createLinkLabel}
                </label>
                <input
                  id="share-days"
                  type="number"
                  min="1"
                  max="30"
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  placeholder="7"
                  className="w-32 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:opacity-50"
                  disabled={createMutation.isPending}
                />
              </div>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="flex min-w-[120px] items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {createMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                ) : (
                  UI_COPY.SHARE_MODAL.createLinkButton
                )}
              </button>
            </form>
          </div>

          <div className="mt-6">
            <h3 className="text-sm font-medium text-slate-900 mb-3">Active & Past Links</h3>
            {isQueryPending ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : shareLinks.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">{UI_COPY.SHARE_MODAL.emptyState}</p>
            ) : (
              <ul className="space-y-3">
                {shareLinks.map((link) => {
                  const active = isActive(link);
                  return (
                    <li key={link.token} className={`flex items-center justify-between rounded-lg border p-3 ${active ? 'border-slate-200 bg-white' : 'border-slate-100 bg-slate-50'}`}>
                      <div className="min-w-0 flex-1 pr-4">
                        <p className={`text-sm font-medium truncate ${active ? 'text-slate-900' : 'text-slate-500 line-through'}`}>
                          {link.shareUrl}
                        </p>
                        <div className="mt-1 flex items-center gap-4 text-xs text-slate-500">
                          <span>Views: {link.viewCount}</span>
                          {link.expiresAt && <span>Expires: {new Date(link.expiresAt).toLocaleDateString()}</span>}
                          {link.revokedAt && <span>Revoked: {new Date(link.revokedAt).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {active && (
                          <>
                            <button
                              type="button"
                              onClick={() => handleCopy(link.shareUrl)}
                              className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
                              title="Copy link"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Copy
                            </button>
                            <button
                              type="button"
                              onClick={() => setRevokingToken(link.token)}
                              className="inline-flex items-center rounded-md bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                            >
                              Revoke
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {revokingToken && (
        <RevokeShareLinkModal
          noteId={noteId}
          token={revokingToken}
          open={true}
          onOpenChange={(open) => {
            if (!open) setRevokingToken(null);
          }}
          onRevoked={() => setRevokingToken(null)}
        />
      )}
    </>
  );
}
