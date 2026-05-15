import { useEffect, useRef } from 'react';

interface KeyboardShortcutsProps {
  onClose: () => void;
  onPrevImage: () => void;
  onNextImage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onOriginalSize: () => void;
  onFitScreen: () => void;
  onToggleAlwaysOnTop: () => void;
  onRotate: () => void;
  canCopyImage: () => boolean;
  onCopyImage: () => void;
  onMoveFile: () => void;
  isEnabled?: () => boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
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

function isMoveShortcut(e: KeyboardEvent): boolean {
  return (
    e.key.toLowerCase() === 'm' &&
    (e.ctrlKey || e.metaKey) &&
    !e.altKey &&
    !e.shiftKey
  );
}

export function useKeyboardShortcuts(props: KeyboardShortcutsProps) {
  // Store callbacks in a ref so the listener never needs to be re-attached.
  // The ref always points to the latest callbacks from the current render.
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid shortcuts when typing in inputs
      if (isEditableTarget(e.target)) {
        return;
      }

      const p = propsRef.current;

      if (p.isEnabled && !p.isEnabled()) {
        return;
      }

      if (isCopyShortcut(e)) {
        if (p.canCopyImage()) {
          e.preventDefault();
          p.onCopyImage();
        }
        return;
      }

      if (isMoveShortcut(e)) {
        e.preventDefault();
        p.onMoveFile();
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
