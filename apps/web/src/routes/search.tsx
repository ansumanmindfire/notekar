import { createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';
import { AppShell } from '../components/layout/AppShell';
import { SearchPage } from '../components/search/SearchPage';

export const searchRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/search',
  beforeLoad: () => {
    if (useAuthStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login' });
    }
  },
  component: () => (
    <AppShell>
      <SearchPage />
    </AppShell>
  ),
});
