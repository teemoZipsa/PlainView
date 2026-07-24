/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../src/hooks/useKeyboardShortcuts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const callbacks = () => ({
  onClose: vi.fn(),
  onPrevImage: vi.fn(),
  onNextImage: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onOriginalSize: vi.fn(),
  onFitScreen: vi.fn(),
  onToggleAlwaysOnTop: vi.fn(),
  onRotate: vi.fn(),
  onCopyImage: vi.fn(),
  onCopyFile: vi.fn(),
  onMoveFile: vi.fn(),
  onMoveToTrash: vi.fn(),
  onSaveAs: vi.fn(),
  onRename: vi.fn(),
  onPrint: vi.fn(),
  onShowProperties: vi.fn(),
});

type ShortcutCallbacks = ReturnType<typeof callbacks>;

function ShortcutHarness({
  handlers,
  enabled = true,
}: {
  handlers: ShortcutCallbacks;
  enabled?: boolean;
}) {
  useKeyboardShortcuts({
    ...handlers,
    isEnabled: () => enabled,
  });
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function renderShortcuts(handlers: ShortcutCallbacks, enabled = true) {
  await act(async () => {
    root.render(<ShortcutHarness handlers={handlers} enabled={enabled} />);
  });
}

function press(key: string, options: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...options }));
}

describe('useKeyboardShortcuts', () => {
  it('routes the new Windows-style file actions without conflicting with image copy', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers);

    press('c', { ctrlKey: true });
    press('c', { ctrlKey: true, shiftKey: true });
    press('p', { ctrlKey: true });
    press('F2');
    press('Enter', { altKey: true });

    expect(handlers.onCopyImage).toHaveBeenCalledTimes(1);
    expect(handlers.onCopyFile).toHaveBeenCalledTimes(1);
    expect(handlers.onPrint).toHaveBeenCalledTimes(1);
    expect(handlers.onRename).toHaveBeenCalledTimes(1);
    expect(handlers.onShowProperties).toHaveBeenCalledTimes(1);
  });

  it('does not run shortcuts while a menu or modal disables them', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers, false);

    press('c', { ctrlKey: true, shiftKey: true });
    press('p', { ctrlKey: true });
    press('F2');

    expect(handlers.onCopyFile).not.toHaveBeenCalled();
    expect(handlers.onPrint).not.toHaveBeenCalled();
    expect(handlers.onRename).not.toHaveBeenCalled();
  });
});
