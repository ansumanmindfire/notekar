import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { AuthApi } from '../../stores/authStore';
import { realAuthApi, setAuthApi, useAuthStore } from '../../stores/authStore';
import { AppShell } from './AppShell';

// AB-1011 task T16 — verifies AppShell's own wiring (nav link targets, and the
// logout button calling authStore.logout() + navigating to /login). The internal
// try/finally behavior of logout() itself (session clearing on success vs.
// network failure) is already covered by authStore.test.ts and is not
// re-asserted here.

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

function seedAuthenticated(): void {
  useAuthStore.setState(
    {
      ...INITIAL_STATE,
      status: 'authenticated',
      user: { id: 'user-1', email: 'user@example.com' },
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

// A minimal, self-contained route tree (independent of the real app router in
// src/routes/router.tsx) that hosts AppShell under test at /notes, plus stub
// destinations for its Notes/Trash/logout navigation targets. This keeps the
// test focused purely on AppShell's own wiring, without pulling in the real
// notesRoute's TanStack Query data-fetching (NotesListPage) or auth guards.
function buildTestRouter(initialPath: string) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const notesRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes',
    component: () => <AppShell>{'Notes content'}</AppShell>,
  });
  const trashRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes/trash',
    component: () => <p>Trash page</p>,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => <p>Login page</p>,
  });
  const routeTree = rootRoute.addChildren([notesRoute, trashRoute, loginRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
}

async function renderAt(initialPath: string) {
  const testRouter = buildTestRouter(initialPath);
  await testRouter.load();
  render(<RouterProvider router={testRouter} />);
  await waitFor(() => {
    expect(testRouter.state.status).toBe('idle');
  });
  return testRouter;
}

describe('AppShell', () => {
  beforeEach(() => {
    seedAuthenticated();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // apps/web/vitest.config.ts sets isolate:false, sharing the module registry
    // across test files in a worker - authStore.ts's module-level `authApi`
    // singleton (swapped via setAuthApi() above) must be restored after every
    // test, or it leaks into other files (e.g. authStore.wiring.test.ts, which
    // relies on the real authApi being active).
    setAuthApi(realAuthApi);
  });

  it('renders Notes and Trash nav links pointing at /notes and /notes/trash', async () => {
    setAuthApi(makeMockAuthApi());
    await renderAt('/notes');

    expect(screen.getByRole('link', { name: 'Notes' })).toHaveAttribute('href', '/notes');
    expect(screen.getByRole('link', { name: 'Trash' })).toHaveAttribute('href', '/notes/trash');
  });

  it('calls authStore.logout() and navigates to /login when the logout button is clicked', async () => {
    const logout = vi.fn().mockResolvedValue(undefined);
    setAuthApi(makeMockAuthApi({ logout }));
    const testRouter = await renderAt('/notes');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => {
      expect(testRouter.state.location.pathname).toBe('/login');
    });
    expect(logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Login page')).toBeInTheDocument();
  });

  it('still navigates to /login when logout() rejects (session is cleared locally regardless)', async () => {
    const logout = vi.fn().mockRejectedValue(new Error('network error'));
    setAuthApi(makeMockAuthApi({ logout }));
    const testRouter = await renderAt('/notes');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));

    await waitFor(() => {
      expect(testRouter.state.location.pathname).toBe('/login');
    });
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
