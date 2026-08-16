/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WindowResizeHandles from '../src/components/WindowResizeHandles';
import { getWindowResizeDirection } from '../src/windowResize';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

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
  });

  it('renders a native direction target for every edge and corner', async () => {
    await act(async () => {
      root.render(<WindowResizeHandles />);
    });

    const expectedDirections = [
      'North',
      'NorthEast',
      'East',
      'SouthEast',
      'South',
      'SouthWest',
      'West',
      'NorthWest',
    ];

    expect(
      Array.from(container.querySelectorAll('[data-resize-direction]')).map((element) =>
        element.getAttribute('data-resize-direction')
      )
    ).toEqual(expectedDirections);
    expect(
      Array.from(container.querySelectorAll('[data-resize-direction]')).every(
        (element) => element.getAttribute('aria-hidden') === 'true'
      )
    ).toBe(true);
  });

  it('leaves non-primary mouse actions available to the viewer surface', async () => {
    const parentMouseDown = vi.fn();

    await act(async () => {
      root.render(
        <div onMouseDown={parentMouseDown}>
          <WindowResizeHandles />
        </div>
      );
    });

    container
      .querySelector('[data-resize-direction="East"]')
      ?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 2 }));

    expect(parentMouseDown).toHaveBeenCalledTimes(1);
  });

  it('keeps generous L-shaped corner zones ahead of single-axis edges', () => {
    expect(getWindowResizeDirection(400, 4, 800, 600)).toBe('North');
    expect(getWindowResizeDirection(12, 4, 800, 600)).toBe('NorthWest');
    expect(getWindowResizeDirection(4, 12, 800, 600)).toBe('NorthWest');
    expect(getWindowResizeDirection(788, 4, 800, 600)).toBe('NorthEast');
    expect(getWindowResizeDirection(796, 588, 800, 600)).toBe('SouthEast');
    expect(getWindowResizeDirection(12, 12, 800, 600)).toBeNull();
    expect(getWindowResizeDirection(400, 300, 800, 600)).toBeNull();
  });
});
