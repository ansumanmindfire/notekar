import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory, createRouter } from '@tanstack/react-router';
import { router as appRouter } from './router';
import type { AuthApi } from '../stores/authStore';
import { realAuthApi, setAuthApi, useAuthStore } from '../stores/authStore';

// AB-1010 task 4.6 — beforeLoad guard-redirect behavior for the code-based route
// tree (spec scenarios 8 & 9: authenticated users are redirected off /login,
// /register and /forgot-password to /notes; unauthenticated users are redirected
// off /notes to /login). Also covers `/`'s unconditional status-based redirect.
//
// AB-1011 extends this file with the same guard coverage for the three new
// routes this ticket adds (`/notes/trash`, `/notes/$noteId`, `/notes/new`).
// Those routes (and `/notes` itself, since AB-1011) fetch data via TanStack
// Query, so `../lib/notesApi` is mocked below with immediately-resolving
// fixtures — the goal here is only to exercise `beforeLoad` redirect guards,
// not real data-fetching behavior (that's covered by NotesListPage.test.tsx /
// TrashListPage.test.tsx).
//
// AB-1013 extends this file with the unauthenticated-redirect guard for the new
// `/search` route (its `beforeLoad` uses the same `status !== 'authenticated'`
// check as every other protected route). SearchPage never calls `search()` on
// this path — its query is gated on a non-empty trimmed query, and the redirect
// fires before SearchPage ever mounts — so no `search` fixture is needed in the
// mock factory below.
//
// Each test builds its own Router instance (same `routeTree` the app uses, via
// `appRouter.routeTree`) backed by a fresh `createMemoryHistory`, so tests never
// share navigation history. A fresh `QueryClient` is likewise constructed per
// test (see `beforeEach` below) so cached query results never leak across
// tests. `useAuthStore` state is seeded directly to 'authenticated' /
// 'unauthenticated' (never left 'idle') so `root.tsx`'s `beforeLoad` — which
// only calls `authStore.bootstrap()` once per module load, via a module-level
// `bootstrapPromise` singleton — is never exercised here; that keeps these
// tests independent of each other regardless of run order. The
// idle -> bootstrap -> redirect path through the router itself is covered
// separately below, in exactly one test, since the `bootstrapPromise` singleton
// in root.tsx would only resolve `bootstrap()` once per test-file lifetime — a
// second 'idle'-seeded test in this same file would find it already
// resolved-and-cached and silently skip re-invoking the mocked `authApi.refresh()`.
// `bootstrap()`'s own internal logic (accessToken/user/status transitions on
// resolve vs. reject) is unit-tested directly against the store, independent of
// the router, in `authStore.test.ts`.

vi.mock('../lib/notesApi');

import { listNotes, listTags, listTrash, getNote, restoreNote } from '../lib/notesApi';

