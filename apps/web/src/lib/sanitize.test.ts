import { describe, expect, it, vi } from 'vitest';
import type { TipTapDocument } from 'shared';

const mockGenerateHTML = vi.hoisted(() => vi.fn());

// Delegates to the real generateHTML by default (so the "normal doc" test below
// exercises the actual @tiptap/core + StarterKit pipeline), while letting
// individual tests override the return value/throw behavior to simulate output
// sanitizeNoteBody could never otherwise be handed via well-formed TipTap JSON -
// see AB-1014 plan.md risk #1/#2.
vi.mock('@tiptap/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tiptap/core')>();
  mockGenerateHTML.mockImplementation(actual.generateHTML);
  return { ...actual, generateHTML: mockGenerateHTML };
});

import { sanitizeHeadline, sanitizeNoteBody } from './sanitize';

// AB-1013 - search headlines come back from the server with <mark> tags wrapped
// around the matched terms (packages/shared's ts_headline-backed search). Per
// AGENTS.md §11/UX conventions this is user-derived rich content and must never
// reach dangerouslySetInnerHTML unsanitized - sanitizeHeadline is the sole gate
// for that, restricted to the single safe tag actually used for highlighting.

describe('sanitizeHeadline', () => {
  it('passes a clean <mark> tag through unchanged', () => {
    expect(sanitizeHeadline('This is a <mark>match</mark> in context')).toBe(
      'This is a <mark>match</mark> in context',
    );
  });

  it('strips <script> tags, event-handler attributes, and any malformed/nested markup, while preserving safe <mark> tags and their text', () => {
    const dirty =
      '<script>alert(1)</script><mark onerror="alert(2)">foo<mark>bar</svg><img src=x onerror="alert(3)">';

    const clean = sanitizeHeadline(dirty);

    expect(clean).not.toContain('<script');
    expect(clean).not.toContain('script>');
    expect(clean).not.toContain('onerror');
    expect(clean).not.toContain('<img');
    expect(clean).not.toContain('<svg');
    expect(clean).not.toContain('alert(');
    // The safe <mark> wrapper(s) and the matched text inside them must survive -
    // only the disallowed tag/attribute soup around them is stripped.
    expect(clean).toContain('<mark>');
    expect(clean).toContain('foo');
    expect(clean).toContain('bar');
  });

  it('drops every attribute from an otherwise-allowed <mark> tag', () => {
    const clean = sanitizeHeadline('<mark class="hack" style="color:red" onclick="alert(1)">hit</mark>');

    expect(clean).toBe('<mark>hit</mark>');
  });
});

// AB-1014 - the public share page (PublicSharePage.tsx) renders a note's TipTap
// JSON body for an unauthenticated visitor. Per AGENTS.md §11 this is
// user-generated rich content and must never reach dangerouslySetInnerHTML
// unsanitized - sanitizeNoteBody is the sole gate for that.
describe('sanitizeNoteBody', () => {
  const doc: TipTapDocument = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Hello ' },
          { type: 'text', text: 'world', marks: [{ type: 'bold' }] },
        ],
      },
    ],
  };

  it('renders a normal TipTap document into its allowed HTML tags', () => {
    const html = sanitizeNoteBody(doc);

    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>world</strong>');
    expect(html).toContain('Hello');
  });

  it('strips a <script> tag and an event-handler attribute smuggled through generateHTML output', () => {
    mockGenerateHTML.mockReturnValueOnce(
      '<p>safe</p><script>alert(1)</script><p onclick="alert(2)">click</p>',
    );

    const html = sanitizeNoteBody(doc);

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('alert(');
    expect(html).toContain('safe');
    expect(html).toContain('click');
  });

  it('falls back to sanitized plain text when generateHTML throws on a malformed/unknown node type', () => {
    mockGenerateHTML.mockImplementationOnce(() => {
      throw new Error('Unknown node type');
    });
    const malformed: TipTapDocument = {
      type: 'doc',
      content: [
        {
          type: 'notARealNodeType',
          content: [{ type: 'text', text: 'Hello <script>alert(1)</script>' }],
        },
      ],
    };

    const html = sanitizeNoteBody(malformed);

    expect(html).toContain('<p>');
    expect(html).toContain('Hello');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(');
  });
});
