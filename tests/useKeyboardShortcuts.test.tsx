/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKeyboardShortcuts } from '../src/hooks/useKeyboardShortcuts';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const callbacks = () => ({
  onOpenImage: vi.fn(),
  onEscape: vi.fn(),
  onToggleFullscreen: vi.fn(),
  onPrevImage: vi.fn(),
  onNextImage: vi.fn(),
  onFirstImage: vi.fn(),
  onLastImage: vi.fn(),
  onZoomIn: vi.fn(),
  onZoomOut: vi.fn(),
  onOriginalSize: vi.fn(),
  onFitScreen: vi.fn(),
  onToggleAlwaysOnTop: vi.fn(),
  onRotate: vi.fn(),
  onCopy: vi.fn(),
  onMoveFile: vi.fn(),
  onMoveToTrash: vi.fn(),
  onSaveAs: vi.fn(),
  onRename: vi.fn(),
  onPrint: vi.fn(),
  onShowProperties: vi.fn(),
  onReload: vi.fn(),
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
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  window.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  it('routes Escape through the viewer escape contract', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers);

    const event = press('Escape');

    expect(event.defaultPrevented).toBe(true);
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
  });

  it('toggles fullscreen and prevents the browser F11 behavior', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers);

    const event = press('F11');

    expect(event.defaultPrevented).toBe(true);
    expect(handlers.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('routes one unified copy shortcut with the Windows-style file actions', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers);

    press('c', { ctrlKey: true });
    press('o', { ctrlKey: true });
    press('p', { ctrlKey: true });
    press('F2');
    press('F5');
    press('Home');
    press('End');
    press('Enter', { altKey: true });

    expect(handlers.onCopy).toHaveBeenCalledTimes(1);
    expect(handlers.onOpenImage).toHaveBeenCalledTimes(1);
    expect(handlers.onPrint).toHaveBeenCalledTimes(1);
    expect(handlers.onRename).toHaveBeenCalledTimes(1);
    expect(handlers.onReload).toHaveBeenCalledTimes(1);
    expect(handlers.onFirstImage).toHaveBeenCalledTimes(1);
    expect(handlers.onLastImage).toHaveBeenCalledTimes(1);
    expect(handlers.onShowProperties).toHaveBeenCalledTimes(1);
  });

  it('does not run shortcuts while a menu or modal disables them', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers, false);

    press('c', { ctrlKey: true });
    press('p', { ctrlKey: true });
    press('F2');
    press('Escape');
    press('F11');

    expect(handlers.onCopy).not.toHaveBeenCalled();
    expect(handlers.onPrint).not.toHaveBeenCalled();
    expect(handlers.onRename).not.toHaveBeenCalled();
    expect(handlers.onEscape).not.toHaveBeenCalled();
    expect(handlers.onToggleFullscreen).not.toHaveBeenCalled();
  });

  it('keeps Escape and F11 global when a toolbar control has focus', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers);
    const button = document.createElement('button');
    container.append(button);

    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    const fullscreen = new KeyboardEvent('keydown', {
      key: 'F11',
      bubbles: true,
      cancelable: true,
    });
    button.dispatchEvent(escape);
    button.dispatchEvent(fullscreen);

    expect(escape.defaultPrevented).toBe(true);
    expect(fullscreen.defaultPrevented).toBe(true);
    expect(handlers.onEscape).toHaveBeenCalledTimes(1);
    expect(handlers.onToggleFullscreen).toHaveBeenCalledTimes(1);
  });

  it('suppresses repeated Escape and F11 events without rerunning actions', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers);

    const escape = press('Escape', { repeat: true });
    const fullscreen = press('F11', { repeat: true });

    expect(escape.defaultPrevented).toBe(true);
    expect(fullscreen.defaultPrevented).toBe(true);
    expect(handlers.onEscape).not.toHaveBeenCalled();
    expect(handlers.onToggleFullscreen).not.toHaveBeenCalled();
  });

  it('preserves native keyboard behavior inside interactive controls', async () => {
    const handlers = callbacks();
    await renderShortcuts(handlers);
    const button = document.createElement('button');
    const label = document.createElement('span');
    button.append(label);
    container.append(button);

    label.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    button.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })
    );

    expect(handlers.onNextImage).not.toHaveBeenCalled();
    expect(handlers.onCopy).not.toHaveBeenCalled();
  });
});
