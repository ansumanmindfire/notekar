import { describe, expect, it } from 'vitest';
import { sanitizeHeadline } from './sanitize';

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
