/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OverlayControls from '../src/components/OverlayControls';
import type { TFunction, TranslationKey } from '../src/i18n';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const t: TFunction = (key: TranslationKey) => key;
type OverlayProps = React.ComponentProps<typeof OverlayControls>;

function createProps(overrides: Partial<OverlayProps> = {}): OverlayProps {
  const noop = vi.fn();

  return {
    activeRegion: 'none',
    feedbackDurationMs: 2000,
    isAlwaysOnTop: false,
    backgroundMode: 'dark',
    currentIndex: 0,
    totalImages: 0,
    zoom: 1,
    fileName: '',
    imageInfo: {
      filePath: null,
      fileSize: 0,
      width: 0,
      height: 0,
      originalExtension: null,
    },
    t,
    onMinimize: noop,
    onClose: noop,
    onPrevImage: noop,
    onNextImage: noop,
    onZoomIn: noop,
    onZoomOut: noop,
    onSetZoom: noop,
    onOriginalSize: noop,
    onFitScreen: noop,
    onToggleAlwaysOnTop: noop,
    onToggleBackgroundMode: noop,
    onOpenSettings: noop,
    onRotate: noop,
    ...overrides,
  };
}

const imageProps: Partial<OverlayProps> = {
  currentIndex: 0,
  totalImages: 3,
  fileName: 'first.png',
  imageInfo: {
    filePath: 'C:\\images\\first.png',
    fileSize: 2048,
    width: 1200,
    height: 800,
    originalExtension: 'png',
  },
};

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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('places minimize immediately before close and routes its click', async () => {
    const onMinimize = vi.fn();
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <OverlayControls
          {...createProps({
            activeRegion: 'top-right',
            onMinimize,
            onClose,
          })}
        />
      );
    });

    const windowControls = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.overlay-window-controls button')
    );
    expect(windowControls.at(-2)?.getAttribute('aria-label')).toBe('overlay.minimizeAria');
    expect(windowControls.at(-1)?.getAttribute('aria-label')).toBe('overlay.closeAria');

    await act(async () => windowControls.at(-2)?.click());

    expect(onMinimize).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reveals only the navigation edge being approached', async () => {
    await act(async () => {
      root.render(
        <OverlayControls {...createProps({ ...imageProps, activeRegion: 'left' })} />
      );
    });

    expect(container.querySelector('.nav-left')?.classList.contains('is-visible')).toBe(true);
    expect(container.querySelector('.nav-right')?.classList.contains('is-visible')).toBe(false);

    await act(async () => {
      root.render(
        <OverlayControls {...createProps({ ...imageProps, activeRegion: 'right' })} />
      );
    });

    expect(container.querySelector('.nav-left')?.classList.contains('is-visible')).toBe(false);
    expect(container.querySelector('.nav-right')?.classList.contains('is-visible')).toBe(true);
  });

  it('keeps the bottom HUD compact until its status is clicked', async () => {
    const onZoomOut = vi.fn();

    await act(async () => {
      root.render(
        <OverlayControls
          {...createProps({
            ...imageProps,
            activeRegion: 'bottom',
            onZoomOut,
          })}
        />
      );
    });

    const status = container.querySelector<HTMLButtonElement>('.overlay-status-button');
    expect(status?.getAttribute('aria-expanded')).toBe('false');
    expect(status?.textContent).toContain('100%');
    expect(status?.textContent).toContain('1 / 3');
    expect(container.querySelector('.overlay-bottom-row')).toBeNull();

    await act(async () => status?.click());

    expect(status?.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.overlay-bottom-row')).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="overlay.zoomOutAria"]')
        ?.click();
    });
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('keeps secondary tools behind the top-right more control', async () => {
    const onOpenSettings = vi.fn();

    await act(async () => {
      root.render(
        <OverlayControls
          {...createProps({
            activeRegion: 'top-right',
            onOpenSettings,
          })}
        />
      );
    });

    expect(container.querySelector('.overlay-more-actions')).toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="overlay.moreAria"]')
        ?.click();
    });

    expect(container.querySelector('.overlay-more-actions')).not.toBeNull();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[aria-label="overlay.settingsAria"]')
        ?.click();
    });

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.overlay-more-actions')).toBeNull();
  });

  it('shows brief action feedback after zooming or navigating without opening a toolbar', async () => {
    const baseProps = createProps({ ...imageProps });

    await act(async () => {
      root.render(<OverlayControls {...baseProps} />);
    });

    await act(async () => {
      root.render(<OverlayControls {...baseProps} zoom={1.25} />);
    });

    expect(container.querySelector('[role="status"]')?.textContent).toBe('125%');
    expect(container.querySelector('.overlay-bottom-row')).toBeNull();

    await act(async () => {
      root.render(
        <OverlayControls
          {...baseProps}
          zoom={1.25}
          currentIndex={1}
          fileName="second.png"
          imageInfo={{
            ...baseProps.imageInfo,
            filePath: 'C:\\images\\second.png',
          }}
        />
      );
    });

    const feedback = container.querySelector('[role="status"]');
    expect(feedback?.textContent).toContain('second.png');
    expect(feedback?.textContent).toContain('2 / 3');
  });

  it('removes transient feedback after the configured duration', async () => {
    vi.useFakeTimers();
    const baseProps = createProps({ ...imageProps, feedbackDurationMs: 1000 });

    await act(async () => {
      root.render(<OverlayControls {...baseProps} />);
    });

    await act(async () => {
      root.render(<OverlayControls {...baseProps} zoom={1.1} />);
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe('110%');

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
