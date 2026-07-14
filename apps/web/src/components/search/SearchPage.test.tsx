import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { Note, Page, SearchResultItem, TagWithCount } from 'shared';
import { UI_COPY } from '../../lib/uiCopy';

// AB-1013 - SearchPage wires the debounced query input to useSearchQuery,
// resets pagination back to page 1 whenever the (debounced) query itself
// changes, and renders the idle prompt / skeleton / empty-state / results
// branches. The debounce timing itself is unit-tested directly against
// useDebouncedValue.test.ts; this file proves SearchPage integrates it
// correctly (one settled request per debounce window, not one per keystroke).
//
// NOTE on timing: this file mixes two timing mechanisms that cannot both be
// driven the same way -
//   1) the initial router mount (`renderSearchPage`) uses REAL timers, so the
//      existing project convention (`waitFor` polling with real setTimeout,
//      as in NotesListPage.test.tsx/TrashListPage.test.tsx) works unmodified.
//   2) every interaction *after* that switches to `vi.useFakeTimers()` so the
//      400ms debounce and the 200ms useMinLoadingTime hold can be advanced
//      deterministically. `waitFor` is deliberately never used once fake
//      timers are active: @testing-library/dom's `jestFakeTimersAreEnabled()`
//      check only recognizes a global `jest`, not Vitest's `vi`, so under
//      Vitest `waitFor` would poll via a *real* `setInterval` that fake timers
//      have replaced with a fake one — it would never fire and the test would
//      hang until the outer test timeout. Instead, mirroring
//      useAutosave.test.ts's deferred-promise pattern, pending mock promises
//      are captured directly off `mockSearch.mock.results` and awaited inside
//      `act(async () => { ... })`, which is what actually flushes the
//      resulting state updates.
const DEBOUNCE_MS = 400;
const MIN_LOADING_HOLD_MS = 250;

vi.mock('../../lib/notesApi');

import { listTags, search } from '../../lib/notesApi';
import { SearchPage } from './SearchPage';

const mockSearch = vi.mocked(search);
const mockListTags = vi.mocked(listTags);

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'A Matching Note',
    body: { type: 'doc', content: [] },
    tagIds: [],
    version: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeSearchItem(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    note: makeNote(),
    headline: 'A <mark>match</mark>',
    ...overrides,
  };
}

function makeSearchPage(overrides: Partial<Page<SearchResultItem>> = {}): Page<SearchResultItem> {
  return {
    items: [],
    page: 1,
    pageSize: 10,
    totalItems: 0,
    totalPages: 0,
    ...overrides,
  };
}

function makeTagsPage(items: TagWithCount[] = []): Page<TagWithCount> {
  return { items, page: 1, pageSize: 50, totalItems: items.length, totalPages: 1 };
}

function buildTestRouter() {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <SearchPage />,
  });
  const noteDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes/$noteId',
    component: () => <p>Note detail</p>,
  });
  const routeTree = rootRoute.addChildren([homeRoute, noteDetailRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

async function renderSearchPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const testRouter = buildTestRouter();
  await testRouter.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={testRouter} />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    expect(testRouter.state.status).toBe('idle');
  });
  return { testRouter, queryClient };
}

/** Advances the fake-timer debounce window, then flushes the resulting act queue. */
async function advanceDebounce() {
  await act(async () => {
    vi.advanceTimersByTime(DEBOUNCE_MS);
  });
}

/** Awaits the most recently returned `search()` mock promise inside an act flush. */
async function flushLatestSearchCall() {
  const pending = mockSearch.mock.results.at(-1)?.value;
  await act(async () => {
    await pending;
  });
}

/** Advances past useMinLoadingTime's post-load hold so skeleton -> real content settles. */
async function settleMinLoadingHold() {
  await act(async () => {
    vi.advanceTimersByTime(MIN_LOADING_HOLD_MS);
  });
}

describe('SearchPage', () => {
  beforeEach(() => {
    mockListTags.mockResolvedValue(makeTagsPage());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('shows the idle prompt and fires no search request when the input is empty', async () => {
    await renderSearchPage();

    expect(screen.getByRole('heading', { name: UI_COPY.SEARCH_IDLE_PROMPT.heading })).toBeInTheDocument();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it('fires exactly one search call with the fully-settled value after typing, not one per keystroke', async () => {
    mockSearch.mockResolvedValue(makeSearchPage());
    await renderSearchPage();
    vi.useFakeTimers();

    const input = screen.getByLabelText('Search notes');
    fireEvent.change(input, { target: { value: 'h' } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: 'he' } });
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.change(input, { target: { value: 'hello' } });

    expect(mockSearch).not.toHaveBeenCalled();

    await advanceDebounce();

    expect(mockSearch).toHaveBeenCalledTimes(1);
    expect(mockSearch).toHaveBeenCalledWith({ q: 'hello', page: 1, pageSize: 10 });
  });

  it('renders the no-search-results empty state (with no CTA) once a query resolves with zero results', async () => {
    mockSearch.mockResolvedValue(makeSearchPage({ items: [], totalItems: 0, totalPages: 0 }));
    await renderSearchPage();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'nomatch' } });
    await advanceDebounce();
    await flushLatestSearchCall();
    await settleMinLoadingHold();

    expect(screen.getByRole('heading', { name: UI_COPY.EMPTY_SEARCH_RESULTS.heading })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('resets the next request to page 1 when the query changes while on a later page', async () => {
    mockSearch.mockImplementation(async (params) =>
      makeSearchPage({ items: [makeSearchItem()], page: params.page, totalItems: 25, totalPages: 3 }),
    );
    await renderSearchPage();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'first' } });
    await advanceDebounce();
    await flushLatestSearchCall();
    await settleMinLoadingHold();
    expect(mockSearch).toHaveBeenLastCalledWith({ q: 'first', page: 1, pageSize: 10 });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await flushLatestSearchCall();
    await settleMinLoadingHold();
    expect(mockSearch).toHaveBeenLastCalledWith({ q: 'first', page: 2, pageSize: 10 });

    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'second' } });
    await advanceDebounce();
    await flushLatestSearchCall();
    await settleMinLoadingHold();

    expect(mockSearch).toHaveBeenLastCalledWith({ q: 'second', page: 1, pageSize: 10 });
  });

  it('paginating via the Pagination component keeps the same query and changes only the page', async () => {
    mockSearch.mockImplementation(async (params) =>
      makeSearchPage({ items: [makeSearchItem()], page: params.page, totalItems: 25, totalPages: 3 }),
    );
    await renderSearchPage();
    vi.useFakeTimers();

    fireEvent.change(screen.getByLabelText('Search notes'), { target: { value: 'hello' } });
    await advanceDebounce();
    await flushLatestSearchCall();
    await settleMinLoadingHold();
    expect(mockSearch).toHaveBeenLastCalledWith({ q: 'hello', page: 1, pageSize: 10 });

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await flushLatestSearchCall();
    await settleMinLoadingHold();

    expect(mockSearch).toHaveBeenLastCalledWith({ q: 'hello', page: 2, pageSize: 10 });
    expect(mockSearch).toHaveBeenCalledTimes(2);
  });
});
