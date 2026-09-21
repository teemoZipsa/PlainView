import { useLayoutEffect, useRef, type RefObject } from 'react';

export interface DialogFocusOptions {
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}

/** Give dialogs real DOM focus, then restore it after their controls unmount. */
export function useDialogFocus({ returnFocusRef, fallbackFocusRef }: DialogFocusOptions) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    if (restoreTimerRef.current !== null) clearTimeout(restoreTimerRef.current);
    const opener = returnFocusRef?.current ?? document.activeElement;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(
      'input:not(:disabled), select:not(:disabled), button:not(:disabled), [href]'
    );
    (first ?? dialog)?.focus({ preventScroll: true });

    return () => {
      restoreTimerRef.current = setTimeout(() => {
        // A subsequently opened dialog owns focus now.
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        const target = opener instanceof HTMLElement && opener !== document.body && opener.isConnected &&
          !opener.closest('[hidden], [inert]') && getComputedStyle(opener).visibility !== 'hidden'
          ? opener
          : fallbackFocusRef?.current;
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, [fallbackFocusRef, returnFocusRef]);

  return dialogRef;
}
