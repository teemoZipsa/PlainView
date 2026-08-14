interface DialogKeyboardEvent {
  key: string;
  shiftKey: boolean;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not(:disabled)',
  'input:not(:disabled)',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function handleDialogKeyDown(
  event: DialogKeyboardEvent,
  dialog: HTMLElement,
  onClose: () => void
): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    onClose();
    return;
  }

  if (event.key !== 'Tab') return;

  const focusable = Array.from(
    dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((element) => !element.hidden && element.getAttribute('aria-hidden') !== 'true');

  if (focusable.length === 0) {
    event.preventDefault();
    dialog.focus({ preventScroll: true });
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const target = event.target instanceof HTMLElement ? event.target : document.activeElement;
  const targetIsInside = target instanceof Node && dialog.contains(target);

  if (event.shiftKey && (!targetIsInside || target === first || target === dialog)) {
    event.preventDefault();
    last.focus({ preventScroll: true });
  } else if (!event.shiftKey && (!targetIsInside || target === last || target === dialog)) {
    event.preventDefault();
    first.focus({ preventScroll: true });
  }
}
