import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useEffect, useRef } from 'react';

const FOLDER_CHANGED_EVENT = 'plainview://folder-changed';
const FOLDER_CHANGE_DEBOUNCE_MS = 200;

interface UseFolderSyncOptions {
  filePath: string | null;
  onRefresh: () => void | Promise<void>;
}

export function useFolderSync({ filePath, onRefresh }: UseFolderSyncOptions) {
  const refreshRef = useRef(onRefresh);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  refreshRef.current = onRefresh;

  const scheduleRefresh = useCallback((delayMs: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void refreshRef.current();
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
        const unlisten = await listen<string>(FOLDER_CHANGED_EVENT, () => {
          scheduleRefresh(FOLDER_CHANGE_DEBOUNCE_MS);
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
          if (focused) scheduleRefresh(0);
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
      unlistenFolder?.();
      unlistenFocus?.();
    };
  }, [scheduleRefresh]);
}
