import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { router as appRouter } from './router';
import type { AuthApi } from '../stores/authStore';
import { setAuthApi, useAuthStore } from '../stores/authStore';

// AB-1010 task 5.4 — closes the coverage gap on /notes' own interactive content
// (`NotesPlaceholder`, not exported), which `router.test.tsx`'s guard tests only
// exercise superficially (they always seed `user: null`, so the "Welcome back"
// branch was covered but "Welcome, <email>" and the logout flow were not).

const INITIAL_STATE = {
  accessToken: null,
  user: null,
  status: 'idle' as const,
};

function makeMockAuthApi(overrides: Partial<AuthApi> = {}): AuthApi {
  return {
    login: vi.fn(),
    register: vi.fn(),
    refresh: vi.fn(),
    logout: vi.fn(),
    ...overrides,
  };
}

function seedAuthenticated(user: { id: string; email: string } | null): void {
  useAuthStore.setState(
    {
      ...INITIAL_STATE,
      status: 'authenticated',
      user,
      setSession: useAuthStore.getState().setSession,
      clearSession: useAuthStore.getState().clearSession,
      login: useAuthStore.getState().login,
      register: useAuthStore.getState().register,
      logout: useAuthStore.getState().logout,
      bootstrap: useAuthStore.getState().bootstrap,
    },
    true,
  );
}

function createTestRouter(initialPath: string) {
  return createRouter({
    routeTree: appRouter.routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

async function renderAt(initialPath: string) {
  const testRouter = createTestRouter(initialPath);
  await testRouter.load();
  render(<RouterProvider router={testRouter} />);
  await waitFor(() => {
    expect(testRouter.state.status).toBe('idle');
  });
  return testRouter;
}

describe('/notes page', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('welcome heading', () => {
    it('renders "Welcome, <email>" when the auth store has a user (fresh login/register)', async () => {
      setAuthApi(makeMockAuthApi());
      seedAuthenticated({ id: 'user-1', email: 'user@example.com' });

      await renderAt('/notes');

      expect(await screen.findByText('Welcome, user@example.com')).toBeInTheDocument();
    });

    it('renders "Welcome back" when authenticated but user is null (bootstrap-restored session)', async () => {
      setAuthApi(makeMockAuthApi());
      seedAuthenticated(null);

      await renderAt('/notes');

      expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    });
  });

  describe('log out', () => {
    beforeEach(() => {
      seedAuthenticated(null);
    });

    it('shows "Logging out…" while pending and navigates to /login when logout() resolves', async () => {
      let resolveLogout!: () => void;
      const pending = new Promise<void>((resolve) => {
        resolveLogout = resolve;
      });
      setAuthApi(makeMockAuthApi({ logout: vi.fn().mockReturnValue(pending) }));

      const testRouter = await renderAt('/notes');
      fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

      const button = await screen.findByRole('button', { name: 'Logging out…' });
      expect(button).toBeDisabled();

      resolveLogout();

      await waitFor(() => {
        expect(testRouter.state.location.pathname).toBe('/login');
      });
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });

    it('still navigates to /login when logout() rejects (session is cleared locally regardless, FR-AUTH-4)', async () => {
      setAuthApi(
        makeMockAuthApi({ logout: vi.fn().mockRejectedValue(new Error('network error')) }),
      );

      const testRouter = await renderAt('/notes');
      fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

      await waitFor(() => {
        expect(testRouter.state.location.pathname).toBe('/login');
      });
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });
  });
});
