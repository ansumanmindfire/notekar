import { createRoute, createRouter, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { loginRoute } from './login';
import { registerRoute } from './register';
import { forgotPasswordRoute } from './forgot-password';
import { notesRoute } from './notes';
import { useAuthStore } from '../stores/authStore';

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    const { status } = useAuthStore.getState();
    throw redirect({ to: status === 'authenticated' ? '/notes' : '/login' });
  },
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  forgotPasswordRoute,
  notesRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
