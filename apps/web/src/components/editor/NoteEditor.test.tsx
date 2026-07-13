import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '@tiptap/react';
import { NoteEditor } from './NoteEditor';

const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

describe('NoteEditor', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('mounts with the given initial content', async () => {
    const onUpdate = vi.fn();
    let editorRef: Editor | null = null;

    render(
      <NoteEditor
        content={emptyDoc}
        onUpdate={onUpdate}
        onEditorReady={(editor) => {
          editorRef = editor;
        }}
      />,
    );

    await waitFor(() => expect(editorRef).not.toBeNull());
    expect(editorRef!.getJSON()).toEqual(emptyDoc);
  });

  it('calls onUpdate with the current TipTap JSON document when the content changes', async () => {
    const onUpdate = vi.fn();
    let editorRef: Editor | null = null;

    render(
      <NoteEditor
        content={emptyDoc}
        onUpdate={onUpdate}
        onEditorReady={(editor) => {
          editorRef = editor;
        }}
      />,
    );

    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      editorRef!.chain().focus().insertContent('Hello').run();
    });

    expect(onUpdate).toHaveBeenCalled();
    const lastCall = onUpdate.mock.calls.at(-1)?.[0];
    expect(JSON.stringify(lastCall)).toContain('Hello');
  });

  it('reverts the last change when the undo command runs', async () => {
    const onUpdate = vi.fn();
    let editorRef: Editor | null = null;

    render(
      <NoteEditor
        content={emptyDoc}
        onUpdate={onUpdate}
        onEditorReady={(editor) => {
          editorRef = editor;
        }}
      />,
    );

    await waitFor(() => expect(editorRef).not.toBeNull());

    act(() => {
      editorRef!.chain().focus().insertContent('Hello').run();
    });
    expect(JSON.stringify(editorRef!.getJSON())).toContain('Hello');

    act(() => {
      editorRef!.chain().focus().undo().run();
    });

    expect(JSON.stringify(editorRef!.getJSON())).not.toContain('Hello');
  });
});
