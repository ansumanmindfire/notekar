import { describe, it, expect } from 'vitest';
import { extractPlainText, truncate } from './noteExcerpt';

describe('extractPlainText', () => {
  it('extracts concatenated text from a realistic single-paragraph doc, ignoring marks', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello' },
            { type: 'text', text: ' world', marks: [{ type: 'bold' }] },
          ],
        },
      ],
    };

    expect(extractPlainText(doc)).toBe('Hello world');
  });

  it('separates text from adjacent paragraphs with a space rather than gluing them together', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First paragraph' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second paragraph' }],
        },
      ],
    };

    const result = extractPlainText(doc);

    expect(result).toBe('First paragraph Second paragraph');
  });

  it('returns an empty string for an empty doc', () => {
    const doc = { type: 'doc', content: [] };

    expect(extractPlainText(doc)).toBe('');
  });

  it('extracts text from deeply nested bulletList > listItem > paragraph > text', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'First item' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Second item' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = extractPlainText(doc);

    expect(result).toBe('First item Second item');
  });

  it('extracts text from a heading followed by a paragraph, separated by a space', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Title' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Body text' }],
        },
      ],
    };

    expect(extractPlainText(doc)).toBe('Title Body text');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty array', []],
    ['an empty object', {}],
    ['a plain string', 'a plain string'],
    ['a number', 42],
  ])('returns an empty string without throwing for %s', (_label, input) => {
    expect(() => extractPlainText(input)).not.toThrow();
    expect(extractPlainText(input)).toBe('');
  });

  it('returns an empty string for a doc missing the content field entirely', () => {
    const doc = { type: 'doc' };

    expect(extractPlainText(doc)).toBe('');
  });

  it('skips a node whose text field is not a string, rather than crashing or coercing it', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'text', text: 123 }],
    };

    expect(() => extractPlainText(doc)).not.toThrow();
    expect(extractPlainText(doc)).toBe('');
  });

  it('does not throw when content is not an array, and returns an empty string', () => {
    const doc = { type: 'doc', content: 'not-an-array' };

    expect(() => extractPlainText(doc)).not.toThrow();
    expect(extractPlainText(doc)).toBe('');
  });
});

describe('truncate', () => {
  it('returns the text unchanged (no ellipsis) when text length exactly equals maxLength', () => {
    const text = 'exactly ten';
    expect(text.length).toBe(11);

    const result = truncate(text, 11);

    expect(result).toBe('exactly ten');
  });

  it('returns the text unchanged when text is under the maxLength', () => {
    const result = truncate('short', 50);

    expect(result).toBe('short');
  });

  it('truncates over-limit text, trims trailing whitespace, and appends an ellipsis', () => {
    const result = truncate('This is a long piece of text that must be cut', 10);

    expect(result).toBe('This is a…');
    expect(result.endsWith('…')).toBe(true);
  });

  it('trims trailing whitespace before appending the ellipsis when the cut lands mid-space', () => {
    const result = truncate('Hello     world of notes', 9);

    expect(result).toBe('Hello…');
  });
});
