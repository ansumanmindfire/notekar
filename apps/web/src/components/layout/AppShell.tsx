import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useAuthStore } from '../../stores/authStore';

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // logout() always clears local session state in its own `finally` even when
      // the network call fails (FR-AUTH-4) - we still navigate away regardless.
    } finally {
      setIsLoggingOut(false);
      await navigate({ to: '/login' });
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          <span className="text-lg font-bold text-slate-900">NoteApp</span>
          <nav className="flex items-center gap-6">
            <Link to="/notes" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Notes
            </Link>
            <Link to="/search" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Search
            </Link>
            <Link to="/notes/trash" className="text-sm font-medium text-slate-600 hover:text-slate-900">
              Trash
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={isLoggingOut}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 disabled:opacity-50"
            >
              {isLoggingOut ? 'Logging out…' : 'Log out'}
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
