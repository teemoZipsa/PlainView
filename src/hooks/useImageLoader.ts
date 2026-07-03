import { invoke } from '@tauri-apps/api/core';
import { useCallback, useRef } from 'react';
import type { LoadedImageData, Settings } from '../types';

// ---- LRU Cache with size limit ----

const MAX_CACHE_SIZE = 5;

interface CachedImage {
  src: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  originalExtension: string | null;
}

/** Ordered map: oldest -> newest. When full, evict the oldest entry. */
const preloadCache = new Map<string, CachedImage>();

function cacheSet(key: string, value: CachedImage) {
  // If the key already exists, delete and re-insert to move it to the end (most recent)
  if (preloadCache.has(key)) {
    preloadCache.delete(key);
  }
  // Evict oldest if at capacity
  while (preloadCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = preloadCache.keys().next().value;
    if (oldestKey !== undefined) {
      preloadCache.delete(oldestKey);
    } else {
      break;
    }
  }
  preloadCache.set(key, value);
}

function cacheGet(key: string): CachedImage | undefined {
  const value = preloadCache.get(key);
  if (value !== undefined) {
    // Move to end (most recently used)
    preloadCache.delete(key);
    preloadCache.set(key, value);
  }
  return value;
}

// ---- Hook ----

export function useImageLoader() {
  const loadingRef = useRef(false);

  const loadImage = useCallback(async (filePath: string): Promise<{
    src: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    originalExtension: string | null;
    naturalWidth: number;
    naturalHeight: number;
  }> => {
    // Check LRU cache first
    const cached = cacheGet(filePath);
    if (cached) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({
          src: cached.src,
          fileName: cached.fileName,
          filePath: cached.filePath,
          fileSize: cached.fileSize,
          originalExtension: cached.originalExtension,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
        img.onerror = () => reject(new Error('image_load_failed'));
        img.src = cached.src;
      });
    }

    loadingRef.current = true;

    try {
      const data = await invoke<LoadedImageData>('read_image', { path: filePath });
      const src = `data:${data.mimeType};base64,${data.base64}`;

      // LRU cache set (auto-evicts oldest if full)
      cacheSet(filePath, {
        src,
        fileName: data.fileName,
        filePath: data.filePath,
        fileSize: data.fileSize,
        originalExtension: data.originalExtension,
      });

      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          loadingRef.current = false;
          resolve({
            src,
            fileName: data.fileName,
            filePath: data.filePath,
            fileSize: data.fileSize,
            originalExtension: data.originalExtension,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          });
        };
        img.onerror = () => {
          loadingRef.current = false;
          reject(new Error('image_load_failed'));
        };
        img.src = src;
      });
    } catch (err) {
      loadingRef.current = false;
      throw err;
    }
  }, []);

  const preloadImages = useCallback(async (paths: string[]) => {
    for (const p of paths) {
      if (!preloadCache.has(p)) {
        try {
          const data = await invoke<LoadedImageData>('read_image', { path: p });
          cacheSet(p, {
            src: `data:${data.mimeType};base64,${data.base64}`,
            fileName: data.fileName,
            filePath: data.filePath,
            fileSize: data.fileSize,
            originalExtension: data.originalExtension,
          });
        } catch {
          // Silently skip failed preloads
        }
      }
    }
  }, []);

  const scanFolder = useCallback(async (filePath: string): Promise<string[]> => {
    const folder = await invoke<string>('get_parent_folder', { filePath });
    return invoke<string[]>('scan_folder_images', { folderPath: folder });
  }, []);

  const loadSettings = useCallback(async (): Promise<Settings> => {
    const settings = await invoke<Partial<Settings>>('load_settings');

    return {
      rememberWindowPosition: settings.rememberWindowPosition ?? true,
      alwaysOnTopDefault: settings.alwaysOnTopDefault ?? false,
      loopNavigation: settings.loopNavigation ?? true,
      backgroundMode: settings.backgroundMode === 'light' ? 'light' : 'dark',
      defaultFitMode:
        settings.defaultFitMode === 'fit' || settings.defaultFitMode === 'original'
          ? settings.defaultFitMode
          : 'auto',
      lastWindowBounds: settings.lastWindowBounds ?? null,
      customOpenApps: settings.customOpenApps ?? [],
    };
  }, []);

  const saveSettings = useCallback(async (settings: Settings): Promise<void> => {
    return invoke('save_settings', { settings });
  }, []);

  const getCliArgs = useCallback(async (): Promise<string[]> => {
    return invoke<string[]>('get_cli_args');
  }, []);

  return {
    loadImage,
    preloadImages,
    scanFolder,
    loadSettings,
    saveSettings,
    getCliArgs,
    isLoading: loadingRef.current,
  };
}
