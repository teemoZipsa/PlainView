import { useEffect, useRef } from 'react';

interface KeyboardShortcutsProps {
  onOpenImage: () => void;
  onClose: () => void;
  onPrevImage: () => void;
  onNextImage: () => void;
  onFirstImage: () => void;
  onLastImage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOriginalSize: () => void;
  onFitScreen: () => void;
  onToggleAlwaysOnTop: () => void;
  onRotate: () => void;
  onCopy: () => void;
  onMoveFile: () => void;
  onMoveToTrash: () => void;
  onSaveAs: () => void;
  onRename: () => void;
  onPrint: () => void;
  onShowProperties: () => void;
  onReload: () => void;
  isEnabled?: () => boolean;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  return Boolean(
    target.closest(
      'button, a[href], input, textarea, select, [contenteditable="true"], [role="button"], [role="menuitem"]'
    )
  );
}

function isCopyShortcut(e: KeyboardEvent): boolean {
  return (
    e.key.toLowerCase() === 'c' &&
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    !e.shiftKey
  );
}

function isOpenShortcut(e: KeyboardEvent): boolean {
  return (
    e.key.toLowerCase() === 'o' &&
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    !e.shiftKey
  );
}

function isMoveShortcut(e: KeyboardEvent): boolean {
  return (
    e.key.toLowerCase() === 'm' &&
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    !e.shiftKey
  );
}

function isSaveShortcut(e: KeyboardEvent): boolean {
  return (
    e.key.toLowerCase() === 's' &&
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    !e.shiftKey
  );
}

function isPrintShortcut(e: KeyboardEvent): boolean {
  return (
    e.key.toLowerCase() === 'p' &&
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    !e.shiftKey
  );
}

function isPropertiesShortcut(e: KeyboardEvent): boolean {
  return e.key === 'Enter' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
}

export function useKeyboardShortcuts(props: KeyboardShortcutsProps) {
  // Store callbacks in a ref so the listener never needs to be re-attached.
  // The ref always points to the latest callbacks from the current render.
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Let focused controls keep their native keyboard behavior. In
      // particular, Space must activate a button instead of navigating.
      if (isInteractiveTarget(e.target)) {
        return;
      }

      const p = propsRef.current;

      if (p.isEnabled && !p.isEnabled()) {
        return;
      }

      if (isOpenShortcut(e)) {
        e.preventDefault();
        p.onOpenImage();
        return;
      }

      if (isCopyShortcut(e)) {
        e.preventDefault();
        p.onCopy();
        return;
      }

      if (isMoveShortcut(e)) {
        e.preventDefault();
        p.onMoveFile();
        return;
      }

      if (isSaveShortcut(e)) {
        e.preventDefault();
        p.onSaveAs();
        return;
      }

      if (isPrintShortcut(e)) {
        e.preventDefault();
        p.onPrint();
        return;
      }

      if (isPropertiesShortcut(e)) {
        e.preventDefault();
        p.onShowProperties();
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          p.onClose();
          break;
        case 'ArrowLeft':
        case 'Backspace':
          e.preventDefault();
          p.onPrevImage();
          break;
        case 'Delete':
          e.preventDefault();
          p.onMoveToTrash();
          break;
        case 'F2':
          e.preventDefault();
          p.onRename();
          break;
        case 'F5':
          e.preventDefault();
          p.onReload();
          break;
        case 'Home':
          e.preventDefault();
          p.onFirstImage();
          break;
        case 'End':
          e.preventDefault();
          p.onLastImage();
          break;
        case 'ArrowRight':
        case ' ': // Space
          e.preventDefault();
          p.onNextImage();
          break;
        case '+':
        case '=':
          e.preventDefault();
          p.onZoomIn();
          break;
        case '-':
          e.preventDefault();
          p.onZoomOut();
          break;
        case '0':
          e.preventDefault();
          p.onOriginalSize();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          p.onFitScreen();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          p.onToggleAlwaysOnTop();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          p.onRotate();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []); // Listener registered once; propsRef always has latest callbacks
}
