import * as RadixDialog from '@radix-ui/react-dialog';
import type { ReactNode, RefObject } from 'react';

export const Dialog = RadixDialog.Root;
export const DialogTitle = RadixDialog.Title;

interface DialogContentProps {
  children: ReactNode;
  className?: string;
  /** Forces autofocus onto a specific element (e.g. Cancel) instead of Radix's
   * default of focusing the dialog content div itself - see docs/UX.md §5. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

export function DialogContent({ children, className = '', initialFocusRef }: DialogContentProps) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 bg-slate-900/50" />
      <RadixDialog.Content
        className={`fixed left-1/2 top-1/2 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl ${className}`}
        onOpenAutoFocus={(event) => {
          if (initialFocusRef?.current) {
            event.preventDefault();
            initialFocusRef.current.focus();
          }
        }}
      >
        {/* Visually-hidden - satisfies Radix's Description requirement without
         * introducing a visible subtitle every caller would otherwise need to pass. */}
        <RadixDialog.Description className="sr-only">Dialog</RadixDialog.Description>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
