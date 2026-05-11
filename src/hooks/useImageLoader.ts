import { invoke } from '@tauri-apps/api/core';
import { useCallback, useRef } from 'react';
import type { ImageData, Settings } from '../types';

// ---- LRU Cache with size limit ----

const MAX_CACHE_SIZE = 5;

/** Ordered map: oldest → newest. When full, evict the oldest entry. */
const preloadCache = new Map<string, string>();

function cacheSet(key: string, value: string) {
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

function cacheGet(key: string): string | undefined {
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
    naturalWidth: number;
    naturalHeight: number;
  }> => {
    // Check LRU cache first
    const cached = cacheGet(filePath);
    if (cached) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({
          src: cached,
          fileName: filePath.split(/[\\/]/).pop() || 'unknown',
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
        });
        img.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'));
        img.src = cached;
      });
    }

    loadingRef.current = true;

    try {
      const data = await invoke<ImageData>('read_image', { path: filePath });
      const src = `data:${data.mimeType};base64,${data.base64}`;

      // LRU cache set (auto-evicts oldest if full)
      cacheSet(filePath, src);

      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          loadingRef.current = false;
          resolve({
            src,
            fileName: data.fileName,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
          });
        };
        img.onerror = () => {
          loadingRef.current = false;
          reject(new Error('이미지를 불러올 수 없습니다.'));
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
          const data = await invoke<ImageData>('read_image', { path: p });
          cacheSet(p, `data:${data.mimeType};base64,${data.base64}`);
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
    return invoke<Settings>('load_settings');
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
