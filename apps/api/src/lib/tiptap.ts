// Best-effort extraction, feeding Note.bodyText for future search (AB-1007) -
// any non-conforming shape yields '' rather than throwing a save-blocking error.
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

  // Insert a separator after each block-level node closes, so text from
  // adjacent paragraphs/headings doesn't get glued together.
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
