import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';
import { AppShell } from '../components/layout/AppShell';
import { NoteEditorPage } from '../components/editor/NoteEditorPage';

export const noteDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes/$noteId',
  beforeLoad: () => {
    if (useAuthStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login' });
    }
  },
  component: NoteDetailPage,
});

function NoteDetailPage() {
  const { noteId } = noteDetailRoute.useParams();
  return (
    <AppShell>
      <NoteEditorPage mode="existing" noteId={noteId} />
    </AppShell>
  );
}
