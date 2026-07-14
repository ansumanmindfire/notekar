import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import type { Note, SearchResultItem, TagWithCount } from 'shared';
import { SearchResultCard } from './SearchResultCard';

// AB-1013 - SearchResultCard mirrors NoteCard.tsx's shape (title, tag chips,
// relative timestamp, Link to the note detail route) but additionally renders
// the server-supplied highlighted `headline` via dangerouslySetInnerHTML, so
// (unlike NoteCard) it must be proven to run that markup through
// sanitizeHeadline before it ever reaches the DOM.

const NOTE_ID = 'note-123';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_ID,
    title: 'My Test Note',
    body: { type: 'doc', content: [] },
    tagIds: ['tag-1'],
    version: 1,
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<SearchResultItem> = {}): SearchResultItem {
  return {
    note: makeNote(),
    headline: 'This is a <mark>matching</mark> headline',
    ...overrides,
  };
}

function makeTags(): TagWithCount[] {
  return [
    { id: 'tag-1', name: 'Work', color: 'blue', noteCount: 3 },
    { id: 'tag-2', name: 'Personal', color: 'green', noteCount: 1 },
  ];
}

function buildTestRouter(result: SearchResultItem, tags: TagWithCount[]) {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <SearchResultCard result={result} tags={tags} />,
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

async function renderSearchResultCard(
  result: SearchResultItem = makeResult(),
  tags: TagWithCount[] = makeTags(),
) {
  const testRouter = buildTestRouter(result, tags);
  await testRouter.load();
  render(<RouterProvider router={testRouter} />);
  await waitFor(() => {
    expect(testRouter.state.status).toBe('idle');
  });
  return testRouter;
}

describe('SearchResultCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the note title as plain text', async () => {
    await renderSearchResultCard();

    expect(screen.getByRole('heading', { name: 'My Test Note' })).toBeInTheDocument();
  });

  it('renders the sanitized headline markup, preserving safe <mark> highlight tags', async () => {
    await renderSearchResultCard(makeResult({ headline: 'Some <mark>highlighted</mark> text' }));

    const mark = screen.getByText('highlighted');
    expect(mark.tagName).toBe('MARK');
    expect(screen.getByText(/Some/)).toBeInTheDocument();
  });

  it('strips disallowed markup and attributes from the headline before rendering it', async () => {
    await renderSearchResultCard(
      makeResult({ headline: '<script>alert(1)</script><mark onclick="alert(2)">safe</mark>' }),
    );

    expect(document.querySelector('script')).not.toBeInTheDocument();
    const mark = screen.getByText('safe');
    expect(mark.tagName).toBe('MARK');
    expect(mark).not.toHaveAttribute('onclick');
  });

  it('renders only the tags whose id is included in note.tagIds', async () => {
    await renderSearchResultCard(makeResult({ note: makeNote({ tagIds: ['tag-1'] }) }));

    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.queryByText('Personal')).not.toBeInTheDocument();
  });

  it('renders no tag chips when note.tagIds is empty', async () => {
    await renderSearchResultCard(makeResult({ note: makeNote({ tagIds: [] }) }));

    expect(screen.queryByText('Work')).not.toBeInTheDocument();
    expect(screen.queryByText('Personal')).not.toBeInTheDocument();
  });

  it('renders an "Updated" relative timestamp derived from note.updatedAt', async () => {
    await renderSearchResultCard();

    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
  });

  it("links to /notes/$noteId with the note's id resolved in the href", async () => {
    await renderSearchResultCard();

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `/notes/${NOTE_ID}`);
  });
});
