/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WindowResizeHandles, {
  canStartWindowResize,
} from '../src/components/WindowResizeHandles';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const expectedHandles = [
  ['North', 'north'],
  ['NorthEast', 'north-east'],
  ['East', 'east'],
  ['SouthEast', 'south-east'],
  ['South', 'south'],
  ['SouthWest', 'south-west'],
  ['West', 'west'],
  ['NorthWest', 'north-west'],
] as const;

describe('WindowResizeHandles', () => {
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

  it('allows resizing only after native state is ready in normal window mode', () => {
    expect(
      canStartWindowResize({ ready: true, isFullscreen: false, isMaximized: false })
    ).toBe(true);
    expect(
      canStartWindowResize({ ready: false, isFullscreen: false, isMaximized: false })
    ).toBe(false);
    expect(
      canStartWindowResize({ ready: true, isFullscreen: true, isMaximized: false })
    ).toBe(false);
    expect(
      canStartWindowResize({ ready: true, isFullscreen: false, isMaximized: true })
    ).toBe(false);
  });

  it('renders all eight directions with the existing resize class names', async () => {
    await act(async () => {
      root.render(<WindowResizeHandles onResizeStart={vi.fn()} />);
    });

    const handles = Array.from(
      container.querySelectorAll<HTMLDivElement>('.window-resize-handle')
    );

    expect(handles).toHaveLength(expectedHandles.length);
    expectedHandles.forEach(([, className], index) => {
      expect(handles[index]?.className).toBe(
        `window-resize-handle resize-${className}`
      );
      expect(handles[index]?.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('prevents and stops each left press before routing the exact direction', async () => {
    const onResizeStart = vi.fn();
    const onParentMouseDown = vi.fn();

    await act(async () => {
      root.render(
        <div onMouseDown={onParentMouseDown}>
          <WindowResizeHandles onResizeStart={onResizeStart} />
        </div>
      );
    });

    for (const [direction, className] of expectedHandles) {
      const event = new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        cancelable: true,
      });

      await act(async () => {
        container
          .querySelector<HTMLDivElement>(`.resize-${className}`)
          ?.dispatchEvent(event);
      });

      expect(event.defaultPrevented).toBe(true);
      expect(onResizeStart).toHaveBeenLastCalledWith(direction);
    }

    expect(onResizeStart).toHaveBeenCalledTimes(expectedHandles.length);
    expect(onParentMouseDown).not.toHaveBeenCalled();
  });

  it.each([
    ['middle', 1],
    ['right', 2],
  ])('ignores a %s-button press without consuming it', async (_label, button) => {
    const onResizeStart = vi.fn();
    const onParentMouseDown = vi.fn();

    await act(async () => {
      root.render(
        <div onMouseDown={onParentMouseDown}>
          <WindowResizeHandles onResizeStart={onResizeStart} />
        </div>
      );
    });

    const event = new MouseEvent('mousedown', {
      bubbles: true,
      button,
      cancelable: true,
    });

    await act(async () => {
      container.querySelector<HTMLDivElement>('.resize-north')?.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(onResizeStart).not.toHaveBeenCalled();
    expect(onParentMouseDown).toHaveBeenCalledTimes(1);
  });
});
