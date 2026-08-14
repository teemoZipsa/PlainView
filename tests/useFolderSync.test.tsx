/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve()),
  folderListener: null as null | ((event: {
    payload: { folder: string; paths: string[] };
  }) => void),
  focusListener: null as null | ((event: { payload: boolean }) => void),
  unlistenFolder: vi.fn(),
  unlistenFocus: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, callback: (event: {
    payload: { folder: string; paths: string[] };
  }) => void) => {
    mocks.folderListener = callback;
    return mocks.unlistenFolder;
  }),
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onFocusChanged: async (callback: (event: { payload: boolean }) => void) => {
      mocks.focusListener = callback;
      return mocks.unlistenFocus;
    },
  }),
}));

import { useFolderSync } from '../src/hooks/useFolderSync';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

function Harness({
  filePath,
  onRefresh,
}: {
  filePath: string | null;
  onRefresh: (forceReload: boolean) => void;
}) {
  useFolderSync({ filePath, onRefresh });
  return null;
}

describe('useFolderSync', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.invoke.mockClear();
    mocks.unlistenFolder.mockClear();
    mocks.unlistenFocus.mockClear();
    mocks.folderListener = null;
    mocks.focusListener = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('watches the current folder and debounces repeated file events', async () => {
    const onRefresh = vi.fn();

    await act(async () => {
      root.render(<Harness filePath={'C:\\images\\one.png'} onRefresh={onRefresh} />);
      await Promise.resolve();
    });

    expect(mocks.invoke).toHaveBeenCalledWith('watch_image_folder', {
      filePath: 'C:\\images\\one.png',
    });

    const currentFileEvent = {
      payload: { folder: 'C:\\images', paths: ['C:\\images\\one.png'] },
    };
    mocks.folderListener?.(currentFileEvent);
    mocks.folderListener?.(currentFileEvent);
    await act(async () => vi.advanceTimersByTime(199));
    expect(onRefresh).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenLastCalledWith(true);

    mocks.folderListener?.({
      payload: { folder: 'C:\\images', paths: ['C:\\images\\two.png'] },
    });
    await act(async () => vi.advanceTimersByTime(200));
    expect(onRefresh).toHaveBeenLastCalledWith(false);
  });

  it('refreshes on focus and clears native watching without a file', async () => {
    const onRefresh = vi.fn();

    await act(async () => {
      root.render(<Harness filePath={'C:\\images\\one.png'} onRefresh={onRefresh} />);
      await Promise.resolve();
    });

    mocks.focusListener?.({ payload: true });
    await act(async () => vi.runOnlyPendingTimers());
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onRefresh).toHaveBeenCalledWith(false);

    await act(async () => {
      root.render(<Harness filePath={null} onRefresh={onRefresh} />);
      await Promise.resolve();
    });

    expect(mocks.invoke).toHaveBeenCalledWith('clear_image_folder_watch', undefined);
  });
});
