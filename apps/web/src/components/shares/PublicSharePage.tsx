import { usePublicShareQuery } from '../../lib/notesQueries';
import { useMinLoadingTime } from '../../lib/useMinLoadingTime';
import { Skeleton } from '../ui/Skeleton';
import { ApiRequestError } from '../../lib/apiClient';
import { getErrorMessage } from '../../lib/errorMessages';
import { UI_COPY } from '../../lib/uiCopy';
import { sanitizeNoteBody } from '../../lib/sanitize';

interface PublicSharePageProps {
  token: string;
}

export function PublicSharePage({ token }: PublicSharePageProps) {
  const shareQuery = usePublicShareQuery(token);
  const showSkeleton = useMinLoadingTime(shareQuery.isPending);

  if (showSkeleton) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-full max-w-3xl px-6 py-12 space-y-4">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-1/4" />
          <Skeleton className="h-64 mt-8" />
        </div>
      </div>
    );
  }

  if (shareQuery.isError) {
    const isGone = shareQuery.error instanceof ApiRequestError && shareQuery.error.code === 'GONE_LINK_INVALID';
    const message = isGone ? UI_COPY.PUBLIC_SHARE_INVALID.heading : getErrorMessage(
      shareQuery.error instanceof ApiRequestError ? shareQuery.error.code : 'UNKNOWN_ERROR'
    );
    const subtext = isGone ? UI_COPY.PUBLIC_SHARE_INVALID.subtext : undefined;

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-6">
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-slate-200 bg-white py-16 px-8 text-center max-w-lg w-full">
          <h1 className="text-xl font-semibold text-slate-900">{message}</h1>
          {subtext && <p className="text-sm text-slate-500">{subtext}</p>}
        </div>
      </div>
    );
  }

  if (!shareQuery.data) {
    return null;
  }

  const { title, body, viewCount, sharedAt } = shareQuery.data;

  return (
    <div className="min-h-screen flex flex-col items-center bg-white px-6 py-12">
      <div className="w-full max-w-3xl">
        <header className="mb-10 pb-6 border-b border-slate-100">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">{title}</h1>
          <div className="flex items-center gap-4 text-sm text-slate-500">
            <span>Shared: {new Date(sharedAt).toLocaleDateString()}</span>
            <span>Views: {viewCount}</span>
          </div>
        </header>
        <article
          className="prose prose-slate max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitizeNoteBody(body) }}
        />
      </div>
    </div>
  );
}
