import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { UI_COPY } from '../../lib/uiCopy';
import { EmptyState } from './EmptyState';
import type { EmptyStateVariant } from './EmptyState';

// The 'no-notes' variant renders a <Link to="/notes/new">, so it needs a real
// router context (matching the AppShell.test.tsx / NoteCard.test.tsx pattern) -
// the other variants render plain buttons/text and can be rendered directly.

function buildTestRouter(variant: EmptyStateVariant, onClearFilters?: () => void) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (onClearFilters ? <EmptyState variant={variant} onClearFilters={onClearFilters} /> : <EmptyState variant={variant} />),
  });
  const newNoteRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/notes/new',
    component: () => <p>New note page</p>,
  });
  const routeTree = rootRoute.addChildren([homeRoute, newNoteRoute]);

  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

async function renderEmptyState(variant: EmptyStateVariant, onClearFilters?: () => void) {
  const testRouter = buildTestRouter(variant, onClearFilters);
  await testRouter.load();
  render(<RouterProvider router={testRouter} />);
  await waitFor(() => {
    expect(testRouter.state.status).toBe('idle');
  });
  return testRouter;
}

describe('EmptyState', () => {
  afterEach(() => {
    cleanup();
  });

  describe('no-notes variant', () => {
    it('renders the empty-notes-list heading and subtext', async () => {
      await renderEmptyState('no-notes');

      expect(screen.getByRole('heading', { name: UI_COPY.EMPTY_NOTES_LIST.heading })).toBeInTheDocument();
      expect(screen.getByText(UI_COPY.EMPTY_NOTES_LIST.subtext)).toBeInTheDocument();
    });

    it('renders a "Create your first note" link to /notes/new', async () => {
      await renderEmptyState('no-notes');

      const link = screen.getByRole('link', { name: UI_COPY.EMPTY_NOTES_LIST.cta });
      expect(link).toHaveAttribute('href', '/notes/new');
    });
  });

  describe('no-matches variant', () => {
    it('renders the filtered-empty heading and subtext', async () => {
      await renderEmptyState('no-matches');

      expect(screen.getByRole('heading', { name: UI_COPY.EMPTY_NOTES_FILTERED.heading })).toBeInTheDocument();
      expect(screen.getByText(UI_COPY.EMPTY_NOTES_FILTERED.subtext)).toBeInTheDocument();
    });

    it('renders a Clear-filters button that calls onClearFilters when clicked', async () => {
      const onClearFilters = vi.fn();
      await renderEmptyState('no-matches', onClearFilters);

      const button = screen.getByRole('button', { name: UI_COPY.EMPTY_NOTES_FILTERED.cta });
      button.click();

      expect(onClearFilters).toHaveBeenCalledTimes(1);
    });

    it('does not render the note-creation CTA', async () => {
      await renderEmptyState('no-matches');

      expect(screen.queryByRole('link', { name: UI_COPY.EMPTY_NOTES_LIST.cta })).not.toBeInTheDocument();
      expect(screen.queryByText(UI_COPY.EMPTY_NOTES_LIST.heading)).not.toBeInTheDocument();
    });
  });

  describe('empty-trash variant', () => {
    it('renders the empty-trash heading and subtext', async () => {
      await renderEmptyState('empty-trash');

      expect(screen.getByRole('heading', { name: UI_COPY.EMPTY_TRASH_BIN.heading })).toBeInTheDocument();
      expect(screen.getByText(UI_COPY.EMPTY_TRASH_BIN.subtext)).toBeInTheDocument();
    });

    it('renders no CTA at all', async () => {
      await renderEmptyState('empty-trash');

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });

  describe('no-search-results variant', () => {
    it('renders the empty-search-results heading and subtext', async () => {
      await renderEmptyState('no-search-results');

      expect(screen.getByRole('heading', { name: UI_COPY.EMPTY_SEARCH_RESULTS.heading })).toBeInTheDocument();
      expect(screen.getByText(UI_COPY.EMPTY_SEARCH_RESULTS.subtext)).toBeInTheDocument();
    });

    it('renders no CTA at all', async () => {
      await renderEmptyState('no-search-results');

      expect(screen.queryByRole('link')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
