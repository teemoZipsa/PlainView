/** @vitest-environment jsdom */

import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EmptyContextMenu from '../src/components/EmptyContextMenu';
import type { TFunction } from '../src/i18n';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const t: TFunction = (key) => key;

describe('EmptyContextMenu', () => {
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

  async function renderMenu() {
    const onOpenImage = vi.fn();
    const onShowAbout = vi.fn();
    const onDismiss = vi.fn();

    await act(async () => {
      root.render(
        <EmptyContextMenu
          menuRef={createRef<HTMLDivElement>()}
          x={12}
          y={24}
          t={t}
          onOpenImage={onOpenImage}
          onShowAbout={onShowAbout}
          onDismiss={onDismiss}
        />
      );
    });

    return { onOpenImage, onShowAbout, onDismiss };
  }

  it('shows and focuses the image-open action', async () => {
    const { onOpenImage } = await renderMenu();
    const button = container.querySelector<HTMLButtonElement>('button');

    expect(button?.textContent).toBe('empty.openImageCtrl+O');
    expect(document.activeElement).toBe(button);

    await act(async () => button?.click());
    expect(onOpenImage).toHaveBeenCalledTimes(1);
  });

  it('moves to and opens app info from the empty state menu', async () => {
    const { onShowAbout } = await renderMenu();
    const menu = container.querySelector<HTMLElement>('.context-menu');
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('button'));

    await act(async () => {
      menu?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      );
    });

    expect(document.activeElement).toBe(buttons[1]);
    expect(buttons[1]?.textContent).toBe('menu.about');

    await act(async () => buttons[1]?.click());
    expect(onShowAbout).toHaveBeenCalledTimes(1);
  });

  it('dismisses with Escape without opening the image picker', async () => {
    const { onOpenImage, onDismiss } = await renderMenu();
    const button = container.querySelector<HTMLButtonElement>('button');

    await act(async () => {
      button?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onOpenImage).not.toHaveBeenCalled();
  });
});
