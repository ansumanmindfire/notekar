import { describe, it, expect } from 'vitest';
import { extractPlainText } from './tiptap';

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
