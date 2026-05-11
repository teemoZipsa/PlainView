import { useEffect, useCallback } from 'react';

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
}

export function useKeyboardShortcuts(props: KeyboardShortcutsProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Avoid shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          props.onClose();
          break;
        case 'ArrowLeft':
        case 'Backspace':
          e.preventDefault();
          props.onPrevImage();
          break;
        case 'ArrowRight':
        case ' ': // Space
          e.preventDefault();
          props.onNextImage();
          break;
        case '+':
        case '=':
          e.preventDefault();
          props.onZoomIn();
          break;
        case '-':
          e.preventDefault();
          props.onZoomOut();
          break;
        case '0':
          e.preventDefault();
          props.onOriginalSize();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          props.onFitScreen();
          break;
        case 't':
        case 'T':
          e.preventDefault();
          props.onToggleAlwaysOnTop();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          props.onRotate();
          break;
      }
    },
    [props]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
