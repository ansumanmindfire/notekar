import { Outlet, createRootRoute } from '@tanstack/react-router';
import { useAuthStore } from '../stores/authStore';

let bootstrapPromise: Promise<void> | null = null;

export const rootRoute = createRootRoute({
  beforeLoad: async () => {
    // Runs once, before any child route's own beforeLoad guard, so `status` is
    // always settled (never 'idle') by the time login/register/forgot-password/notes
    // read it — this is what prevents the session-bootstrap race described in
    // AB-1010's plan.md risk area #3.
    if (useAuthStore.getState().status === 'idle') {
      bootstrapPromise ??= useAuthStore.getState().bootstrap();
      await bootstrapPromise;
    }
  },
  component: () => <Outlet />,
  pendingComponent: () => <p>Loading…</p>,
});
