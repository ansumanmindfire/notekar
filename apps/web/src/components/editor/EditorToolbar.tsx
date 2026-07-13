import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Undo,
  Redo,
} from 'lucide-react';

export interface EditorToolbarProps {
  editor: Editor | null;
}

interface ToolbarButtonConfig {
  key: string;
  label: string;
  icon: typeof Bold;
  isActive?: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const FORMATTING_BUTTONS: ToolbarButtonConfig[] = [
  {
    key: 'bold',
    label: 'Bold',
    icon: Bold,
    isActive: (editor) => editor.isActive('bold'),
    run: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    key: 'italic',
    label: 'Italic',
    icon: Italic,
    isActive: (editor) => editor.isActive('italic'),
    run: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    key: 'strike',
    label: 'Strikethrough',
    icon: Strikethrough,
    isActive: (editor) => editor.isActive('strike'),
    run: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    key: 'h1',
    label: 'Heading 1',
    icon: Heading1,
    isActive: (editor) => editor.isActive('heading', { level: 1 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run(),
  },
  {
    key: 'h2',
    label: 'Heading 2',
    icon: Heading2,
    isActive: (editor) => editor.isActive('heading', { level: 2 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  {
    key: 'h3',
    label: 'Heading 3',
    icon: Heading3,
    isActive: (editor) => editor.isActive('heading', { level: 3 }),
    run: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  {
    key: 'bulletList',
    label: 'Bullet List',
    icon: List,
    isActive: (editor) => editor.isActive('bulletList'),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    key: 'orderedList',
    label: 'Ordered List',
    icon: ListOrdered,
    isActive: (editor) => editor.isActive('orderedList'),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    key: 'blockquote',
    label: 'Blockquote',
    icon: Quote,
    isActive: (editor) => editor.isActive('blockquote'),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    key: 'codeBlock',
    label: 'Code Block',
    icon: Code,
    isActive: (editor) => editor.isActive('codeBlock'),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
];

const HISTORY_BUTTONS: ToolbarButtonConfig[] = [
  {
    key: 'undo',
    label: 'Undo',
    icon: Undo,
    run: (editor) => editor.chain().focus().undo().run(),
  },
  {
    key: 'redo',
    label: 'Redo',
    icon: Redo,
    run: (editor) => editor.chain().focus().redo().run(),
  },
];

function ToolbarButton({ editor, isActive, config }: { editor: Editor; isActive: boolean; config: ToolbarButtonConfig }) {
  const Icon = config.icon;

  return (
    <button
      type="button"
      aria-label={config.label}
      aria-pressed={config.isActive ? isActive : undefined}
      onClick={() => config.run(editor)}
      className={`rounded-md p-2 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/80 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${
        isActive ? 'bg-slate-200 text-slate-900' : 'text-slate-600'
      }`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function useActiveStates(editor: Editor | null): Record<string, boolean> {
  const states = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) {
        return {};
      }
      const result: Record<string, boolean> = {};
      for (const config of FORMATTING_BUTTONS) {
        result[config.key] = config.isActive?.(current) ?? false;
      }
      return result;
    },
  });
  return states ?? {};
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const activeStates = useActiveStates(editor);

  if (!editor) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-2">
      {FORMATTING_BUTTONS.map((config) => (
        <ToolbarButton key={config.key} editor={editor} isActive={activeStates[config.key] ?? false} config={config} />
      ))}
      <div className="mx-1 h-5 w-px bg-slate-200" />
      {HISTORY_BUTTONS.map((config) => (
        <ToolbarButton key={config.key} editor={editor} isActive={false} config={config} />
      ))}
    </div>
  );
}
