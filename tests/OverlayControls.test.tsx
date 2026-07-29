/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OverlayControls from '../src/components/OverlayControls';
import type { TFunction, TranslationKey } from '../src/i18n';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const t: TFunction = (key: TranslationKey) => key;

describe('OverlayControls', () => {
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

  it('places minimize immediately before close and routes its click', async () => {
    const onMinimize = vi.fn();
    const onClose = vi.fn();
    const noop = vi.fn();

    await act(async () => {
      root.render(
        <OverlayControls
          isVisible
          isAlwaysOnTop={false}
          backgroundMode="dark"
          currentIndex={0}
          totalImages={0}
          zoom={1}
          fileName=""
          imageInfo={{
            filePath: null,
            fileSize: 0,
            width: 0,
            height: 0,
            originalExtension: null,
          }}
          t={t}
          onMinimize={onMinimize}
          onClose={onClose}
          onPrevImage={noop}
          onNextImage={noop}
          onZoomIn={noop}
          onZoomOut={noop}
          onSetZoom={noop}
          onOriginalSize={noop}
          onFitScreen={noop}
          onToggleAlwaysOnTop={noop}
          onToggleBackgroundMode={noop}
          onOpenSettings={noop}
          onRotate={noop}
          onOverlayEnter={noop}
          onOverlayLeave={noop}
        />
      );
    });

    const windowControls = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.overlay-top-right button')
    );
    expect(windowControls.at(-2)?.getAttribute('aria-label')).toBe('overlay.minimizeAria');
    expect(windowControls.at(-1)?.getAttribute('aria-label')).toBe('overlay.closeAria');

    windowControls.at(-2)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });
});
