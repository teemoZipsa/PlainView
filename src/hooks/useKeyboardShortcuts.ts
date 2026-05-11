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
}

export function useKeyboardShortcuts(props: KeyboardShortcutsProps) {
  // Store callbacks in a ref so the listener never needs to be re-attached.
  // The ref always points to the latest callbacks from the current render.
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid shortcuts when typing in inputs
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const p = propsRef.current;

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
