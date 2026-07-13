import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { Note, Page, TagWithCount } from 'shared';
import { UI_COPY } from '../../lib/uiCopy';
import { useNotesViewStore } from '../../stores/notesViewStore';

// AB-1011 task T32 - NotesListPage wires together the notes-view store
// (sort/tagIds/page), the min-loading-time-gated skeleton, TagFilterBar,
// SortSelect, and Pagination against the real (mocked-at-the-network-boundary)
// TanStack Query hooks. NoteCard/EmptyState/TagFilterBar/SortSelect/Pagination's
// own rendering details are covered by their dedicated test files; this file
// asserts the page-level wiring: which params reach `listNotes`, and that
// interacting with each control re-triggers it with updated params.
//
// NOTE on timing: useMinLoadingTime.ts holds the skeleton for a minimum of
// 200ms (MIN_LOADING_MS) *after* data has already arrived, via a passive
// effect that fires one commit after the "loaded" render. That means there is
// a genuine one-commit window where the real content is briefly visible
// before the hook's effect flips back to the skeleton for the remainder of
// the 200ms hold. `settleMinLoadingTime()` waits past that whole
// hold-then-reveal cycle with a real timer so assertions observe the final,
// stable DOM instead of racing it.
const MIN_LOADING_SETTLE_MS = 300;

async function settleMinLoadingTime() {
  await new Promise((resolve) => setTimeout(resolve, MIN_LOADING_SETTLE_MS));
}

vi.mock('../../lib/notesApi', () => ({
  listNotes: vi.fn(),
  listTags: vi.fn(),
  listTrash: vi.fn(),
  restoreNote: vi.fn(),
  getNote: vi.fn(),
}));

import { listNotes, listTags } from '../../lib/notesApi';
import { NotesListPage } from './NotesListPage';

const mockListNotes = vi.mocked(listNotes);
const mockListTags = vi.mocked(listTags);

const STORE_INITIAL_STATE = {
  sort: 'createdAt:desc' as const,
  tagIds: [] as string[],
  page: 1,
};

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'note-1',
    title: 'My Note',
    body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body text' }] }] },
    tagIds: [],
    version: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-01T12:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeNotesPage(overrides: Partial<Page<Note>> = {}): Page<Note> {
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
    component: () => <NotesListPage />,
  });
  const newNoteRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes/new',
    component: () => <p>New note page</p>,
  });
  const noteDetailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes/$noteId',
    component: () => <p>Note detail</p>,
  });
  const routeTree = rootRoute.addChildren([homeRoute, newNoteRoute, noteDetailRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

async function renderNotesListPage() {
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
  await settleMinLoadingTime();
  return { testRouter, queryClient };
}

describe('NotesListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotesViewStore.setState(
      {
        ...STORE_INITIAL_STATE,
        setSort: useNotesViewStore.getState().setSort,
        toggleTag: useNotesViewStore.getState().toggleTag,
        clearTagFilter: useNotesViewStore.getState().clearTagFilter,
        setPage: useNotesViewStore.getState().setPage,
      },
      true,
    );
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the no-notes empty state when there are no tag filters and totalItems is 0', async () => {
    mockListNotes.mockResolvedValue(makeNotesPage());
    mockListTags.mockResolvedValue(makeTagsPage());

    await renderNotesListPage();

    expect(screen.getByRole('heading', { name: UI_COPY.EMPTY_NOTES_LIST.heading })).toBeInTheDocument();
  });

  it('renders NoteCards for the fetched notes once loading settles, replacing the skeleton', async () => {
    mockListNotes.mockResolvedValue(
      makeNotesPage({
        items: [makeNote({ id: 'note-1', title: 'First Note' }), makeNote({ id: 'note-2', title: 'Second Note' })],
        totalItems: 2,
        totalPages: 1,
      }),
    );
    mockListTags.mockResolvedValue(makeTagsPage());

    await renderNotesListPage();

    expect(screen.getByRole('heading', { name: 'First Note' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Second Note' })).toBeInTheDocument();
    // Skeleton and content are mutually exclusive render branches - once the
    // cards are visible there should be no leftover skeleton placeholders.
    expect(document.querySelectorAll('.animate-pulse').length).toBe(0);
  });

  it('selecting a different sort option re-fetches with the new sort and resets to page 1', async () => {
    mockListNotes.mockImplementation(async (params) =>
      makeNotesPage({
        items: [makeNote()],
        page: params.page,
        totalItems: 20,
        totalPages: 3,
      }),
    );
    mockListTags.mockResolvedValue(makeTagsPage());

    await renderNotesListPage();
    expect(screen.getByRole('heading', { name: 'My Note' })).toBeInTheDocument();

    // Move off page 1 first, so we can prove the sort change resets it.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await settleMinLoadingTime();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Sort notes'), { target: { value: 'updatedAt:asc' } });
    await settleMinLoadingTime();

    const lastCall = mockListNotes.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({ sort: 'updatedAt:asc', tagIds: [], page: 1, pageSize: 10 });
  });

  it('clicking a tag chip re-fetches with the updated tagIds and resets to page 1', async () => {
    mockListNotes.mockImplementation(async (params) =>
      makeNotesPage({
        items: [makeNote()],
        page: params.page,
        totalItems: 20,
        totalPages: 3,
      }),
    );
    mockListTags.mockResolvedValue(makeTagsPage([{ id: 'tag-1', name: 'Work', color: 'blue', noteCount: 5 }]));

    await renderNotesListPage();
    expect(screen.getByRole('heading', { name: 'My Note' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await settleMinLoadingTime();
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    await settleMinLoadingTime();

    const lastCall = mockListNotes.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({ sort: 'createdAt:desc', tagIds: ['tag-1'], page: 1, pageSize: 10 });
  });

  it('clicking Pagination "Next" re-fetches with page + 1', async () => {
    mockListNotes.mockImplementation(async (params) =>
      makeNotesPage({
        items: [makeNote()],
        page: params.page,
        totalItems: 20,
        totalPages: 3,
      }),
    );
    mockListTags.mockResolvedValue(makeTagsPage());

    await renderNotesListPage();
    expect(screen.getByRole('heading', { name: 'My Note' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await settleMinLoadingTime();

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    const lastCall = mockListNotes.mock.calls.at(-1)?.[0];
    expect(lastCall).toEqual({ sort: 'createdAt:desc', tagIds: [], page: 2, pageSize: 10 });
  });
});
