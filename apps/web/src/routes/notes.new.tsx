import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';
import { AppShell } from '../components/layout/AppShell';
import { NoteEditorPage } from '../components/editor/NoteEditorPage';

export const noteNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes/new',
  beforeLoad: () => {
    if (useAuthStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login' });
    }
  },
  component: () => (
    <AppShell>
      <NoteEditorPage mode="new" />
    </AppShell>
  ),
});
