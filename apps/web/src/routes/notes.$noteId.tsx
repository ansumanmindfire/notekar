import { useQuery } from '@tanstack/react-query';
import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';
import { AppShell } from '../components/layout/AppShell';
import { getNote } from '../lib/notesApi';
import { extractPlainText } from '../lib/noteExcerpt';

// Throwaway read-only stub - AB-1012 replaces this wholesale with the real
// editor/renderer. No state management, no mutations beyond this single read.
export const noteDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes/$noteId',
  beforeLoad: () => {
    if (useAuthStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login' });
    }
  },
  component: NoteDetailStub,
});

function NoteDetailStub() {
  const { noteId } = noteDetailRoute.useParams();
  const noteQuery = useQuery({
    queryKey: ['notes', 'detail', noteId],
    queryFn: () => getNote(noteId),
  });

  if (noteQuery.isError) {
    return (
      <AppShell>
        <p className="text-sm text-slate-500">This note could not be found.</p>
      </AppShell>
    );
  }

  return (
    <AppShell>
      {noteQuery.data ? (
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{noteQuery.data.title}</h1>
          <p className="mt-4 whitespace-pre-wrap text-sm text-slate-600">
            {extractPlainText(noteQuery.data.body)}
          </p>
        </div>
      ) : (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
    </AppShell>
  );
}
