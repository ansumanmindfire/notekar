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
import type { Note, TagWithCount } from 'shared';
import { NoteCard } from './NoteCard';

// AB-1011 task T18 — NoteCard renders real content via noteExcerpt.ts's actual
// extractPlainText/truncate (not mocked), so this also incidentally exercises
// that TipTap-JSON-to-plain-text walk against a realistic document shape.

const NOTE_ID = 'note-123';

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: NOTE_ID,
    title: 'My Test Note',
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'This is the body of the note used for the excerpt preview.' }],
        },
      ],
    },
    tagIds: ['tag-1'],
    version: 1,
    createdAt: '2026-07-10T12:00:00.000Z',
    updatedAt: '2026-07-12T12:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

function makeTags(): TagWithCount[] {
  return [
    { id: 'tag-1', name: 'Work', color: 'blue', noteCount: 3 },
    { id: 'tag-2', name: 'Personal', color: 'green', noteCount: 1 },
  ];
}

function buildTestRouter(note: Note, tags: TagWithCount[], timestampField: 'createdAt' | 'updatedAt') {
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <NoteCard note={note} tags={tags} timestampField={timestampField} />,
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

async function renderNoteCard(
  note: Note,
  tags: TagWithCount[] = makeTags(),
  timestampField: 'createdAt' | 'updatedAt' = 'createdAt',
) {
  const testRouter = buildTestRouter(note, tags, timestampField);
  await testRouter.load();
  render(<RouterProvider router={testRouter} />);
  await waitFor(() => {
    expect(testRouter.state.status).toBe('idle');
  });
  return testRouter;
}

describe('NoteCard', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders the note title', async () => {
    await renderNoteCard(makeNote());

    expect(screen.getByRole('heading', { name: 'My Test Note' })).toBeInTheDocument();
  });

  it('renders a truncated plain-text excerpt extracted from the TipTap body', async () => {
    const note = makeNote({
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'a'.repeat(200) }],
          },
        ],
      },
    });

    await renderNoteCard(note);

    const expectedExcerpt = `${'a'.repeat(160)}…`;
    expect(screen.getByText(expectedExcerpt)).toBeInTheDocument();
  });

  it('renders only the tags whose id is included in note.tagIds', async () => {
    await renderNoteCard(makeNote({ tagIds: ['tag-1'] }));

    expect(screen.getByText('Work')).toBeInTheDocument();
    expect(screen.queryByText('Personal')).not.toBeInTheDocument();
  });

  it('renders a "Created" relative timestamp when timestampField is createdAt', async () => {
    await renderNoteCard(makeNote(), makeTags(), 'createdAt');

    expect(screen.getByText(/^Created /)).toBeInTheDocument();
  });

  it('renders an "Updated" relative timestamp when timestampField is updatedAt', async () => {
    await renderNoteCard(makeNote(), makeTags(), 'updatedAt');

    expect(screen.getByText(/^Updated /)).toBeInTheDocument();
  });

  it('links to /notes/$noteId with the note\'s id resolved in the href', async () => {
    await renderNoteCard(makeNote());

    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', `/notes/${NOTE_ID}`);
  });
});