const emptyNotesPage = { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 0 };
const emptyTagsPage = { items: [], page: 1, pageSize: 50, totalItems: 0, totalPages: 0 };
const fixtureNote = {
  id: 'abc123',
  title: 'Guard Test Note',
  body: { type: 'doc', content: [] },
  tagIds: [],
  version: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

vi.mocked(listNotes).mockResolvedValue(emptyNotesPage);
vi.mocked(listTags).mockResolvedValue(emptyTagsPage);
vi.mocked(listTrash).mockResolvedValue(emptyNotesPage);
vi.mocked(getNote).mockResolvedValue(fixtureNote);
vi.mocked(restoreNote).mockResolvedValue(fixtureNote);

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

function seedAuthStatus(status: 'idle' | 'authenticated' | 'unauthenticated'): void {
  useAuthStore.setState(
    {
      ...INITIAL_STATE,
      status,
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

let queryClient: QueryClient;

beforeEach(() => {
  // Fresh per test so cached TanStack Query results from one guard test (e.g.
  // the mocked /notes/$noteId fixture) never leak into another via the shared
  // module-level cache a single QueryClient instance would otherwise have.
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
});

async function renderAt(initialPath: string) {
  const testRouter = createTestRouter(initialPath);
  await testRouter.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={testRouter} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(testRouter.state.status).toBe('idle');
  });
  return testRouter;
}

describe('router route guards', () => {
  beforeEach(() => {
    // Bootstrap never has a reason to run in this suite (status is always seeded
    // to a settled value up front), but a never-resolving mock keeps any
    // accidental invocation from hanging a test instead of silently misreporting.
    setAuthApi(makeMockAuthApi());
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

  describe('authenticated user', () => {
    beforeEach(() => {
      seedAuthStatus('authenticated');
    });

    it('is redirected from /login to /notes', async () => {
      const testRouter = await renderAt('/login');

      expect(testRouter.state.location.pathname).toBe('/notes');
      expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    });

    it('is redirected from /register to /notes', async () => {
      const testRouter = await renderAt('/register');

      expect(testRouter.state.location.pathname).toBe('/notes');
      expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    });

    it('is redirected from /forgot-password to /notes', async () => {
      const testRouter = await renderAt('/forgot-password');

      expect(testRouter.state.location.pathname).toBe('/notes');
      expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    });

    it('stays on /notes (no redirect)', async () => {
      const testRouter = await renderAt('/notes');

      expect(testRouter.state.location.pathname).toBe('/notes');
      expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    });

    it('stays on /notes/trash (no redirect)', async () => {
      const testRouter = await renderAt('/notes/trash');

      expect(testRouter.state.location.pathname).toBe('/notes/trash');
      expect(await screen.findByRole('heading', { name: 'Trash' })).toBeInTheDocument();
    });

    it('stays on /notes/$noteId (no redirect)', async () => {
      const testRouter = await renderAt('/notes/abc123');

      expect(testRouter.state.location.pathname).toBe('/notes/abc123');
      expect(await screen.findByDisplayValue('Guard Test Note')).toBeInTheDocument();
    });

    it('stays on /notes/new (no redirect)', async () => {
      const testRouter = await renderAt('/notes/new');

      expect(testRouter.state.location.pathname).toBe('/notes/new');
      expect(await screen.findByLabelText('Title')).toHaveValue('');
    });

    it('lands on /notes when navigating to /', async () => {
      const testRouter = await renderAt('/');

      expect(testRouter.state.location.pathname).toBe('/notes');
      expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
    });
  });

  describe('unauthenticated user', () => {
    beforeEach(() => {
      seedAuthStatus('unauthenticated');
    });

    it('is redirected from /notes to /login', async () => {
      const testRouter = await renderAt('/notes');

      expect(testRouter.state.location.pathname).toBe('/login');
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });

    it('is redirected from /notes/trash to /login', async () => {
      const testRouter = await renderAt('/notes/trash');

      expect(testRouter.state.location.pathname).toBe('/login');
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });

    it('is redirected from /notes/$noteId to /login', async () => {
      const testRouter = await renderAt('/notes/abc123');

      expect(testRouter.state.location.pathname).toBe('/login');
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });

    it('is redirected from /notes/new to /login', async () => {
      const testRouter = await renderAt('/notes/new');

      expect(testRouter.state.location.pathname).toBe('/login');
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });

    it('is redirected from /search to /login', async () => {
      const testRouter = await renderAt('/search');

      expect(testRouter.state.location.pathname).toBe('/login');
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });

    it('stays on /login (no redirect), rendering the login form', async () => {
      const testRouter = await renderAt('/login');

      expect(testRouter.state.location.pathname).toBe('/login');
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });

    it('stays on /register (no redirect), rendering the register form', async () => {
      const testRouter = await renderAt('/register');

      expect(testRouter.state.location.pathname).toBe('/register');
      expect(await screen.findByRole('heading', { name: 'Create account' })).toBeInTheDocument();
    });

    it('stays on /forgot-password (no redirect), rendering the forgot-password form', async () => {
      const testRouter = await renderAt('/forgot-password');

      expect(testRouter.state.location.pathname).toBe('/forgot-password');
      expect(await screen.findByRole('heading', { name: 'Forgot password' })).toBeInTheDocument();
    });

    it('lands on /login when navigating to /', async () => {
      const testRouter = await renderAt('/');

      expect(testRouter.state.location.pathname).toBe('/login');
      expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument();
    });
  });

  // This is the ONLY test in this file (and in the whole suite) that seeds
  // status: 'idle'. root.tsx's beforeLoad guards this branch behind a
  // module-level `bootstrapPromise` singleton that only ever resolves once per
  // test-file module lifetime — a second 'idle'-seeded test here would find
  // `bootstrapPromise` already resolved-and-cached from this test and silently
  // skip re-invoking the mocked `authApi.refresh()`. No other test in this file
  // seeds 'idle' (they all seed an already-settled 'authenticated' /
  // 'unauthenticated' status), so none of them ever reach that branch — this
  // test's position in the file (and its run order relative to the others) is
  // therefore irrelevant to their correctness.
  describe('idle user (root beforeLoad bootstrap path)', () => {
    it('awaits bootstrap() in root beforeLoad before the child route guard runs, landing on the post-bootstrap route', async () => {
      seedAuthStatus('idle');
      setAuthApi(
        makeMockAuthApi({
          refresh: vi.fn().mockResolvedValue({ accessToken: 'tok' }),
        }),
      );

      // notesRoute's own beforeLoad redirects to /login whenever
      // status !== 'authenticated' (see routes/notes.tsx). If root's beforeLoad
      // did not actually await bootstrapPromise before letting the child route's
      // guard run, status would still read 'idle' here and we would land on
      // /login instead of /notes.
      const testRouter = await renderAt('/notes');

      expect(testRouter.state.location.pathname).toBe('/notes');
      expect(await screen.findByRole('heading', { name: 'Notes' })).toBeInTheDocument();
      expect(useAuthStore.getState().status).toBe('authenticated');
      expect(useAuthStore.getState().status).not.toBe('idle');

      // Not asserted here: root.tsx's `pendingComponent` ("Loading…"). TanStack
      // Router only swaps in a route's pendingComponent once the load exceeds
      // `defaultPendingMs` (1000ms real time, unconfigured/default in
      // routes/router.tsx), so reliably observing it would require either a real
      // 1s+ delay before resolving the mocked refresh() (slow) or fake timers
      // interleaved with the router's internal async scheduling (flaky/complex
      // given TanStack Router's own timer usage). The beforeLoad-await path this
      // gap is actually about (root.tsx lines 12-14) is fully exercised above.
    });
  });
});
