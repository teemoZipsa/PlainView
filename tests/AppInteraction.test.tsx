/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({ path: null as string | null }));
const invoke = vi.hoisted(() => vi.fn(async (command: string, _args?: unknown) =>
  command === 'append_file_to_clipboard' ? { imageAvailable: true, fileAvailable: true } : null));
const newClipboardImage = vi.hoisted(() => vi.fn(async (_pixels: Uint8Array, _width: number, _height: number) => ({ close: async () => {} })));
vi.mock('@tauri-apps/api/image', () => ({ Image: { new: newClipboardImage } }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeImage: async () => {}, writeText: async () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => null, save: async () => 'C:/audit/saved.png' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: async () => false, isMaximized: async () => false,
    onCloseRequested: async () => () => {}, onResized: async () => () => {},
    onFocusChanged: async () => () => {}, onMoved: async () => () => {},
    onDragDropEvent: async () => () => {}, center: async () => {},
  }),
}));
vi.mock('../src/hooks/useImageLoader', () => {
  const loader = {
    loadSettings: async () => ({ rememberWindowPosition: false, backgroundMode: 'dark', locale: 'ko',
      defaultFitMode: 'auto', loopNavigation: true, overlayHideDelayMs: 2000, customOpenApps: [] }),
    saveSettings: async () => {},
    getCliArgs: async () => fixture.path ? ['plainview', fixture.path] : ['plainview'],
    scanFolder: async () => ['C:/audit/1.png', 'C:/audit/2.png'],
    loadImage: async (path: string) => {
      if (path.endsWith('.heic')) throw { kind: 'unsupported_heic', message: 'unsupported' };
      return { src: 'data:image/png;base64,fixture', filePath: path, fileName: path.split('/').pop(),
        fileSize: 100, naturalWidth: 1200, naturalHeight: 800, originalExtension: 'png', isTemporarySource: false };
    },
    preloadImages: async () => {}, invalidateImage: () => {}, isImageStale: async () => false,
  };
  return { useImageLoader: () => loader };
});

let container: HTMLDivElement;
let root: Root;
const settle = async () => act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
async function press(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options }));
  });
  await settle();
}
async function mount() {
  await act(async () => root.render(<App />));
  await settle();
  await settle();
}

beforeEach(() => {
  fixture.path = null;
  invoke.mockClear();
  newClipboardImage.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  await settle();
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('viewer interaction flows', () => {
  it('opens settings from the empty screen, closes with Escape, and restores focus', async () => {
    await mount();
    const opener = container.querySelector<HTMLButtonElement>('.empty-utility-button')!;
    await act(async () => { opener.focus(); opener.click(); });
    expect(document.activeElement?.id).toBe('settings-language');
    await press('Escape');
    expect(container.querySelector('.settings-modal')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(invoke.mock.calls.some((call: unknown[]) => call[0] === 'destroy_window')).toBe(false);
  });

  it('opens help and settings by keyboard without closing the app', async () => {
    await mount();
    const viewer = container.querySelector<HTMLElement>('.image-container')!;
    viewer.focus();
    await press('F1');
    expect(document.activeElement).toBe(container.querySelector('.shortcuts-close'));
    await press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(container.querySelector('.shortcuts-list'));
    await press('Escape');
    expect(document.activeElement).toBe(viewer);
    await press(',', { ctrlKey: true });
    expect(document.activeElement?.id).toBe('settings-language');
    await press('Escape');
    expect(document.activeElement).toBe(viewer);
  });

  it('cycles both ways through controls and skips image tools on the empty screen', async () => {
    await mount();
    const viewer = container.querySelector<HTMLElement>('.image-container')!;
    viewer.focus();
    await press('F6');
    expect(document.activeElement).toBe(container.querySelector('.more-btn'));
    await press('F6');
    expect(document.activeElement).toBe(viewer);
    await press('F6', { shiftKey: true });
    expect(document.activeElement).toBe(container.querySelector('.more-btn'));
  });

  it('lets the modal own Escape when it was opened over the expanded tools', async () => {
    await mount();
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press('F6');
    await act(async () => container.querySelector<HTMLButtonElement>('.more-btn')!.click());
    expect(container.querySelector('.overlay-more-actions')).not.toBeNull();
    await press(',', { ctrlKey: true });
    await press('Escape');
    expect(container.querySelector('.settings-modal')).toBeNull();
    expect(invoke.mock.calls.some((call: unknown[]) => call[0] === 'destroy_window')).toBe(false);
  });

  it('cycles through image tools and navigates after a rotation button click', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    const viewer = container.querySelector<HTMLElement>('.image-container')!;
    viewer.focus();
    await press('F6');
    await press('F6');
    expect(document.activeElement).toBe(container.querySelector('.overlay-bottom-row button'));
    await press('F6');
    expect(document.activeElement).toBe(viewer);
    await press('F6', { shiftKey: true });
    expect(document.activeElement).toBe(container.querySelector('.overlay-bottom-row button'));
    const rotate = container.querySelector<HTMLButtonElement>('[aria-label="시계 방향 90도 회전"]')!;
    await act(async () => { rotate.focus(); rotate.click(); });
    expect(container.querySelector<HTMLImageElement>('.viewer-image')?.style.transform).toContain('90deg');
    await press('ArrowRight');
    expect(container.querySelector('img')?.alt).toBe('2.png');
  });

  it('keeps the specific unsupported-format state when opening a file directly', async () => {
    fixture.path = 'C:/audit/phone.heic';
    await mount();
    expect(container.querySelector('.error-message')?.textContent).toContain('HEIC/HEIF');
    expect(container.querySelector('.error-action-btn.primary')?.textContent).toBe('이미지 열기');
    expect(container.querySelector('.error-actions')?.textContent).not.toContain('다시 시도');
  });

  it('copies and saves the original after rotation, but prints the rotated view', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    const image = container.querySelector<HTMLImageElement>('.viewer-image')!;
    Object.defineProperties(image, {
      complete: { value: true }, naturalWidth: { value: 1200 }, naturalHeight: { value: 800 },
    });
    const rotate = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      translate: vi.fn(), rotate, drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    } as unknown as CanvasRenderingContext2D);
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press('r');
    await press('c', { ctrlKey: true });
    expect(newClipboardImage.mock.calls[0]?.slice(1)).toEqual([1200, 800]);
    expect(rotate).toHaveBeenLastCalledWith(0);
    expect(invoke).toHaveBeenCalledWith('append_file_to_clipboard', { path: fixture.path });
    await press('s', { ctrlKey: true });
    expect(invoke).toHaveBeenCalledWith('save_image_as', { filePath: fixture.path, targetPath: 'C:/audit/saved.png' });
    // Allow the native-dialog queued-key guard to expire before printing.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
    await press('p', { ctrlKey: true });
    expect(rotate).toHaveBeenLastCalledWith(Math.PI / 2);
    const canvas = container.querySelector<HTMLCanvasElement>('.print-canvas')!;
    expect([canvas.width, canvas.height]).toEqual([800, 1200]);
    expect(print).toHaveBeenCalledTimes(1);
  });
});
