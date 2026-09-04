import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { useCallback } from 'react';
import type { CommandError, LoadedImageData, Settings } from '../types';
import {
  RevisionLruCache,
  type ImageRevision,
} from '../imageCache';
import { usesFileImageSource } from '../imageFormats';

// ---- LRU Cache with size limit ----

const MAX_CACHE_SIZE = 5;
const MAX_CACHE_WEIGHT_BYTES = 96 * 1024 * 1024;
const MAX_TRACKED_REVISIONS = 64;
let preloadGeneration = 0;

interface CachedImage {
  src: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  modifiedTimeNs: string;
  originalExtension: string | null;
  isTemporarySource: boolean;
}

const preloadCache = new RevisionLruCache<CachedImage>(
  MAX_CACHE_SIZE,
  MAX_CACHE_WEIGHT_BYTES,
  (image) => (image.src.startsWith('data:') ? image.src.length * 2 : 1024)
);
// Keep lightweight revision knowledge separate from source caching. Converted
// images that exceed the byte budget are intentionally not cached, but a focus
// event should not decode them again unless the file actually changed.
const loadedRevisionCache = new RevisionLruCache<boolean>(MAX_TRACKED_REVISIONS);

const revisionFromData = (data: LoadedImageData): ImageRevision => ({
  fileSize: data.fileSize,
  modifiedTimeNs: data.modifiedTimeNs,
});

function buildImageSource(data: LoadedImageData): string {
  if (data.sourceKind === 'file') {
    const revision = `${data.modifiedTimeNs}-${data.fileSize}`;
    return `${convertFileSrc(data.sourceFilePath)}?plainviewRevision=${revision}`;
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

async function decodePreloadedImage(src: string): Promise<void> {
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
  await image.decode();
}

// ---- Hook ----

export function useImageLoader() {
  const loadImage = useCallback(async (filePath: string): Promise<{
    src: string;
    fileName: string;
    filePath: string;
    fileSize: number;
    originalExtension: string | null;
    isTemporarySource: boolean;
    naturalWidth: number;
    naturalHeight: number;
  }> => {
    // A user-initiated image load supersedes any adjacent-image preload loop.
    preloadGeneration += 1;
    const revision = await invoke<ImageRevision>('get_image_revision', { path: filePath });
    const cached = preloadCache.get(filePath, revision);
    // A temporary image may have entered the cache through adjacent-image
    // preloading. Load it once more as the active image so Rust can create the
    // session-owned copy before the source application removes the original.
    if (cached && !cached.isTemporarySource) {
      loadedRevisionCache.set(filePath, revision, true);
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({
          src: cached.src,
          fileName: cached.fileName,
          filePath: cached.filePath,
          fileSize: cached.fileSize,
          originalExtension: cached.originalExtension,
          isTemporarySource: cached.isTemporarySource,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
        img.onerror = () => reject(imageLoadFailedError(cached.originalExtension));
        img.src = cached.src;
      });
    }

    try {
      const data = await invoke<LoadedImageData>('read_image', {
        path: filePath,
        retainSource: true,
      });
      const src = buildImageSource(data);
      const loadedRevision = revisionFromData(data);

      preloadCache.set(filePath, loadedRevision, {
        src,
        fileName: data.fileName,
        filePath: data.filePath,
        fileSize: data.fileSize,
        modifiedTimeNs: data.modifiedTimeNs,
        originalExtension: data.originalExtension,
        isTemporarySource: data.isTemporarySource,
      });
      loadedRevisionCache.set(filePath, loadedRevision, true);

      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          resolve({
            src,
            fileName: data.fileName,
            filePath: data.filePath,
            fileSize: data.fileSize,
            originalExtension: data.originalExtension,
            isTemporarySource: data.isTemporarySource,
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
    const generation = ++preloadGeneration;
    for (const p of paths) {
      if (generation !== preloadGeneration) return;
      // Converted formats can allocate hundreds of MB across decoded pixels,
      // PNG output and base64. Load them only when the user actually navigates
      // to the file instead of speculatively decoding adjacent images.
      if (!usesFileImageSource(p)) continue;

      try {
        const revision = await invoke<ImageRevision>('get_image_revision', { path: p });
        if (generation !== preloadGeneration) return;
        if (preloadCache.isCurrent(p, revision)) continue;

        const data = await invoke<LoadedImageData>('read_image', {
          path: p,
          retainSource: false,
        });
        if (generation !== preloadGeneration) return;
        if (data.sourceKind !== 'file') continue;
        const src = buildImageSource(data);
        const loadedRevision = revisionFromData(data);
        preloadCache.set(p, loadedRevision, {
          src,
          fileName: data.fileName,
          filePath: data.filePath,
          fileSize: data.fileSize,
          modifiedTimeNs: data.modifiedTimeNs,
          originalExtension: data.originalExtension,
          isTemporarySource: data.isTemporarySource,
        });
        loadedRevisionCache.set(p, loadedRevision, true);
        await decodePreloadedImage(src);
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
    loadedRevisionCache.delete(filePath);
  }, []);

  const isImageStale = useCallback(async (filePath: string) => {
    try {
      const revision = await invoke<ImageRevision>('get_image_revision', { path: filePath });
      return !loadedRevisionCache.isCurrent(filePath, revision);
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
