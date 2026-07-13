import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { EditorToolbar } from './EditorToolbar';

function TestHarness({ onEditor }: { onEditor: (editor: Editor) => void }) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false })],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  });

  if (editor) {
    onEditor(editor);
  }

  return (
    <>
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </>
  );
}

describe('EditorToolbar', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('renders nothing when editor is null', () => {
    const { container } = render(<EditorToolbar editor={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('clicking Bold toggles the bold mark on the editor', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      editorRef!.chain().focus().setTextSelection(1).run();
    });

    act(() => {
      screen.getByLabelText('Bold').click();
    });

    expect(editorRef!.isActive('bold')).toBe(true);
  });

  it('clicking H2 toggles a level-2 heading', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      screen.getByLabelText('Heading 2').click();
    });

    expect(editorRef!.isActive('heading', { level: 2 })).toBe(true);
  });

  it('clicking Bullet List toggles a bullet list', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      screen.getByLabelText('Bullet List').click();
    });

    expect(editorRef!.isActive('bulletList')).toBe(true);
  });

  it('clicking Ordered List toggles an ordered list', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      screen.getByLabelText('Ordered List').click();
    });

    expect(editorRef!.isActive('orderedList')).toBe(true);
  });

  it('clicking Blockquote toggles a blockquote', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      screen.getByLabelText('Blockquote').click();
    });

    expect(editorRef!.isActive('blockquote')).toBe(true);
  });

  it('clicking Code Block toggles a code block', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      screen.getByLabelText('Code Block').click();
    });

    expect(editorRef!.isActive('codeBlock')).toBe(true);
  });

  it('clicking Redo re-applies a change that was just undone', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      editorRef!.chain().focus().insertContent('Hello').selectAll().run();
    });
    act(() => {
      screen.getByLabelText('Bold').click();
    });
    act(() => {
      screen.getByLabelText('Undo').click();
    });
    expect(editorRef!.isActive('bold')).toBe(false);

    act(() => {
      screen.getByLabelText('Redo').click();
    });

    expect(editorRef!.isActive('bold')).toBe(true);
  });

  it('reflects active formatting state via aria-pressed', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    expect(screen.getByLabelText('Bold')).toHaveAttribute('aria-pressed', 'false');

    act(() => {
      screen.getByLabelText('Bold').click();
    });

    await waitFor(() => expect(screen.getByLabelText('Bold')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('history buttons (Undo/Redo) have no aria-pressed state', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    expect(screen.getByLabelText('Undo')).not.toHaveAttribute('aria-pressed');
    expect(screen.getByLabelText('Redo')).not.toHaveAttribute('aria-pressed');
  });

  it('clicking Undo reverts the last formatting change', async () => {
    let editorRef: Editor | null = null;
    render(<TestHarness onEditor={(editor) => (editorRef = editor)} />);
    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      editorRef!.chain().focus().insertContent('Hello').selectAll().run();
    });
    act(() => {
      screen.getByLabelText('Bold').click();
    });
    expect(editorRef!.isActive('bold')).toBe(true);

    act(() => {
      screen.getByLabelText('Undo').click();
    });

    expect(editorRef!.isActive('bold')).toBe(false);
  });
});
