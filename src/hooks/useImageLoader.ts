import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import type { CommandError, LoadedImageData, Settings } from '../types';
import {
  RevisionLruCache,
  type ImageRevision,
} from '../imageCache';

// ---- LRU Cache with size limit ----

const MAX_CACHE_SIZE = 5;

interface CachedImage {
  src: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  modifiedTimeMs: number;
  originalExtension: string | null;
}

const preloadCache = new RevisionLruCache<CachedImage>(MAX_CACHE_SIZE);

const revisionFromData = (data: LoadedImageData): ImageRevision => ({
  fileSize: data.fileSize,
  modifiedTimeMs: data.modifiedTimeMs,
});

function buildImageSource(data: LoadedImageData): string {
  if (data.sourceKind === 'file') {
    const revision = `${data.modifiedTimeMs}-${data.fileSize}`;
    return `${convertFileSrc(data.filePath)}?plainviewRevision=${revision}`;
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
    const revision = await invoke<ImageRevision>('get_image_revision', { path: filePath });
    const cached = preloadCache.get(filePath, revision);
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

      preloadCache.set(filePath, revisionFromData(data), {
        src,
        fileName: data.fileName,
        filePath: data.filePath,
        fileSize: data.fileSize,
        modifiedTimeMs: data.modifiedTimeMs,
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
      try {
        const revision = await invoke<ImageRevision>('get_image_revision', { path: p });
        if (preloadCache.isCurrent(p, revision)) continue;

        const data = await invoke<LoadedImageData>('read_image', { path: p });
        const src = buildImageSource(data);
        preloadCache.set(p, revisionFromData(data), {
          src,
          fileName: data.fileName,
          filePath: data.filePath,
          fileSize: data.fileSize,
          modifiedTimeMs: data.modifiedTimeMs,
          originalExtension: data.originalExtension,
        });
      } catch {
        // Silently skip failed preloads
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
      locale:
        settings.locale === 'ko' || settings.locale === 'en'
          ? settings.locale
          : 'system',
      overlayHideDelayMs:
        typeof settings.overlayHideDelayMs === 'number' &&
        [1000, 2000, 4000].includes(settings.overlayHideDelayMs)
          ? settings.overlayHideDelayMs
          : 2000,
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

  const invalidateImage = useCallback((filePath: string) => {
    preloadCache.delete(filePath);
  }, []);

  const isImageStale = useCallback(async (filePath: string) => {
    try {
      const revision = await invoke<ImageRevision>('get_image_revision', { path: filePath });
      return !preloadCache.isCurrent(filePath, revision);
    } catch {
      return true;
    }
  }, []);

  return {
    loadImage,
    preloadImages,
    scanFolder,
    loadSettings,
    saveSettings,
    getCliArgs,
    invalidateImage,
    isImageStale,
  };
}
