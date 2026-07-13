import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';
import { AppShell } from '../components/layout/AppShell';

// Throwaway placeholder - AB-1012 replaces this wholesale with the real note editor.
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
      <p className="text-sm text-slate-500">Note editor coming soon.</p>
    </AppShell>
  ),
});
