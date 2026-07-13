// Client-side mirror of apps/api/src/lib/tiptap.ts's walk/BLOCK_NODE_TYPES logic -
// kept independent (no cross-package import; apps/api isn't a dependency of apps/web).
const BLOCK_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'codeBlock',
  'horizontalRule',
]);

interface TipTapNodeShape {
  type?: unknown;
  text?: unknown;
  content?: unknown;
}

function isTipTapNodeShape(value: unknown): value is TipTapNodeShape {
  return typeof value === 'object' && value !== null;
}

function walk(node: unknown, parts: string[]): void {
  if (!isTipTapNodeShape(node)) {
    return;
  }

  if (typeof node.text === 'string') {
    parts.push(node.text);
  }

  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      walk(child, parts);
    }
  }

  if (typeof node.type === 'string' && BLOCK_NODE_TYPES.has(node.type)) {
    parts.push(' ');
  }
}

export function extractPlainText(body: unknown): string {
  try {
    const parts: string[] = [];
    walk(body, parts);
    return parts.join('').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength).trimEnd()}…`;
}
