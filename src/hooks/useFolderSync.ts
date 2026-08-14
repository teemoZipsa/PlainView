import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useRef } from 'react';

const FOLDER_CHANGED_EVENT = 'plainview://folder-changed';
const FOLDER_CHANGE_DEBOUNCE_MS = 200;
const normalizePath = (path: string) => path.replace(/\//g, '\\').toLowerCase();

interface UseFolderSyncOptions {
  filePath: string | null;
  onRefresh: (forceReload: boolean) => void | Promise<void>;
}

interface FolderChangePayload {
  folder: string;
  paths: string[];
}

export function useFolderSync({ filePath, onRefresh }: UseFolderSyncOptions) {
  const refreshRef = useRef(onRefresh);
  const filePathRef = useRef(filePath);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const forceReloadRef = useRef(false);
  refreshRef.current = onRefresh;
  filePathRef.current = filePath;

  const scheduleRefresh = useCallback((delayMs: number, forceReload = false) => {
    forceReloadRef.current ||= forceReload;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const shouldForceReload = forceReloadRef.current;
      forceReloadRef.current = false;
      void refreshRef.current(shouldForceReload);
    }, delayMs);
  }, []);

  useEffect(() => {
    const command = filePath ? 'watch_image_folder' : 'clear_image_folder_watch';
    const args = filePath ? { filePath } : undefined;

    void invoke(command, args).catch(() => {
      // Focus refresh and F5 remain available when native watching is unavailable.
    });
  }, [filePath]);

  useEffect(() => {
    let cancelled = false;
    let unlistenFolder: (() => void) | null = null;
    let unlistenFocus: (() => void) | null = null;

    const setup = async () => {
      try {
        const unlisten = await listen<FolderChangePayload>(FOLDER_CHANGED_EVENT, ({ payload }) => {
          const normalizedCurrentPath = filePathRef.current
            ? normalizePath(filePathRef.current)
            : null;
          const changedCurrentFile =
            !payload.paths.length ||
            Boolean(
              normalizedCurrentPath &&
                payload.paths.some(
                  (path) => normalizePath(path) === normalizedCurrentPath
                )
            );
          scheduleRefresh(FOLDER_CHANGE_DEBOUNCE_MS, changedCurrentFile);
        });
        if (cancelled) {
          unlisten();
        } else {
          unlistenFolder = unlisten;
        }
      } catch {
        // Event listening is unavailable in the browser-only development view.
      }

      try {
        const unlisten = await getCurrentWindow().onFocusChanged(({ payload: focused }) => {
          if (focused) scheduleRefresh(0, false);
        });
        if (cancelled) {
          unlisten();
        } else {
          unlistenFocus = unlisten;
        }
      } catch {
        // Focus events are unavailable in the browser-only development view.
      }
    };

    void setup();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      forceReloadRef.current = false;
      unlistenFolder?.();
      unlistenFocus?.();
    };
  }, [scheduleRefresh]);
}
