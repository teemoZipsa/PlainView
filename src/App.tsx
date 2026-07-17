import { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import ContextMenu from './components/ContextMenu';
import OverlayControls from './components/OverlayControls';
import ErrorView from './components/ErrorView';
import { useImageLoader } from './hooks/useImageLoader';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useOverlayVisibility } from './hooks/useOverlayVisibility';
import { commandErrorKeys, detectLocale, translate, type TranslationKey } from './i18n';
import type {
  ViewerState,
  Rotation,
  Settings,
  BackgroundMode,
  DragMode,
  FitMode,
  CustomOpenApp,
  CommandError,
} from './types';
import './App.css';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.15;
const SCREEN_FIT_RATIO = 0.92;
const MIN_WINDOW_SIZE = 200;
const CONTEXT_MENU_WIDTH = 240;
const CONTEXT_SUBMENU_WIDTH = 240;
const VIEWPORT_MARGIN = 8;

interface FullscreenSnapshot {
  currentFilePath: string | null;
  zoom: number;
  fitMode: FitMode;
  panOffset: { x: number; y: number };
}

interface ContextMenuState {
  x: number;
  y: number;
  submenuDirection: 'right' | 'left' | 'stacked';
  submenuVerticalDirection: 'down' | 'up';
}

interface AppRegistrationDraft {
  executablePath: string;
  defaultName: string;
  name: string;
}

interface RenameDraft {
  filePath: string;
  originalName: string;
  name: string;
  extension: string;
}

interface GifPauseState {
  filePath: string;
  pausedSrc: string;
}

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const normalizeBackgroundMode = (mode: unknown): BackgroundMode =>
  mode === 'light' ? 'light' : 'dark';

