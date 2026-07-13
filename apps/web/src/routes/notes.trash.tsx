import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';
import { AppShell } from '../components/layout/AppShell';
import { TrashListPage } from '../components/notes/TrashListPage';

export const notesTrashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes/trash',
  beforeLoad: () => {
    if (useAuthStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login' });
    }
  },
  component: () => (
    <AppShell>
      <TrashListPage />
    </AppShell>
  ),
});
