/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmptyView from '../src/components/EmptyView';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const t = (key: string) => key;

describe('EmptyView', () => {
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

  it('opens from the button without bubbling mouse down into window drag', async () => {
    const onOpenImage = vi.fn();
    const parentMouseDown = vi.fn();

    await act(async () => {
      root.render(
        <div onMouseDown={parentMouseDown}>
          <EmptyView t={t} onOpenImage={onOpenImage} />
        </div>
      );
    });

    const button = container.querySelector('button');
    expect(button).not.toBeNull();

    button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(parentMouseDown).not.toHaveBeenCalled();
    expect(onOpenImage).toHaveBeenCalledTimes(1);
  });

  it('opens when the empty surface is double-clicked', async () => {
    const onOpenImage = vi.fn();

    await act(async () => {
      root.render(<EmptyView t={t} onOpenImage={onOpenImage} />);
    });

    container
      .querySelector('.empty-view')
      ?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(onOpenImage).toHaveBeenCalledTimes(1);
  });
});
