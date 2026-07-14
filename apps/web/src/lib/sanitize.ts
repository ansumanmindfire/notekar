import DOMPurify from 'dompurify';
import { generateHTML } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import type { TipTapDocument } from 'shared';
import { extractPlainText } from './noteExcerpt';

export function sanitizeHeadline(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] });
}

// Matches the node/mark tags NoteEditor.tsx's StarterKit configuration can
// actually produce - kept in sync manually since generateHTML has no
// "list allowed output tags" introspection of its own.
const NOTE_BODY_ALLOWED_TAGS = [
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'strong',
  'em',
  's',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'br',
  'hr',
];

const NOTE_BODY_EXTENSIONS = [StarterKit.configure({ link: false })];

export function sanitizeNoteBody(body: TipTapDocument): string {
  try {
    const html = generateHTML(body, NOTE_BODY_EXTENSIONS);
    return DOMPurify.sanitize(html, { ALLOWED_TAGS: NOTE_BODY_ALLOWED_TAGS, ALLOWED_ATTR: [] });
  } catch {
    // A body containing a node/mark type outside what NoteEditor.tsx's StarterKit
    // configuration can produce would make generateHTML throw - fall back to a
    // sanitized plain-text rendering rather than crashing the public share page.
    const text = DOMPurify.sanitize(extractPlainText(body), { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
    return `<p>${text}</p>`;
  }
}
