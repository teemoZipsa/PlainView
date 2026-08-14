import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';
import type { TFunction } from '../i18n';

export const EMPTY_CONTEXT_MENU_ESTIMATED_HEIGHT = 85;

interface EmptyContextMenuProps {
  menuRef: RefObject<HTMLDivElement | null>;
  x: number;
  y: number;
  t: TFunction;
  onOpenImage: () => void;
  onShowAbout: () => void;
  onDismiss: () => void;
}

export default function EmptyContextMenu({
  menuRef,
  x,
  y,
  t,
  onOpenImage,
  onShowAbout,
  onDismiss,
}: EmptyContextMenuProps) {
  const firstItemRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    firstItemRef.current?.focus({ preventScroll: true });
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
      return;
    }

    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;

    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('.context-menu-item')
    ).filter((item) => !item.disabled);
    if (items.length === 0) return;

    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = 0;
    if (event.key === 'End') {
      nextIndex = items.length - 1;
    } else if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    } else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) {
      nextIndex = currentIndex < 0
        ? items.length - 1
        : (currentIndex - 1 + items.length) % items.length;
    }
    items[nextIndex]?.focus();
  };

  return (
    <div
      ref={menuRef}
      className="context-menu empty-context-menu"
      style={{ left: x, top: y }}
      role="menu"
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={handleKeyDown}
      onWheel={(event) => event.stopPropagation()}
    >
      <button
        ref={firstItemRef}
        className="context-menu-item"
        type="button"
        role="menuitem"
        onClick={onOpenImage}
      >
        <span>{t('empty.openImage')}</span>
        <kbd className="context-menu-shortcut" aria-hidden="true">Ctrl+O</kbd>
      </button>

      <div className="context-menu-divider" role="separator" />

      <button
        className="context-menu-item"
        type="button"
        role="menuitem"
        onClick={onShowAbout}
      >
        <span>{t('menu.about')}</span>
      </button>
    </div>
  );
}
