import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import type { CommandError, LoadedImageData, Settings } from '../types';

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

function buildImageSource(data: LoadedImageData): string {
  if (data.sourceKind === 'file') {
    return convertFileSrc(data.filePath);
  }

  if (!data.base64) {
    throw new Error('image_load_failed');
  }

  return `data:${data.mimeType};base64,${data.base64}`;
}

function imageLoadFailedError(originalExtension: string | null): Error | CommandError {
  if (originalExtension?.toLowerCase() === 'avif') {
    return {
      kind: 'avif_unsupported',
      message: 'AVIF image could not be displayed by the current WebView runtime.',
    };
  }

  return new Error('image_load_failed');
}

// ---- Hook ----

export function useImageLoader() {
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
        img.onerror = () => reject(imageLoadFailedError(cached.originalExtension));
        img.src = cached.src;
      });
    }

    try {
      const data = await invoke<LoadedImageData>('read_image', { path: filePath });
      const src = buildImageSource(data);

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
          reject(imageLoadFailedError(data.originalExtension));
        };
        img.src = src;
      });
    } catch (err) {
      throw err;
    }
  }, []);

  const preloadImages = useCallback(async (paths: string[]) => {
    for (const p of paths) {
      if (!preloadCache.has(p)) {
        try {
          const data = await invoke<LoadedImageData>('read_image', { path: p });
          const src = buildImageSource(data);
          cacheSet(p, {
            src,
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
  };
}
