import DOMPurify from 'dompurify';

export function sanitizeHeadline(html: string): string {
  return DOMPurify.sanitize(html, { ALLOWED_TAGS: ['mark'], ALLOWED_ATTR: [] });
}