function App() {
  const [state, setState] = useState<ViewerState>({
    currentFilePath: null,
    imageList: [],
    currentIndex: -1,
    zoom: 1,
    rotation: 0,
    fitMode: 'auto',
    panOffset: { x: 0, y: 0 },
    naturalSize: { width: 0, height: 0 },
    isAlwaysOnTop: false,
    isLoading: true,
    errorMessage: null,
    imageSrc: null,
    fileName: '',
    fileSize: 0,
    originalExtension: null,
  });
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [customOpenApps, setCustomOpenApps] = useState<CustomOpenApp[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [registrationDraft, setRegistrationDraft] = useState<AppRegistrationDraft | null>(null);
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CustomOpenApp | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('dark');
  const [gifPause, setGifPause] = useState<GifPauseState | null>(null);
  const [locale] = useState(detectLocale);
  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) =>
      translate(locale, key, values),
    [locale]
  );

  const settingsRef = useRef<Settings>({
    rememberWindowPosition: true,
    alwaysOnTopDefault: false,
    loopNavigation: true,
    // Future settings — stored for forward compatibility but not yet applied in UI
    backgroundMode: 'dark',
    defaultFitMode: 'auto',
    lastWindowBounds: null,
    customOpenApps: [],
  });

  const viewerRef = useRef<HTMLDivElement>(null);
  const viewerImageRef = useRef<HTMLImageElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const dragModeRef = useRef<DragMode>('none');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenSnapshotRef = useRef<FullscreenSnapshot | null>(null);
  const isFullscreenProcessingRef = useRef(false);
  const isCopyingRef = useRef(false);
  const isMovingRef = useRef(false);
  const isTrashingRef = useRef(false);
  const isSavingRef = useRef(false);
  const isRenamingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const gifPauseRef = useRef<GifPauseState | null>(null);
  const gifClickSequenceRef = useRef<{
    filePath: string;
    initialPause: GifPauseState | null;
    count: number;
  } | null>(null);

  // Race condition prevention: monotonic request counter
  const requestIdRef = useRef(0);

  const {
    loadImage,
    preloadImages,
    scanFolder,
    loadSettings,
    saveSettings,
    getCliArgs,
    invalidateImage,
  } = useImageLoader();

  const overlay = useOverlayVisibility();

  // ---- Utility functions ----

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
      toastTimerRef.current = null;
    }, 2200);
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const updateGifPause = useCallback((nextPause: GifPauseState | null) => {
    gifPauseRef.current = nextPause;
    setGifPause(nextPause);
  }, []);

  const isCommandError = useCallback((error: unknown): error is CommandError => {
    return (
      typeof error === 'object' &&
      error !== null &&
      'kind' in error &&
      'message' in error &&
      typeof (error as CommandError).kind === 'string' &&
      typeof (error as CommandError).message === 'string'
    );
  }, []);

  const getCommandErrorToast = useCallback(
    (error: unknown, fallbackKey: TranslationKey) => {
      if (!isCommandError(error)) return t(fallbackKey);

      const key = commandErrorKeys[error.kind] ?? fallbackKey;
      return t(key);
    },
    [isCommandError, t]
  );

  const getErrorMessage = useCallback(
    (error: unknown, fallbackKey: TranslationKey) => {
      if (isCommandError(error)) {
        return t(commandErrorKeys[error.kind] ?? fallbackKey);
      }

      if (error instanceof Error) {
        if (error.message === 'image_load_failed') return t('error.imageLoadFailed');
        if (error.message === 'image_size_failed') return t('error.imageSizeFailed');
      }

      const message = typeof error === 'string' ? error : '';
      return message && !/[\uAC00-\uD7A3]/.test(message) ? message : t(fallbackKey);
    },
    [isCommandError, t]
  );

  const getExecutableDisplayName = useCallback((path: string) => {
    const fileName = path.split(/[\\/]/).pop() || t('app.defaultName');
    return fileName.replace(/\.exe$/i, '') || t('app.defaultName');
  }, [t]);

  const createCustomAppId = useCallback(() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return crypto.randomUUID();
    }
    return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }, []);

  const saveCustomOpenApps = useCallback(
    async (nextApps: CustomOpenApp[]) => {
      const nextSettings: Settings = {
        ...settingsRef.current,
        customOpenApps: nextApps,
      };
      await saveSettings(nextSettings);
      settingsRef.current = nextSettings;
      setCustomOpenApps(nextApps);
    },
    [saveSettings]
  );

  const canCopyImage = useCallback(() => {
    return !!state.imageSrc && !state.isLoading && !state.errorMessage;
  }, [state.errorMessage, state.imageSrc, state.isLoading]);

  const loadImageElement = useCallback((src: string) => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image_load_failed'));
      image.src = src;
    });
  }, []);

  const copyImageElementToClipboard = useCallback(async (imageElement: HTMLImageElement) => {
    const width = imageElement.naturalWidth;
    const height = imageElement.naturalHeight;

    if (!width || !height) {
      throw new Error('image_size_failed');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('2D canvas context is not available.');
    }

    context.drawImage(imageElement, 0, 0, width, height);

    const imageData = context.getImageData(0, 0, width, height);
    const rgba = new Uint8Array(imageData.data);
    const tauriImage = await TauriImage.new(rgba, width, height);

    try {
      await writeImage(tauriImage);
    } finally {
      await tauriImage.close().catch(() => {});
    }
  }, []);

  const handleCopyImage = useCallback(async () => {
    if (isCopyingRef.current || !canCopyImage() || !state.imageSrc) return;

    const srcAtStart = state.imageSrc;
    const imageElementAtStart = viewerImageRef.current;
    isCopyingRef.current = true;

    try {
      let imageElement = imageElementAtStart;

      if (
        !imageElement ||
        !imageElement.complete ||
        imageElement.naturalWidth === 0 ||
        imageElement.src !== srcAtStart
      ) {
        imageElement = await loadImageElement(srcAtStart);
      }

      await copyImageElementToClipboard(imageElement);
      showToast(t('toast.copySuccess'));
    } catch (error) {
      console.warn('Failed to copy image:', error);
      showToast(t('toast.copyFailed'));
    } finally {
      isCopyingRef.current = false;
    }
  }, [canCopyImage, copyImageElementToClipboard, loadImageElement, showToast, state.imageSrc, t]);

  const getViewportSize = useCallback(() => {
    return viewportSize;
  }, [viewportSize]);

  const getRenderedSize = useCallback(
    (naturalW: number, naturalH: number, zoom: number, rotation: Rotation) => {
      const isRotated = rotation === 90 || rotation === 270;
      const effectiveW = isRotated ? naturalH : naturalW;
      const effectiveH = isRotated ? naturalW : naturalH;
      return {
        width: effectiveW * zoom,
        height: effectiveH * zoom,
      };
    },
    []
  );

  /** Calculate fit zoom for a given viewport size (not reading window.innerWidth) */
  const calculateFitZoomForSize = useCallback(
    (naturalW: number, naturalH: number, rotation: Rotation, vpW: number, vpH: number) => {
      const isRotated = rotation === 90 || rotation === 270;
      const effectiveW = isRotated ? naturalH : naturalW;
      const effectiveH = isRotated ? naturalW : naturalH;

      if (effectiveW <= vpW && effectiveH <= vpH) {
        return 1;
      }

      const scaleX = vpW / effectiveW;
      const scaleY = vpH / effectiveH;
      return Math.min(scaleX, scaleY);
    },
    []
  );

  /** Calculate fit zoom using current window size (for runtime recalculation) */
  const calculateFitZoom = useCallback(
    (naturalW: number, naturalH: number, rotation: Rotation) => {
      const viewport = getViewportSize();
      return calculateFitZoomForSize(naturalW, naturalH, rotation, viewport.width, viewport.height);
    },
    [getViewportSize, calculateFitZoomForSize]
  );

  const clampPanOffset = useCallback(
    (
      naturalSize: { width: number; height: number },
      zoom: number,
      rotation: Rotation,
      panOffset: { x: number; y: number }
    ) => {
      const viewport = getViewportSize();
      const rendered = getRenderedSize(naturalSize.width, naturalSize.height, zoom, rotation);
      let x = panOffset.x;
      let y = panOffset.y;

      if (rendered.width <= viewport.width) {
        x = 0;
      } else {
        const maxPanX = (rendered.width - viewport.width) / 2;
        x = Math.max(-maxPanX, Math.min(maxPanX, x));
      }

      if (rendered.height <= viewport.height) {
        y = 0;
      } else {
        const maxPanY = (rendered.height - viewport.height) / 2;
        y = Math.max(-maxPanY, Math.min(maxPanY, y));
      }

      return { x, y };
    },
    [getRenderedSize, getViewportSize]
  );

  const setZoomWithCenter = useCallback(
    (targetZoom: number) => {
      setState((prev) => {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, targetZoom));
        const ratio = prev.zoom > 0 ? newZoom / prev.zoom : 1;
        const scaledPan = {
          x: prev.panOffset.x * ratio,
          y: prev.panOffset.y * ratio,
        };

        return {
          ...prev,
          zoom: newZoom,
          fitMode: 'auto' as const,
          panOffset: clampPanOffset(prev.naturalSize, newZoom, prev.rotation, scaledPan),
        };
      });
    },
    [clampPanOffset]
  );

  const scaleZoomWithCenter = useCallback(
    (factor: number) => {
      setState((prev) => {
        const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom * factor));
        const ratio = prev.zoom > 0 ? newZoom / prev.zoom : 1;
        const scaledPan = {
          x: prev.panOffset.x * ratio,
          y: prev.panOffset.y * ratio,
        };

        return {
          ...prev,
          zoom: newZoom,
          fitMode: 'auto' as const,
          panOffset: clampPanOffset(prev.naturalSize, newZoom, prev.rotation, scaledPan),
        };
      });
    },
    [clampPanOffset]
  );

  const renderedSize = getRenderedSize(
    state.naturalSize.width,
    state.naturalSize.height,
    state.zoom,
    state.rotation
  );
  const isImageOverflowing =
    !!state.imageSrc &&
    viewportSize.width > 0 &&
    viewportSize.height > 0 &&
    (renderedSize.width > viewportSize.width || renderedSize.height > viewportSize.height);

  // ---- Image loading ----

  const openImage = useCallback(
    async (filePath: string, imageList?: string[], index?: number) => {
      const myRequestId = ++requestIdRef.current;
      updateGifPause(null);
      gifClickSequenceRef.current = null;

      setState((prev) => ({
        ...prev,
        isLoading: true,
        errorMessage: null,
        panOffset: { x: 0, y: 0 },
        rotation: 0,
      }));

      try {
        const result = await loadImage(filePath);

        // Stale request guard
        if (requestIdRef.current !== myRequestId) return;

        const naturalW = result.naturalWidth;
        const naturalH = result.naturalHeight;

        // Calculate initial zoom based on screen size (stable, not window-dependent)
        const screenW = window.screen.availWidth * SCREEN_FIT_RATIO;
        const screenH = window.screen.availHeight * SCREEN_FIT_RATIO;

        let initialZoom = 1;
        if (naturalW > screenW || naturalH > screenH) {
          const scaleX = screenW / naturalW;
          const scaleY = screenH / naturalH;
          initialZoom = Math.min(scaleX, scaleY);
        }

        // Resize window to match image
        const winW = Math.max(MIN_WINDOW_SIZE, Math.round(naturalW * initialZoom));
        const winH = Math.max(MIN_WINDOW_SIZE, Math.round(naturalH * initialZoom));

        try {
          await invoke('resize_window', { width: winW, height: winH });

          // Apply saved window position if available, otherwise center
          if (
            settingsRef.current.rememberWindowPosition &&
            settingsRef.current.lastWindowBounds
          ) {
            const bounds = settingsRef.current.lastWindowBounds;
            const appWindow = getCurrentWindow();
            await appWindow.setPosition(
              new LogicalPosition(bounds.x, bounds.y)
            );
          } else {
            const appWindow = getCurrentWindow();
            await appWindow.center();
          }
        } catch {
          // Window operations may fail, continue
        }

        // Stale request guard after async window ops
        if (requestIdRef.current !== myRequestId) return;

        // Use the TARGET window size for fit zoom calculation,
        // not window.innerWidth which may not have updated yet
        const fitZoom = calculateFitZoomForSize(naturalW, naturalH, 0, winW, winH);

        setState((prev) => ({
          ...prev,
          currentFilePath: filePath,
          imageList: imageList ?? prev.imageList,
          currentIndex: index ?? prev.currentIndex,
          imageSrc: result.src,
          fileName: result.fileName,
          fileSize: result.fileSize,
          originalExtension: result.originalExtension,
          naturalSize: { width: naturalW, height: naturalH },
          zoom: fitZoom,
          fitMode: 'auto',
          panOffset: { x: 0, y: 0 },
          rotation: 0,
          isLoading: false,
          errorMessage: null,
        }));

        // Preload adjacent images
        const list = imageList ?? state.imageList;
        const idx = index ?? state.currentIndex;
        const toPreload: string[] = [];
        if (idx > 0) toPreload.push(list[idx - 1]);
        if (idx < list.length - 1) toPreload.push(list[idx + 1]);
        if (toPreload.length > 0) {
          preloadImages(toPreload);
        }
      } catch (err: unknown) {
        // Stale request guard on error path too
        if (requestIdRef.current !== myRequestId) return;

        setState((prev) => ({
          ...prev,
          isLoading: false,
          errorMessage: getErrorMessage(err, 'error.imageLoadFailed'),
        }));
      }
    },
    [
      getErrorMessage,
      loadImage,
      preloadImages,
      calculateFitZoomForSize,
      state.imageList,
      state.currentIndex,
      updateGifPause,
    ]
  );

  // ---- Tauri native drag-and-drop ----
  // Use a ref so the listener callback always reads the latest scanFolder/openImage
  // without causing the effect (and thus the Tauri listener) to re-register.

  const fileDropRef = useRef<(paths: string[]) => void>(() => {});
  fileDropRef.current = (paths: string[]) => {
    if (paths.length === 0) return;
    const filePath = paths[0];

    (async () => {
      try {
        const imageList = await scanFolder(filePath);
        const index = imageList.findIndex(
          (p) => p.toLowerCase() === filePath.toLowerCase()
        );
        openImage(filePath, imageList, Math.max(0, index));
      } catch {
        openImage(filePath, [filePath], 0);
      }
    })();
  };

  // ---- Navigation ----

  const navigateImage = useCallback(
    (direction: 1 | -1) => {
      if (state.imageList.length <= 1) return;

      let newIndex = state.currentIndex + direction;
      const loop = settingsRef.current.loopNavigation;

      if (newIndex < 0) {
        newIndex = loop ? state.imageList.length - 1 : 0;
      } else if (newIndex >= state.imageList.length) {
        newIndex = loop ? 0 : state.imageList.length - 1;
      }

      if (newIndex === state.currentIndex) return;

      const newPath = state.imageList[newIndex];
      openImage(newPath, state.imageList, newIndex);
    },
    [state.imageList, state.currentIndex, openImage]
  );

  // ---- Zoom ----

  const zoomIn = useCallback(() => {
    scaleZoomWithCenter(1 + ZOOM_STEP);
  }, [scaleZoomWithCenter]);

  const zoomOut = useCallback(() => {
    scaleZoomWithCenter(1 - ZOOM_STEP);
  }, [scaleZoomWithCenter]);

  const setOriginalSize = useCallback(() => {
    setState((prev) => ({
      ...prev,
      zoom: 1,
      fitMode: 'original' as const,
      panOffset: { x: 0, y: 0 },
    }));
  }, []);

  const fitToScreen = useCallback(() => {
    setState((prev) => {
      const fitZoom = calculateFitZoom(
        prev.naturalSize.width,
        prev.naturalSize.height,
        prev.rotation
      );
      return {
        ...prev,
        zoom: fitZoom,
        fitMode: 'fit' as const,
        panOffset: { x: 0, y: 0 },
      };
    });
  }, [calculateFitZoom]);

  // ---- Rotation ----

  const rotate = useCallback(() => {
    setState((prev) => {
      const newRotation = ((prev.rotation + 90) % 360) as Rotation;
      const fitZoom = calculateFitZoom(
        prev.naturalSize.width,
        prev.naturalSize.height,
        newRotation
      );
      return {
        ...prev,
        rotation: newRotation,
        zoom: fitZoom,
        panOffset: { x: 0, y: 0 },
      };
    });
  }, [calculateFitZoom]);

  // ---- Always on top ----

  const toggleAlwaysOnTop = useCallback(async () => {
    const newValue = !state.isAlwaysOnTop;
    try {
      await invoke('set_always_on_top', { onTop: newValue });
      setState((prev) => ({ ...prev, isAlwaysOnTop: newValue }));

      const nextSettings: Settings = {
        ...settingsRef.current,
        alwaysOnTopDefault: newValue,
      };

      settingsRef.current = nextSettings;

      void saveSettings(nextSettings).catch((error) => {
        console.warn('Failed to save always-on-top setting.', error);
      });
    } catch {
      // Ignore errors
    }
  }, [state.isAlwaysOnTop, saveSettings]);

  // ---- Background mode ----

  const toggleBackgroundMode = useCallback(() => {
    const nextMode: BackgroundMode = backgroundMode === 'dark' ? 'light' : 'dark';
    const nextSettings: Settings = {
      ...settingsRef.current,
      backgroundMode: nextMode,
    };

    settingsRef.current = nextSettings;
    setBackgroundMode(nextMode);

    void saveSettings(nextSettings).catch((error) => {
      console.warn('Failed to save background mode setting.', error);
    });
  }, [backgroundMode, saveSettings]);

  // ---- Close ----

  const closeApp = useCallback(async () => {
    try {
      await saveSettings(settingsRef.current);
    } catch {
      // Ignore
    }
    const appWindow = getCurrentWindow();
    await appWindow.close();
  }, [saveSettings]);

  // ---- Context menu actions ----

  const handleContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      if (!state.currentFilePath || state.isLoading || state.errorMessage) {
        closeContextMenu();
        return;
      }

      const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - CONTEXT_MENU_WIDTH - VIEWPORT_MARGIN);
      const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - VIEWPORT_MARGIN);
      const x = Math.max(VIEWPORT_MARGIN, Math.min(event.clientX, maxX));
      const y = Math.max(VIEWPORT_MARGIN, Math.min(event.clientY, maxY));
      const canOpenSubmenuRight =
        x + CONTEXT_MENU_WIDTH + CONTEXT_SUBMENU_WIDTH + VIEWPORT_MARGIN <= window.innerWidth;
      const canOpenSubmenuLeft = x - CONTEXT_SUBMENU_WIDTH - VIEWPORT_MARGIN >= 0;
      const submenuDirection = canOpenSubmenuRight ? 'right' : canOpenSubmenuLeft ? 'left' : 'stacked';
      const submenuVerticalDirection =
        event.clientY >= window.innerHeight / 2 ? 'up' : 'down';

      setContextMenu({ x, y, submenuDirection, submenuVerticalDirection });
    },
    [closeContextMenu, state.currentFilePath, state.errorMessage, state.isLoading]
  );

  // Clamp the rendered menu using its real dimensions. Menu content can grow
  // when labels or registered custom apps change, so a fixed height estimate
  // can leave the bottom actions outside the window.
  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;

    const menu = contextMenuRef.current;
    const reposition = () => {
      const rect = menu.getBoundingClientRect();
      const availableHeight = Math.max(0, window.innerHeight - VIEWPORT_MARGIN * 2);
      const needsVerticalScroll = rect.height > availableHeight;
      const visibleHeight = Math.min(rect.height, availableHeight);
      const maxX = Math.max(
        VIEWPORT_MARGIN,
        window.innerWidth - rect.width - VIEWPORT_MARGIN
      );
      const maxY = Math.max(
        VIEWPORT_MARGIN,
        window.innerHeight - visibleHeight - VIEWPORT_MARGIN
      );
      const x = Math.max(VIEWPORT_MARGIN, Math.min(contextMenu.x, maxX));
      const y = Math.max(VIEWPORT_MARGIN, Math.min(contextMenu.y, maxY));
      const submenuDirection = needsVerticalScroll
        ? 'stacked'
        : contextMenu.submenuDirection;

      if (
        x !== contextMenu.x ||
        y !== contextMenu.y ||
        submenuDirection !== contextMenu.submenuDirection
      ) {
        setContextMenu((current) =>
          current
            ? {
                ...current,
                x,
                y,
                submenuDirection,
              }
            : current
        );
      }
    };

    reposition();
    const observer = new ResizeObserver(reposition);
    observer.observe(menu);
    return () => observer.disconnect();
  }, [contextMenu]);

  const handleRevealInExplorer = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      await revealItemInDir(state.currentFilePath);
    } catch {
      showToast(t('toast.revealFailed'));
    }
  }, [closeContextMenu, showToast, state.currentFilePath, t]);

  const handleCopyImageFromMenu = useCallback(() => {
    closeContextMenu();
    void handleCopyImage();
  }, [closeContextMenu, handleCopyImage]);

  const handleCopyPath = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      await writeText(state.currentFilePath);
      showToast(t('toast.pathCopySuccess'));
    } catch (error) {
      console.warn('Failed to copy file path:', error);
      showToast(t('toast.pathCopyFailed'));
    }
  }, [closeContextMenu, showToast, state.currentFilePath, t]);

  const handleOpenDefaultApp = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      await invoke('open_with_default_app', { path: state.currentFilePath });
    } catch (error) {
      console.warn('Failed to open with default app:', error);
      showToast(getCommandErrorToast(error, 'error.openFailed'));
    }
  }, [closeContextMenu, getCommandErrorToast, showToast, state.currentFilePath]);

  const handleMoveFile = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath || isMovingRef.current) {
      if (isMovingRef.current) showToast(t('toast.moveAlreadyRunning'));
      return;
    }

    let selected: string | string[] | null;
    try {
      selected = await openDialog({
        multiple: false,
        directory: true,
        title: t('dialog.moveFolderTitle'),
      });
    } catch {
      showToast(t('toast.moveDialogFailed'));
      return;
    }

    if (typeof selected !== 'string') return;

    const filePathAtStart = state.currentFilePath;
    isMovingRef.current = true;
    requestIdRef.current += 1;

    try {
      await invoke<string>('move_file_to_folder', {
        filePath: filePathAtStart,
        targetFolder: selected,
      });

      const nextList = state.imageList.filter(
        (path) => path.toLowerCase() !== filePathAtStart.toLowerCase()
      );

      if (nextList.length === 0) {
        requestIdRef.current += 1;
        setState((prev) => ({
          ...prev,
          currentFilePath: null,
          imageList: [],
          currentIndex: -1,
          zoom: 1,
          rotation: 0,
          fitMode: 'auto',
          panOffset: { x: 0, y: 0 },
          naturalSize: { width: 0, height: 0 },
          isLoading: false,
          errorMessage: null,
          imageSrc: null,
          fileName: '',
          fileSize: 0,
          originalExtension: null,
        }));
        showToast(t('toast.moveSuccess'));
        return;
      }

      const removedIndex = Math.max(0, state.currentIndex);
      const nextIndex = Math.min(removedIndex, nextList.length - 1);
      await openImage(nextList[nextIndex], nextList, nextIndex);
      showToast(t('toast.moveSuccess'));
    } catch (error) {
      console.warn('Failed to move file:', error);
      showToast(getCommandErrorToast(error, 'toast.moveFailed'));
    } finally {
      isMovingRef.current = false;
    }
  }, [
    closeContextMenu,
    getCommandErrorToast,
    openImage,
    showToast,
    state.currentFilePath,
    state.currentIndex,
    state.imageList,
    t,
  ]);

  const handleSaveAs = useCallback(async () => {
    closeContextMenu();

    if (!state.currentFilePath || state.isLoading || state.errorMessage) return;
    if (isSavingRef.current) {
      showToast(t('toast.saveAlreadyRunning'));
      return;
    }

    const filePathAtStart = state.currentFilePath;
    const ext = state.originalExtension?.toLowerCase() ?? null;
    const filters = ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : undefined;

    let target: string | null;
    try {
      target = await saveDialog({
        defaultPath: filePathAtStart,
        filters,
      });
    } catch {
      showToast(t('toast.saveDialogFailed'));
      return;
    }

    if (typeof target !== 'string') return;

    isSavingRef.current = true;
    try {
      await invoke<string>('save_image_as', {
        filePath: filePathAtStart,
        targetPath: target,
      });
      showToast(t('toast.saveSuccess'));
    } catch (error) {
      console.warn('Failed to save image:', error);
      showToast(getCommandErrorToast(error, 'toast.saveFailed'));
    } finally {
      isSavingRef.current = false;
    }
  }, [
    closeContextMenu,
    getCommandErrorToast,
    showToast,
    state.currentFilePath,
    state.errorMessage,
    state.isLoading,
    state.originalExtension,
    t,
  ]);

  const handleRequestRename = useCallback(() => {
    closeContextMenu();
    if (!state.currentFilePath || state.isLoading || state.errorMessage) return;

    const fileName =
      state.fileName || state.currentFilePath.split(/[\\/]/).pop() || t('app.fileFallback');
    const extensionIndex = fileName.lastIndexOf('.');
    const hasExtension = extensionIndex > 0 && extensionIndex < fileName.length - 1;
    const name = hasExtension ? fileName.slice(0, extensionIndex) : fileName;
    const extension = hasExtension ? fileName.slice(extensionIndex) : '';

    setRenameDraft({
      filePath: state.currentFilePath,
      originalName: name,
      name,
      extension,
    });
  }, [closeContextMenu, state.currentFilePath, state.errorMessage, state.fileName, state.isLoading, t]);

  const handleConfirmRename = useCallback(async () => {
    if (!renameDraft) return;
    if (isRenamingRef.current) {
      showToast(t('toast.renameAlreadyRunning'));
      return;
    }

    if (renameDraft.name === renameDraft.originalName) {
      setRenameDraft(null);
      return;
    }

    const draft = renameDraft;
    isRenamingRef.current = true;

    try {
      const renamedPath = await invoke<string>('rename_file', {
        filePath: draft.filePath,
        newName: draft.name,
      });
      invalidateImage(draft.filePath);

      let rescannedList: string[] | null = null;
      try {
        rescannedList = await scanFolder(renamedPath);
      } catch {
        // The rename itself succeeded. Fall back to replacing the path in the current list.
      }

      const pathMatches = (path: string) =>
        path.toLowerCase() === draft.filePath.toLowerCase();
      const renamedFileName = renamedPath.split(/[\\/]/).pop() || `${draft.name}${draft.extension}`;

      setState((prev) => {
        if (!prev.currentFilePath || !pathMatches(prev.currentFilePath)) return prev;

        const fallbackList = prev.imageList.map((path) => (pathMatches(path) ? renamedPath : path));
        const imageList = rescannedList && rescannedList.length > 0 ? rescannedList : fallbackList;
        const currentIndex = imageList.findIndex(
          (path) => path.toLowerCase() === renamedPath.toLowerCase()
        );

        return {
          ...prev,
          currentFilePath: renamedPath,
          fileName: renamedFileName,
          imageList,
          currentIndex: currentIndex >= 0 ? currentIndex : prev.currentIndex,
        };
      });

      if (gifPauseRef.current && pathMatches(gifPauseRef.current.filePath)) {
        updateGifPause({ ...gifPauseRef.current, filePath: renamedPath });
      }
      if (gifClickSequenceRef.current && pathMatches(gifClickSequenceRef.current.filePath)) {
        gifClickSequenceRef.current = { ...gifClickSequenceRef.current, filePath: renamedPath };
      }
      if (
        fullscreenSnapshotRef.current?.currentFilePath &&
        pathMatches(fullscreenSnapshotRef.current.currentFilePath)
      ) {
        fullscreenSnapshotRef.current = {
          ...fullscreenSnapshotRef.current,
          currentFilePath: renamedPath,
        };
      }

      setRenameDraft(null);
      showToast(t('toast.renameSuccess', { name: renamedFileName }));
    } catch (error) {
      console.warn('Failed to rename file:', error);
      showToast(getCommandErrorToast(error, 'toast.renameFailed'));
    } finally {
      isRenamingRef.current = false;
    }
  }, [
    getCommandErrorToast,
    invalidateImage,
    renameDraft,
    scanFolder,
    showToast,
    t,
    updateGifPause,
  ]);

  const handleMoveToTrash = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath || isTrashingRef.current || isMovingRef.current) {
      if (isTrashingRef.current) showToast(t('toast.trashAlreadyRunning'));
      if (isMovingRef.current) showToast(t('toast.moveAlreadyRunning'));
      return;
    }

    const previousState = state;
    const previousGifPause = gifPauseRef.current;
    const filePathAtStart = state.currentFilePath;
    const fileNameAtStart =
      state.fileName || filePathAtStart.split(/[\\/]/).pop() || t('app.fileFallback');
    const trashRequestId = ++requestIdRef.current;

    isTrashingRef.current = true;
    updateGifPause(null);
    gifClickSequenceRef.current = null;

    setState((prev) => ({
      ...prev,
      currentFilePath: null,
      imageSrc: null,
      isLoading: true,
      errorMessage: null,
    }));

    await waitForNextFrame();

    try {
      await invoke('move_file_to_trash', { filePath: filePathAtStart });
      if (requestIdRef.current !== trashRequestId) return;

      const nextList = previousState.imageList.filter(
        (path) => path.toLowerCase() !== filePathAtStart.toLowerCase()
      );

      if (nextList.length === 0) {
        requestIdRef.current += 1;
        setState((prev) => ({
          ...prev,
          currentFilePath: null,
          imageList: [],
          currentIndex: -1,
          zoom: 1,
          rotation: 0,
          fitMode: 'auto',
          panOffset: { x: 0, y: 0 },
          naturalSize: { width: 0, height: 0 },
          isLoading: false,
          errorMessage: null,
          imageSrc: null,
          fileName: '',
          fileSize: 0,
          originalExtension: null,
        }));
        showToast(t('toast.trashed', { name: fileNameAtStart }));
        return;
      }

      const removedIndex = Math.max(0, previousState.currentIndex);
      const nextIndex = Math.min(removedIndex, nextList.length - 1);
      await openImage(nextList[nextIndex], nextList, nextIndex);
      showToast(t('toast.trashed', { name: fileNameAtStart }));
    } catch (error) {
      console.warn('Failed to move file to trash:', error);
      if (requestIdRef.current === trashRequestId) {
        setState(previousState);
        updateGifPause(previousGifPause);
      }
      showToast(getCommandErrorToast(error, 'toast.trashFailed'));
    } finally {
      isTrashingRef.current = false;
    }
  }, [
    closeContextMenu,
    getCommandErrorToast,
    openImage,
    showToast,
    state,
    t,
    updateGifPause,
  ]);

  const handleOpenCustomApp = useCallback(
    async (app: CustomOpenApp) => {
      closeContextMenu();
      if (!state.currentFilePath) return;

      try {
        await invoke('open_with_custom_app', {
          filePath: state.currentFilePath,
          executablePath: app.executablePath,
        });
      } catch {
        showToast(t('toast.customAppLaunchFailed'));
      }
    },
    [closeContextMenu, showToast, state.currentFilePath, t]
  );

  const handleRegisterCustomApp = useCallback(async () => {
    closeContextMenu();

    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: t('dialog.customAppTitle'),
        filters: [{ name: t('dialog.executableFilter'), extensions: ['exe'] }],
      });

      if (typeof selected !== 'string') return;

      const defaultName = getExecutableDisplayName(selected);
      setRegistrationDraft({
        executablePath: selected,
        defaultName,
        name: defaultName,
      });
    } catch {
      showToast(t('toast.customAppDialogFailed'));
    }
  }, [closeContextMenu, getExecutableDisplayName, showToast, t]);

  const handleSaveRegistration = useCallback(async () => {
    if (!registrationDraft) return;

    const name = registrationDraft.name.trim() || registrationDraft.defaultName;
    const executablePath = registrationDraft.executablePath;
    const existingIndex = customOpenApps.findIndex(
      (app) => app.executablePath.toLowerCase() === executablePath.toLowerCase()
    );
    const nextApps =
      existingIndex >= 0
        ? customOpenApps.map((app, index) =>
            index === existingIndex ? { ...app, name, executablePath } : app
          )
        : [
            ...customOpenApps,
            {
              id: createCustomAppId(),
              name,
              executablePath,
            },
          ];

    try {
      await saveCustomOpenApps(nextApps);
      setRegistrationDraft(null);
      showToast(existingIndex >= 0 ? t('toast.customAppUpdated') : t('toast.customAppRegistered'));
    } catch {
      showToast(t('toast.customAppSaveFailed'));
    }
  }, [createCustomAppId, customOpenApps, registrationDraft, saveCustomOpenApps, showToast, t]);

  const handleRequestRemoveCustomApp = useCallback(
    (app: CustomOpenApp) => {
      closeContextMenu();
      setRemoveTarget(app);
    },
    [closeContextMenu]
  );

  const handleConfirmRemoveCustomApp = useCallback(async () => {
    if (!removeTarget) return;

    const nextApps = customOpenApps.filter((app) => app.id !== removeTarget.id);

    try {
      await saveCustomOpenApps(nextApps);
      setRemoveTarget(null);
      showToast(t('toast.customAppRemoved'));
    } catch {
      showToast(t('toast.customAppRemoveFailed'));
    }
  }, [customOpenApps, removeTarget, saveCustomOpenApps, showToast, t]);

  const handlePrintFile = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      await invoke('print_file', { path: state.currentFilePath });
    } catch (error) {
      showToast(getCommandErrorToast(error, 'toast.printFailed'));
    }
  }, [closeContextMenu, getCommandErrorToast, showToast, state.currentFilePath]);

  // ---- Mouse wheel zoom ----

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!state.imageSrc || state.isLoading || state.errorMessage) return;

      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    },
    [state.imageSrc, state.isLoading, state.errorMessage, zoomIn, zoomOut]
  );

  // ---- Drag / Pan ----

  const getDragMode = useCallback(
    (altKey: boolean): DragMode => {
      if (altKey) return 'window-move';

      const viewport = getViewportSize();
      const rendered = getRenderedSize(
        state.naturalSize.width,
        state.naturalSize.height,
        state.zoom,
        state.rotation
      );

      if (rendered.width > viewport.width || rendered.height > viewport.height) {
        return 'image-pan';
      }
      return 'window-move';
    },
    [state.naturalSize, state.zoom, state.rotation, getViewportSize, getRenderedSize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (contextMenu) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.overlay-btn') || target.closest('.overlay-container')) {
        return;
      }
      if (state.imageSrc && target.closest('.image-container') && e.detail > 1) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const mode = getDragMode(e.altKey);
      dragModeRef.current = mode;
      isDraggingRef.current = true;
      hasDraggedRef.current = false;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...state.panOffset };

      if (mode === 'window-move') {
        const appWindow = getCurrentWindow();
        void appWindow.startDragging().catch((error) => {
          console.warn('Failed to start window dragging:', error);
        });
        isDraggingRef.current = false;
      }

      e.preventDefault();
    },
    [contextMenu, getDragMode, state.imageSrc, state.panOffset]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      overlay.handleMouseMove();

      if (!isDraggingRef.current || dragModeRef.current !== 'image-pan') return;

      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        hasDraggedRef.current = true;
      }

      const viewport = getViewportSize();
      const rendered = getRenderedSize(
        state.naturalSize.width,
        state.naturalSize.height,
        state.zoom,
        state.rotation
      );

      let newX = panStartRef.current.x + dx;
      let newY = panStartRef.current.y + dy;

      if (rendered.width <= viewport.width) {
        newX = 0;
      } else {
        const maxPanX = (rendered.width - viewport.width) / 2;
        newX = Math.max(-maxPanX, Math.min(maxPanX, newX));
      }

      if (rendered.height <= viewport.height) {
        newY = 0;
      } else {
        const maxPanY = (rendered.height - viewport.height) / 2;
        newY = Math.max(-maxPanY, Math.min(maxPanY, newY));
      }

      setState((prev) => ({
        ...prev,
        panOffset: { x: newX, y: newY },
      }));
    },
    [overlay, state.naturalSize, state.zoom, state.rotation, getViewportSize, getRenderedSize]
  );

  const handleMouseUp = useCallback(() => {
    isDraggingRef.current = false;
    dragModeRef.current = 'none';
  }, []);

  const handleMoveMouseDown = useCallback(async (event: React.MouseEvent) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      await getCurrentWindow().startDragging();
    } catch (error) {
      console.warn('Failed to start window dragging:', error);
    }
  }, []);

  const handleImageClick = useCallback(
    (event: React.MouseEvent<HTMLImageElement>) => {
      if (
        !state.currentFilePath ||
        !state.imageSrc ||
        state.originalExtension?.toLowerCase() !== 'gif' ||
        hasDraggedRef.current
      ) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const currentFilePath = state.currentFilePath;
      if (event.detail === 1 || gifClickSequenceRef.current?.filePath !== currentFilePath) {
        gifClickSequenceRef.current = {
          filePath: currentFilePath,
          initialPause: gifPauseRef.current,
          count: 0,
        };
      }
      gifClickSequenceRef.current.count += 1;

      const currentPause = gifPauseRef.current;
      if (currentPause?.filePath === currentFilePath) {
        updateGifPause(null);
        return;
      }

      const imageElement = viewerImageRef.current;
      if (!imageElement || imageElement.naturalWidth <= 0 || imageElement.naturalHeight <= 0) {
        showToast(t('toast.gifPauseFailed'));
        return;
      }

      try {
        const canvas = document.createElement('canvas');
        canvas.width = imageElement.naturalWidth;
        canvas.height = imageElement.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
          showToast(t('toast.gifPauseFailed'));
          return;
        }

        context.drawImage(imageElement, 0, 0, canvas.width, canvas.height);
        updateGifPause({
          filePath: currentFilePath,
          pausedSrc: canvas.toDataURL('image/png'),
        });
      } catch (error) {
        console.warn('Failed to pause GIF:', error);
        showToast(t('toast.gifPauseFailed'));
      }
    },
    [
      showToast,
      state.currentFilePath,
      state.imageSrc,
      state.originalExtension,
      t,
      updateGifPause,
    ]
  );

  const handleViewerDoubleClick = useCallback(
    async (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const gifClickSequence = gifClickSequenceRef.current;
      if (gifClickSequence?.filePath === state.currentFilePath) {
        updateGifPause(gifClickSequence.initialPause);
        gifClickSequenceRef.current = null;
      }

      if (isFullscreenProcessingRef.current || !state.imageSrc) return;
      isFullscreenProcessingRef.current = true;

      try {
        const appWindow = getCurrentWindow();
        const isFullscreen = await appWindow.isFullscreen();

        if (!isFullscreen) {
          fullscreenSnapshotRef.current = {
            currentFilePath: state.currentFilePath,
            zoom: state.zoom,
            fitMode: state.fitMode,
            panOffset: { ...state.panOffset },
          };

          await appWindow.setFullscreen(true);
          await waitForNextFrame();
          await waitForNextFrame();

          const rect = viewerRef.current?.getBoundingClientRect();
          const width = rect && rect.width > 0 ? rect.width : window.innerWidth;
          const height = rect && rect.height > 0 ? rect.height : window.innerHeight;
          const fitZoom = calculateFitZoomForSize(
            state.naturalSize.width,
            state.naturalSize.height,
            state.rotation,
            width,
            height
          );

          setState((prev) => ({
            ...prev,
            zoom: fitZoom,
            fitMode: 'fit',
            panOffset: { x: 0, y: 0 },
          }));
          return;
        }

        await appWindow.setFullscreen(false);

        const snapshot = fullscreenSnapshotRef.current;
        fullscreenSnapshotRef.current = null;

        if (snapshot && snapshot.currentFilePath === state.currentFilePath) {
          setState((prev) => ({
            ...prev,
            zoom: snapshot.zoom,
            fitMode: snapshot.fitMode,
            panOffset: snapshot.panOffset,
          }));
        }
      } catch {
        // Ignore fullscreen failures; the viewer remains usable.
      } finally {
        isFullscreenProcessingRef.current = false;
      }
    },
    [
      calculateFitZoomForSize,
      state.currentFilePath,
      state.fitMode,
      state.imageSrc,
      state.naturalSize.height,
      state.naturalSize.width,
      state.panOffset,
      state.rotation,
      state.zoom,
      updateGifPause,
    ]
  );

  const saveWindowBounds = useCallback(async () => {
    if (!settingsRef.current.rememberWindowPosition) return;

    try {
      const appWindow = getCurrentWindow();
      const pos = await appWindow.outerPosition();
      const size = await appWindow.innerSize();
      settingsRef.current.lastWindowBounds = {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
      };
      await saveSettings(settingsRef.current);
    } catch {
      // Ignore
    }
  }, [saveSettings]);

  const scheduleSaveWindowBounds = useCallback(() => {
    if (!settingsRef.current.rememberWindowPosition) return;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      saveWindowBounds();
    }, 500);
  }, [saveWindowBounds]);

  // ---- Keyboard shortcuts ----

  useKeyboardShortcuts({
    onClose: closeApp,
    onPrevImage: () => navigateImage(-1),
    onNextImage: () => navigateImage(1),
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onOriginalSize: setOriginalSize,
    onFitScreen: fitToScreen,
    onToggleAlwaysOnTop: toggleAlwaysOnTop,
    onRotate: rotate,
    canCopyImage,
    onCopyImage: () => {
      void handleCopyImage();
    },
    onMoveFile: () => {
      void handleMoveFile();
    },
    onMoveToTrash: () => {
      void handleMoveToTrash();
    },
    onSaveAs: () => {
      void handleSaveAs();
    },
    isEnabled: () => !contextMenu && !registrationDraft && !renameDraft && !removeTarget,
  });

  // ---- Context menu dismissal ----

  useEffect(() => {
    if (!contextMenu) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (contextMenuRef.current?.contains(target)) return;
      closeContextMenu();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeContextMenu();
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', closeContextMenu);
    window.addEventListener('resize', closeContextMenu);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
    };
  }, [closeContextMenu, contextMenu]);

  // ---- Viewer resize handler ----

  useEffect(() => {
    const el = viewerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;

      setViewportSize((prev) => {
        if (prev.width === width && prev.height === height) return prev;
        return { width, height };
      });

      setState((prev) => {
        if (prev.fitMode === 'fit') {
          const fitZoom = calculateFitZoomForSize(
            prev.naturalSize.width,
            prev.naturalSize.height,
            prev.rotation,
            width,
            height
          );
          return { ...prev, zoom: fitZoom, panOffset: { x: 0, y: 0 } };
        }
        return prev;
      });

      closeContextMenu();
      scheduleSaveWindowBounds();
    });

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [calculateFitZoomForSize, closeContextMenu, scheduleSaveWindowBounds]);

  // ---- Window move handler ----
  // Native Tauri move events catch borderless window dragging, which does not
  // trigger the browser resize event.

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      try {
        const appWindow = getCurrentWindow();
        const unlisten = await appWindow.onMoved(() => {
          closeContextMenu();
          scheduleSaveWindowBounds();
        });

        if (cancelled) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      } catch {
        // Tauri window move event not available in this environment
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
  }, [closeContextMenu, scheduleSaveWindowBounds]);

  // ---- Tauri native drag-drop event listener ----
  // Registered once on mount. Uses fileDropRef to avoid re-registration.
  // cancelled flag guards against cleanup racing the async setup.

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    const setup = async () => {
      try {
        const appWindow = getCurrentWindow();
        const unlisten = await appWindow.onDragDropEvent((event) => {
          if (event.payload.type === 'drop') {
            const paths = event.payload.paths;
            if (paths && paths.length > 0) {
              fileDropRef.current(paths);
            }
          }
        });

        // If effect was cleaned up while we were awaiting, immediately unlisten
        if (cancelled) {
          unlisten();
        } else {
          unlistenFn = unlisten;
        }
      } catch {
        // Tauri drag-drop event not available in this environment
      }
    };

    setup();

    return () => {
      cancelled = true;
      if (unlistenFn) unlistenFn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Initial load ----

  useEffect(() => {
    const init = async () => {
      // Load settings
      try {
        const settings = await loadSettings();
        const normalizedMode = normalizeBackgroundMode(settings.backgroundMode);
        const normalizedSettings: Settings = {
          ...settings,
          backgroundMode: normalizedMode,
        };

        settingsRef.current = normalizedSettings;
        setBackgroundMode(normalizedMode);
        setCustomOpenApps(normalizedSettings.customOpenApps ?? []);

        // Apply always-on-top default
        if (normalizedSettings.alwaysOnTopDefault) {
          await invoke('set_always_on_top', { onTop: true });
          setState((prev) => ({ ...prev, isAlwaysOnTop: true }));
        }

        // Apply saved window position/size (restored on startup)
        if (normalizedSettings.rememberWindowPosition && normalizedSettings.lastWindowBounds) {
          const bounds = normalizedSettings.lastWindowBounds;
          try {
            await invoke('resize_window', {
              width: bounds.width,
              height: bounds.height,
            });
            const appWindow = getCurrentWindow();
            await appWindow.setPosition(new LogicalPosition(bounds.x, bounds.y));
          } catch {
            // Ignore — will use defaults
          }
        }
      } catch {
        // Use defaults
      }

      // Check CLI args for initial image
      try {
        const args = await getCliArgs();
        if (args.length > 1) {
          const imagePath = args[1];
          const imageList = await scanFolder(imagePath);
          const index = imageList.findIndex(
            (p) => p.toLowerCase() === imagePath.toLowerCase()
          );
          await openImage(imagePath, imageList, Math.max(0, index));
          return;
        }
      } catch {
        // No CLI args
      }

      // If no image provided, show empty state
      setState((prev) => ({ ...prev, isLoading: false }));
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Cursor style ----

  const getCursorStyle = useCallback((): string => {
    if (isDraggingRef.current && dragModeRef.current === 'image-pan') return 'grabbing';

    const viewport = getViewportSize();
    const rendered = getRenderedSize(
      state.naturalSize.width,
      state.naturalSize.height,
      state.zoom,
      state.rotation
    );

    if (rendered.width > viewport.width || rendered.height > viewport.height) {
      return 'grab';
    }
    return 'default';
  }, [state.naturalSize, state.zoom, state.rotation, getViewportSize, getRenderedSize]);

  // ---- Render ----

  const renderImage = () => {
    if (state.isLoading) {
      return (
        <div className="loading-view">
          <div className="loading-spinner" />
        </div>
      );
    }

    if (state.errorMessage) {
      return <ErrorView message={state.errorMessage} t={t} onClose={closeApp} />;
    }

    if (!state.imageSrc) {
      return (
        <div className="empty-view">
          <div className="empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" opacity="0.4">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </div>
          <p className="empty-text">{t('empty.dragImage')}</p>
        </div>
      );
    }

    const transform = `
      translate(${state.panOffset.x}px, ${state.panOffset.y}px)
      rotate(${state.rotation}deg)
      scale(${state.zoom})
    `;
    const displaySrc =
      gifPause?.filePath === state.currentFilePath ? gifPause.pausedSrc : state.imageSrc;

    return (
      <img
        ref={viewerImageRef}
        src={displaySrc}
        alt={state.fileName}
        className="viewer-image"
        crossOrigin="anonymous"
        style={{
          transform,
          transformOrigin: 'center center',
        }}
        onClick={handleImageClick}
        draggable={false}
      />
    );
  };

  return (
    <div
      className={`app-container theme-${backgroundMode} ${state.isAlwaysOnTop ? 'pinned' : ''}`}
      style={{ cursor: getCursorStyle() }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        handleMouseUp();
        overlay.handleMouseLeave();
      }}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
    >
      <div
        ref={viewerRef}
        className="image-container"
        onDoubleClick={handleViewerDoubleClick}
      >
        {renderImage()}
      </div>

      {isImageOverflowing && (
        <div className="window-move-zone">
          <button
            type="button"
            className="window-move-handle"
            title={t('window.move')}
            aria-label={t('window.move')}
            onMouseDown={handleMoveMouseDown}
          >
            <svg width="24" height="12" viewBox="0 0 24 12" aria-hidden="true">
              <circle cx="6" cy="3" r="1.4" />
              <circle cx="12" cy="3" r="1.4" />
              <circle cx="18" cy="3" r="1.4" />
              <circle cx="6" cy="9" r="1.4" />
              <circle cx="12" cy="9" r="1.4" />
              <circle cx="18" cy="9" r="1.4" />
            </svg>
          </button>
        </div>
      )}

      <OverlayControls
        isVisible={overlay.isVisible}
        isAlwaysOnTop={state.isAlwaysOnTop}
        backgroundMode={backgroundMode}
        currentIndex={state.currentIndex}
        totalImages={state.imageList.length}
        zoom={state.zoom}
        fileName={state.fileName}
        imageInfo={{
          filePath: state.currentFilePath,
          fileSize: state.fileSize,
          width: state.naturalSize.width,
          height: state.naturalSize.height,
          originalExtension: state.originalExtension,
        }}
        t={t}
        onClose={closeApp}
        onPrevImage={() => navigateImage(-1)}
        onNextImage={() => navigateImage(1)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onSetZoom={setZoomWithCenter}
        onOriginalSize={setOriginalSize}
        onFitScreen={fitToScreen}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
        onToggleBackgroundMode={toggleBackgroundMode}
        onRotate={rotate}
        onOverlayEnter={overlay.handleOverlayEnter}
        onOverlayLeave={overlay.handleOverlayLeave}
      />

      {contextMenu && (
        <ContextMenu
          menuRef={contextMenuRef}
          x={contextMenu.x}
          y={contextMenu.y}
          submenuDirection={contextMenu.submenuDirection}
          submenuVerticalDirection={contextMenu.submenuVerticalDirection}
          customApps={customOpenApps}
          t={t}
          onCopyImage={handleCopyImageFromMenu}
          onCopyPath={handleCopyPath}
          onReveal={handleRevealInExplorer}
          onOpenDefault={handleOpenDefaultApp}
          onMoveFile={handleMoveFile}
          onSaveAs={handleSaveAs}
          onRename={handleRequestRename}
          onMoveToTrash={handleMoveToTrash}
          onOpenCustom={handleOpenCustomApp}
          onRegisterApp={handleRegisterCustomApp}
          onRequestRemoveApp={handleRequestRemoveCustomApp}
          onPrint={handlePrintFile}
        />
      )}

      {registrationDraft && (
        <div className="modal-backdrop" onMouseDown={() => setRegistrationDraft(null)}>
          <div className="app-modal" onMouseDown={(event) => event.stopPropagation()}>
            <h2 className="app-modal-title">{t('modal.customAppTitle')}</h2>
            <p className="app-modal-path" title={registrationDraft.executablePath}>
              {registrationDraft.executablePath}
            </p>
            <label className="app-modal-label" htmlFor="custom-app-name">
              {t('modal.displayName')}
            </label>
            <input
              id="custom-app-name"
              className="app-modal-input"
              value={registrationDraft.name}
              placeholder={registrationDraft.defaultName}
              autoFocus
              onChange={(event) =>
                setRegistrationDraft((prev) =>
                  prev ? { ...prev, name: event.target.value } : prev
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSaveRegistration();
                if (event.key === 'Escape') setRegistrationDraft(null);
              }}
            />
            <div className="app-modal-actions">
              <button type="button" className="app-modal-button secondary" onClick={() => setRegistrationDraft(null)}>
                {t('button.cancel')}
              </button>
              <button type="button" className="app-modal-button primary" onClick={handleSaveRegistration}>
                {t('button.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameDraft && (
        <div className="modal-backdrop" onMouseDown={() => setRenameDraft(null)}>
          <div className="app-modal compact" onMouseDown={(event) => event.stopPropagation()}>
            <h2 className="app-modal-title">{t('modal.renameTitle')}</h2>
            <p className="app-modal-path" title={renameDraft.filePath}>
              {renameDraft.filePath}
            </p>
            <label className="app-modal-label" htmlFor="rename-file-name">
              {t('modal.renameLabel')}
            </label>
            <div className="rename-input-row">
              <input
                id="rename-file-name"
                className="app-modal-input"
                value={renameDraft.name}
                autoFocus
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) =>
                  setRenameDraft((prev) =>
                    prev ? { ...prev, name: event.target.value } : prev
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleConfirmRename();
                  if (event.key === 'Escape') setRenameDraft(null);
                }}
              />
              {renameDraft.extension && (
                <span className="rename-extension" aria-hidden="true">
                  {renameDraft.extension}
                </span>
              )}
            </div>
            <div className="app-modal-actions">
              <button type="button" className="app-modal-button secondary" onClick={() => setRenameDraft(null)}>
                {t('button.cancel')}
              </button>
              <button type="button" className="app-modal-button primary" onClick={() => void handleConfirmRename()}>
                {t('button.rename')}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div className="modal-backdrop" onMouseDown={() => setRemoveTarget(null)}>
          <div className="app-modal compact" onMouseDown={(event) => event.stopPropagation()}>
            <h2 className="app-modal-title">{t('modal.removeAppTitle')}</h2>
            <p className="app-modal-text">
              {t('modal.removeAppMessage', { name: removeTarget.name })}
            </p>
            <div className="app-modal-actions">
              <button type="button" className="app-modal-button secondary" onClick={() => setRemoveTarget(null)}>
                {t('button.cancel')}
              </button>
              <button type="button" className="app-modal-button danger" onClick={handleConfirmRemoveCustomApp}>
                {t('button.remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {toastMessage && <div className="toast-message">{toastMessage}</div>}
    </div>
  );
}

export default App;
