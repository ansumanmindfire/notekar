import { useState } from 'react';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { rootRoute } from './root';
import { useAuthStore } from '../stores/authStore';

export const notesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/notes',
  beforeLoad: () => {
    if (useAuthStore.getState().status !== 'authenticated') {
      throw redirect({ to: '/login' });
    }
  },
  component: NotesPlaceholder,
});

function NotesPlaceholder() {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // logout() always clears local session state in its own `finally` even when
      // the network call fails (FR-AUTH-4) — we still navigate away regardless.
    } finally {
      setIsLoggingOut(false);
      await navigate({ to: '/login' });
    }
  }

  return (
    <div>
      <h1>{user ? `Welcome, ${user.email}` : 'Welcome back'}</h1>
      <button onClick={() => void handleLogout()} disabled={isLoggingOut}>
        {isLoggingOut ? 'Logging out…' : 'Log out'}
      </button>
    </div>
  );
}
