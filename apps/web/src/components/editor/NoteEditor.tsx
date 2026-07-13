import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect } from 'react';
import type { TipTapDocument } from 'shared';

export interface NoteEditorProps {
  content: TipTapDocument;
  onUpdate: (content: TipTapDocument) => void;
  onEditorReady?: (editor: Editor | null) => void;
}

export function NoteEditor({ content, onUpdate, onEditorReady }: NoteEditorProps) {
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false })],
    content,
    onUpdate: ({ editor: updatedEditor }) => {
      onUpdate(updatedEditor.getJSON());
    },
    editorProps: {
      attributes: {
        class: 'prose-editor',
      },
    },
  });

  useEffect(() => {
    onEditorReady?.(editor);
    return () => onEditorReady?.(null);
  }, [editor, onEditorReady]);

  return <EditorContent editor={editor} />;
}
