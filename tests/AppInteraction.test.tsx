/** @vitest-environment jsdom */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const fixture = vi.hoisted(() => ({ path: null as string | null, loadDelayMs: 0, saveFails: false,
  resizeFails: false, fullscreen: false, maximized: false }));
const invoke = vi.hoisted(() => vi.fn(async (command: string, _args?: unknown) => {
  if (command === 'resize_window' && fixture.resizeFails) throw new Error('test resize failure');
  return command === 'append_file_to_clipboard' ? { imageAvailable: true, fileAvailable: true } : null;
}));
const windowActions = vi.hoisted(() => ({
  setFullscreen: vi.fn(async (value: boolean) => { fixture.fullscreen = value; }),
  unmaximize: vi.fn(async () => { fixture.maximized = false; }),
  startDragging: vi.fn(async () => {}),
  startResizeDragging: vi.fn(async (_direction: string) => {}),
}));
const newClipboardImage = vi.hoisted(() => vi.fn(async (_pixels: Uint8Array, _width: number, _height: number) => ({ close: async () => {} })));
vi.mock('@tauri-apps/api/image', () => ({ Image: { new: newClipboardImage } }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeImage: async () => {}, writeText: async () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: async () => null, save: async () => 'C:/audit/saved.png' }));
vi.mock('@tauri-apps/api/core', () => ({ invoke, convertFileSrc: (path: string) => path }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isFullscreen: async () => fixture.fullscreen, isMaximized: async () => fixture.maximized,
    ...windowActions,
    onCloseRequested: async () => () => {}, onResized: async () => () => {},
    onFocusChanged: async () => () => {}, onMoved: async () => () => {},
    onDragDropEvent: async () => () => {}, center: async () => {},
  }),
}));
vi.mock('../src/hooks/useImageLoader', () => {
  const loader = {
    loadSettings: async () => ({ rememberWindowPosition: false, backgroundMode: 'dark', locale: 'ko',
      defaultFitMode: 'auto', loopNavigation: true, overlayHideDelayMs: 2000, customOpenApps: [],
      alwaysShowControls: false, showTransparencyGrid: false }),
    saveSettings: async () => {
      if (fixture.saveFails) throw { kind: 'settings_save_failed', message: 'test write failure' };
    },
    getCliArgs: async () => fixture.path ? ['plainview', fixture.path] : ['plainview'],
    scanFolder: async () => ['C:/audit/1.png', 'C:/audit/2.png'],
    loadImage: async (path: string) => {
      if (path.endsWith('.heic')) throw { kind: 'unsupported_heic', message: 'unsupported' };
      if (path.endsWith('2.png') && fixture.loadDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, fixture.loadDelayMs));
      }
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

async function pointer(target: Element, type: string, options: MouseEventInit = {}, pointerId = 1) {
  await act(async () => {
    const event = new MouseEvent(type, {
      bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1,
      clientX: 400, clientY: 300, ...options,
    });
    Object.defineProperties(event, { pointerId: { value: pointerId }, pointerType: { value: 'mouse' } });
    target.dispatchEvent(event);
  });
}

beforeEach(() => {
  fixture.path = null;
  fixture.loadDelayMs = 0;
  fixture.saveFails = false;
  fixture.resizeFails = false;
  fixture.fullscreen = false;
  fixture.maximized = false;
  windowActions.setFullscreen.mockClear();
  windowActions.unmaximize.mockClear();
  windowActions.startDragging.mockClear();
  windowActions.startResizeDragging.mockClear();
  invoke.mockClear();
  newClipboardImage.mockClear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  vi.spyOn(window, 'screen', 'get').mockReturnValue({ availWidth: 1920, availHeight: 1080 } as Screen);
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
  it('moves a fitted image window only after an intentional center drag', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press('f');
    const image = container.querySelector<HTMLElement>('.viewer-image')!;
    const app = container.querySelector<HTMLElement>('.app-container')!;
    expect(app.style.cursor).toBe('grab');
    await pointer(image, 'pointerdown');
    await pointer(app, 'pointermove', { clientX: 402, clientY: 301 });
    expect(windowActions.startDragging).not.toHaveBeenCalled();
    await pointer(app, 'pointermove', { clientX: 408, clientY: 304 });
    expect(windowActions.startDragging).toHaveBeenCalledTimes(1);
    await pointer(app, 'pointermove', { clientX: 430 });
    await pointer(app, 'pointerup');
    expect(windowActions.startDragging).toHaveBeenCalledTimes(1);
    expect(image.style.transform).toContain('translate(0px, 0px)');
    expect(app.style.cursor).toBe('grab');
  });

  it('keeps clicks and double-click fullscreen available without moving the window', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    const image = container.querySelector<HTMLElement>('.viewer-image')!;
    for (let click = 0; click < 2; click += 1) {
      await pointer(image, 'pointerdown');
      await pointer(image, 'pointermove', { clientX: 402 });
      await pointer(image, 'pointerup');
    }
    await act(async () => image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 })));
    await settle();
    expect(windowActions.startDragging).not.toHaveBeenCalled();
    expect(windowActions.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('pans an oversized image while Alt-drag still moves the window', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press('0');
    const image = container.querySelector<HTMLElement>('.viewer-image')!;
    const app = container.querySelector<HTMLElement>('.app-container')!;
    await pointer(image, 'pointerdown');
    await pointer(app, 'pointermove', { clientX: 450, clientY: 310 });
    await pointer(app, 'pointerup');
    expect(image.style.transform).toContain('translate(50px, 10px)');
    expect(windowActions.startDragging).not.toHaveBeenCalled();
    await pointer(image, 'pointerdown', { altKey: true });
    await pointer(app, 'pointermove', { clientX: 430, altKey: true });
    expect(windowActions.startDragging).toHaveBeenCalledTimes(1);
    expect(image.style.transform).toContain('translate(50px, 10px)');
  });

  it('cancels pending drags on pointer release and ignores unrelated pointers', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    const image = container.querySelector<HTMLElement>('.viewer-image')!;
    const app = container.querySelector<HTMLElement>('.app-container')!;
    await pointer(image, 'pointerdown');
    await pointer(app, 'pointermove', { clientX: 450 }, 2);
    expect(windowActions.startDragging).not.toHaveBeenCalled();
    await pointer(app, 'pointercancel');
    await pointer(app, 'pointermove', { clientX: 450 });
    expect(windowActions.startDragging).not.toHaveBeenCalled();
    expect(app.style.cursor).toBe('grab');
  });

  it('keeps toolbar presses and fullscreen fitted images out of window dragging', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    const viewer = container.querySelector<HTMLElement>('.image-container')!;
    const app = container.querySelector<HTMLElement>('.app-container')!;
    const fitButton = container.querySelector<HTMLElement>('.overlay-window-fit-button')!;
    await pointer(fitButton, 'pointerdown');
    await pointer(app, 'pointermove', { clientX: 450 });
    await pointer(app, 'pointerup');
    expect(windowActions.startDragging).not.toHaveBeenCalled();
    viewer.focus();
    await press('F11');
    await pointer(viewer, 'pointerdown');
    await pointer(app, 'pointermove', { clientX: 450 });
    expect(windowActions.startDragging).not.toHaveBeenCalled();
    expect(app.style.cursor).toBe('default');
  });

  it('restores the window independently of image zoom and uses the rotated dimensions', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    container.querySelector<HTMLElement>('.image-container')!.focus();
    invoke.mockClear();
    await press('0');
    await press('f');
    expect(invoke.mock.calls.some((call) => call[0] === 'resize_window')).toBe(false);
    await press('0', { ctrlKey: true });
    expect(invoke).toHaveBeenCalledWith('resize_window', { width: 1202, height: 802 });
    await press('r');
    await press('0', { ctrlKey: true });
    expect(invoke).toHaveBeenLastCalledWith('resize_window', { width: 664, height: 996 });
    expect(container.querySelector<HTMLImageElement>('.viewer-image')?.style.transform).toContain('90deg');
  });

  it('offers a visible window restore button and exits fullscreen and maximization before resizing', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press('F6');
    await press('F6');
    fixture.fullscreen = true;
    fixture.maximized = true;
    invoke.mockClear();
    await act(async () => container.querySelector<HTMLButtonElement>('.overlay-window-fit-button')!.click());
    await settle();
    expect(windowActions.setFullscreen).toHaveBeenCalledWith(false);
    expect(windowActions.unmaximize).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('resize_window', { width: 1202, height: 802 });
  });

  it('reports a failed native window resize without losing the displayed image', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    fixture.resizeFails = true;
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press('0', { ctrlKey: true });
    expect(container.querySelector('.toast-error')?.getAttribute('role')).toBe('alert');
    expect(container.querySelector<HTMLImageElement>('.viewer-image')?.alt).toBe('1.png');
  });

  it('does not resize an empty window through the image-fit shortcut', async () => {
    await mount();
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press('0', { ctrlKey: true });
    expect(invoke.mock.calls.some((call) => call[0] === 'resize_window')).toBe(false);
    expect(container.querySelector('.overlay-window-fit-button')).toBeNull();
  });

  it('keeps the context menu mounted through pointer-down so its window action can run', async () => {
    fixture.path = 'C:/audit/1.png';
    await mount();
    const viewer = container.querySelector<HTMLElement>('.image-container')!;
    await act(async () => viewer.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 100, clientY: 100,
    })));
    const action = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('창을 이미지 크기에 맞추기'))!;
    await act(async () => action.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 300,
    })));
    expect(action.isConnected).toBe(true);
    invoke.mockClear();
    await act(async () => action.click());
    await settle();
    expect(container.querySelector('.context-menu')).toBeNull();
    expect(invoke).toHaveBeenCalledWith('resize_window', { width: 1202, height: 802 });
  });

  it('shows a failed settings save and preserves the previous display preferences', async () => {
    await mount();
    fixture.saveFails = true;
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press(',', { ctrlKey: true });
    await act(async () => container.querySelector<HTMLInputElement>('#settings-always-show-controls')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.settings-modal > .app-modal-actions .primary')!.click());
    await settle();
    expect(container.querySelector('.settings-modal')).not.toBeNull();
    expect(container.querySelector('.toast-error')?.getAttribute('role')).toBe('alert');
    await press('Escape');
    await press(',', { ctrlKey: true });
    expect(container.querySelector<HTMLInputElement>('#settings-always-show-controls')?.checked).toBe(false);
  });

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

  it('keeps the current image visible while the next image loads', async () => {
    fixture.path = 'C:/audit/1.png';
    fixture.loadDelayMs = 420;
    await mount();
    container.querySelector<HTMLElement>('.image-container')!.focus();
    await press('ArrowRight');
    expect(container.querySelector<HTMLImageElement>('.viewer-image')?.alt).toBe('1.png');
    expect(container.querySelector('.loading-view')).toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 260)));
    expect(container.querySelector('.transition-loading-indicator')).not.toBeNull();
    await act(async () => new Promise((resolve) => setTimeout(resolve, 180)));
    expect(container.querySelector<HTMLImageElement>('.viewer-image')?.alt).toBe('2.png');
    expect(container.querySelector('.transition-loading-indicator')).toBeNull();
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
