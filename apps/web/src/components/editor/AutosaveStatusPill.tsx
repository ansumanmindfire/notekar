import { useEffect, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useEditorStatusStore } from '../../stores/editorStatusStore';
import { UI_COPY } from '../../lib/uiCopy';

const SAVED_AUTO_HIDE_MS = 2000;

export interface AutosaveStatusPillProps {
  onRetry: () => void;
}

// A fresh instance mounts every time status transitions into 'saved' (see the
// `status === 'saved'` branch below, which only renders this while that's
// true) - so the auto-hide timer restarts for each new save cycle without
// needing a synchronous setState in an effect to reset it.
function SavedIndicator() {
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setHidden(true), SAVED_AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, []);

  if (hidden) {
    return null;
  }
  return <span className="text-sm text-slate-500">{UI_COPY.AUTOSAVE_SAVED}</span>;
}

export function AutosaveStatusPill({ onRetry }: AutosaveStatusPillProps) {
  const status = useEditorStatusStore((state) => state.status);

  if (status === 'idle') {
    return null;
  }

  if (status === 'saving') {
    return (
      <span className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {UI_COPY.AUTOSAVE_SAVING}
      </span>
    );
  }

  if (status === 'saved') {
    return <SavedIndicator />;
  }

  return (
    <span className="flex items-center gap-2 rounded-md bg-[#fef08a] px-2 py-1 text-sm font-medium text-slate-900">
      {UI_COPY.AUTOSAVE_ERROR}
      <button
        type="button"
        onClick={onRetry}
        aria-label="Retry saving"
        className="rounded p-1 hover:bg-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/80"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}
