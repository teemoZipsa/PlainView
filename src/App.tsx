import { useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { writeImage, writeText } from '@tauri-apps/plugin-clipboard-manager';
import { revealItemInDir } from '@tauri-apps/plugin-opener';
import packageInfo from '../package.json';
import ContextMenu from './components/ContextMenu';
import OverlayControls from './components/OverlayControls';
import ErrorView from './components/ErrorView';
import SettingsModal from './components/SettingsModal';
import EmptyView from './components/EmptyView';
import AboutModal from './components/AboutModal';
import EmptyContextMenu, {
  EMPTY_CONTEXT_MENU_ESTIMATED_HEIGHT,
} from './components/EmptyContextMenu';
import WindowResizeHandles, {
  canStartWindowResize,
  type WindowResizeDirection,
  type WindowResizeState,
} from './components/WindowResizeHandles';
import { useImageLoader } from './hooks/useImageLoader';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useOverlayVisibility } from './hooks/useOverlayVisibility';
import { useFolderSync } from './hooks/useFolderSync';
import { useContextMenuController } from './hooks/useContextMenuController';
import { useSystemIntegration } from './hooks/useSystemIntegration';
import { commandErrorKeys, detectLocale, translate, type TranslationKey } from './i18n';
import { drawImageToCanvas } from './imageCanvas';
import {
  writeAdaptiveClipboard,
  type ClipboardFormatStatus,
} from './clipboardCopy';
import { SUPPORTED_IMAGE_EXTENSIONS } from './imageFormats';
import {
  clampPanOffsetToViewport,
  exceedsPanBoundary,
  hasPanOverflow,
  resolveViewportDimensions,
  shouldAutoSizeWindowForImage,
} from './windowGeometry';
import {
  getNextZoom,
  getWheelZoomTarget,
  getZoomTransition,
  type ZoomAnchor,
  type ZoomDirection,
} from './zoom';
import {
  createFittedView,
  getNextRotation,
  restoreViewTransform,
  type ViewTransformState,
} from './viewState';
import { LatestIntent } from './asyncIntent';
import {
  NativeDialogGuard,
  runWithNativeDialogGuard,
} from './nativeDialogGuard';
import { SerializedTaskQueue } from './serializedTaskQueue';
import { handleDialogKeyDown } from './modalKeyboard';
import type {
  ViewerState,
  Rotation,
  Settings,
  BackgroundMode,
  DragMode,
  FitMode,
  CustomOpenApp,
  CommandError,
  WindowBounds,
  SettingsDraft,
} from './types';
import './App.css';

const SCREEN_FIT_RATIO = 0.92;
const MIN_WINDOW_WIDTH = 280;
const MIN_WINDOW_HEIGHT = 240;

interface FullscreenSnapshot extends ViewTransformState {
  currentFilePath: string | null;
}

type FullscreenIntent = 'toggle' | 'exit-if-active';
type FullscreenResult = 'entered' | 'exited' | 'inactive' | 'failed';

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

interface FailedLoadState {
  filePath: string;
  imageList: string[];
  index: number;
}

type ToastTone = 'neutral' | 'progress' | 'success' | 'warning' | 'error';

interface ToastState {
  message: string;
  tone: ToastTone;
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
  const [windowMode, setWindowMode] = useState<WindowResizeState>({
    ready: false,
    isFullscreen: false,
    isMaximized: false,
  });
  const [isPanning, setIsPanning] = useState(false);
  const [customOpenApps, setCustomOpenApps] = useState<CustomOpenApp[]>([]);
  const [registrationDraft, setRegistrationDraft] = useState<AppRegistrationDraft | null>(null);
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [isCustomAppManagerOpen, setIsCustomAppManagerOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<CustomOpenApp | null>(null);
  const [isRegistrationSaving, setIsRegistrationSaving] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [isRemovingCustomApp, setIsRemovingCustomApp] = useState(false);
  const [failedLoad, setFailedLoad] = useState<FailedLoadState | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [backgroundMode, setBackgroundMode] = useState<BackgroundMode>('dark');
  const [overlayHideDelayMs, setOverlayHideDelayMs] = useState(2000);
  const [gifPause, setGifPause] = useState<GifPauseState | null>(null);
  const [locale, setLocale] = useState(detectLocale);
  const t = useCallback(
    (key: TranslationKey, values?: Record<string, string | number>) =>
      translate(locale, key, values),
    [locale]
  );

  const nativeDialogGuardRef = useRef(new NativeDialogGuard());
  const hasBlockingModal = Boolean(
    registrationDraft ||
      renameDraft ||
      isCustomAppManagerOpen ||
      removeTarget ||
      isSettingsOpen ||
      isAboutOpen
  );
  const isInteractionBlocked = useCallback(
    () => hasBlockingModal || nativeDialogGuardRef.current.isActive,
    [hasBlockingModal]
  );

  const settingsRef = useRef<Settings>({
    rememberWindowPosition: true,
    alwaysOnTopDefault: false,
    loopNavigation: true,
    // Keep the latest persisted defaults available to image and overlay handlers.
    backgroundMode: 'dark',
    defaultFitMode: 'auto',
    locale: 'system',
    overlayHideDelayMs: 2000,
    lastWindowBounds: null,
    customOpenApps: [],
  });

  const appContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const {
    contextMenu,
    contextMenuRef,
    handleContextMenu,
    closeContextMenu,
    dismissContextMenu,
  } = useContextMenuController({
    enabled:
      !state.isLoading &&
      !state.errorMessage &&
      !isInteractionBlocked(),
    focusTargetRef: viewerRef,
    hasSubmenus: Boolean(state.currentFilePath),
    estimatedMenuHeight: state.currentFilePath
      ? undefined
      : EMPTY_CONTEXT_MENU_ESTIMATED_HEIGHT,
  });
  const viewerImageRef = useRef<HTMLImageElement>(null);
  const printCanvasRef = useRef<HTMLCanvasElement>(null);
  const isDraggingRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const dragModeRef = useRef<DragMode>('none');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullscreenSnapshotRef = useRef<FullscreenSnapshot | null>(null);
  const fullscreenQueueRef = useRef(new SerializedTaskQueue());
  const isCopyingRef = useRef(false);
  const isPrintingRef = useRef(false);
  const isClosingRef = useRef(false);
  const isMovingRef = useRef(false);
  const isTrashingRef = useRef(false);
  const isSavingRef = useRef(false);
  const isRenamingRef = useRef(false);
  const isRegistrationSavingRef = useRef(false);
  const isRemovingCustomAppRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const centerAfterNextResizeRef = useRef(true);
  const windowBoundsReadyRef = useRef(false);
  const settingsLoadedRef = useRef(false);
  const settingsSaveQueueRef = useRef(new SerializedTaskQueue());
  const gifPauseRef = useRef<GifPauseState | null>(null);
  const gifClickSequenceRef = useRef<{
    filePath: string;
    initialPause: GifPauseState | null;
    count: number;
  } | null>(null);
  const viewerStateRef = useRef(state);
  const windowModeRef = useRef(windowMode);
  const windowModeVersionRef = useRef(0);
  const failedLoadRef = useRef(failedLoad);

  // User image intents and background refreshes use separate generations so
  // stale async work cannot replace a newer visible image.
  const imageIntentRef = useRef(new LatestIntent());
  const folderRefreshIntentRef = useRef(new LatestIntent());

  viewerStateRef.current = state;
  windowModeRef.current = windowMode;
  failedLoadRef.current = failedLoad;

  const updateWindowMode = useCallback(
    (updates: Partial<WindowResizeState>) => {
      const next = { ...windowModeRef.current, ...updates };
      windowModeVersionRef.current += 1;
      windowModeRef.current = next;
      setWindowMode(next);
    },
    []
  );

  const stopPanning = useCallback(() => {
    const pointerId = activePointerIdRef.current;
    const appContainer = appContainerRef.current;
    if (
      pointerId !== null &&
      appContainer &&
      typeof appContainer.hasPointerCapture === 'function' &&
      appContainer.hasPointerCapture(pointerId)
    ) {
      try {
        appContainer.releasePointerCapture(pointerId);
      } catch {
        // The OS may already have released the pointer.
      }
    }

    isDraggingRef.current = false;
    dragModeRef.current = 'none';
    activePointerIdRef.current = null;
    setIsPanning(false);
  }, []);

  const {
    loadImage,
    preloadImages,
    scanFolder,
    loadSettings,
    saveSettings,
    getCliArgs,
    invalidateImage,
    isImageStale,
  } = useImageLoader();

  const saveSettingsInOrder = useCallback(
    (settings: Settings) =>
      settingsSaveQueueRef.current.run(() => saveSettings(settings)),
    [saveSettings]
  );

  const overlay = useOverlayVisibility();

  // ---- Utility functions ----

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => () => nativeDialogGuardRef.current.dispose(), []);

  const showToast = useCallback((message: string, tone: ToastTone = 'neutral', duration = 2200) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, tone });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, duration);
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
      const previousSettings = settingsRef.current;
      const nextSettings: Settings = {
        ...previousSettings,
        customOpenApps: nextApps,
      };
      settingsRef.current = nextSettings;
      try {
        await saveSettingsInOrder(nextSettings);
        setCustomOpenApps(nextApps);
      } catch (error) {
        if (settingsRef.current === nextSettings) {
          settingsRef.current = previousSettings;
        }
        throw error;
      }
    },
    [saveSettingsInOrder]
  );

  const isCurrentImageReady = useCallback(() => {
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

  const copyImageAndFileToClipboard = useCallback(
    async (imageElement: HTMLImageElement, filePath: string) => {
      return writeAdaptiveClipboard({
        writeImageFormats: async () => {
          const canvas = drawImageToCanvas(imageElement);
          const context = canvas.getContext('2d');
          if (!context) throw new Error('2D canvas context is not available.');
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const rgba = new Uint8Array(imageData.data);
          const tauriImage = await TauriImage.new(rgba, canvas.width, canvas.height);

          try {
            await writeImage(tauriImage);
          } finally {
            await tauriImage.close().catch(() => {});
          }
        },
        appendFileFormat: () =>
          invoke<ClipboardFormatStatus>('append_file_to_clipboard', {
            path: filePath,
          }),
      });
    },
    []
  );

  const handleCopy = useCallback(async () => {
    if (isCopyingRef.current) {
      showToast(t('toast.copyAlreadyRunning'), 'progress');
      return;
    }
    if (!isCurrentImageReady() || !state.imageSrc || !state.currentFilePath) {
      showToast(t('toast.copyUnavailable'), 'error');
      return;
    }

    const srcAtStart = state.imageSrc;
    const filePathAtStart = state.currentFilePath;
    const imageElementAtStart = viewerImageRef.current;
    isCopyingRef.current = true;
    showToast(t('toast.copyInProgress'), 'progress', 10_000);

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

      const result = await copyImageAndFileToClipboard(
        imageElement,
        filePathAtStart
      );
      if (result.kind === 'image-only') {
        if (result.fileError) {
          console.warn(
            'Copied image formats but could not append the file format:',
            result.fileError
          );
        }
        showToast(t('toast.copyImageOnlySuccess'), 'warning', 4200);
      } else if (result.kind === 'file-only') {
        console.warn('Copied the file format but image formats were not preserved.');
        showToast(t('toast.copyFileOnlySuccess'), 'warning', 4200);
      } else if (result.kind === 'unavailable') {
        console.warn('Clipboard format verification failed after copying.');
        showToast(t('toast.copyFailed'), 'error', 3200);
      } else {
        showToast(t('toast.copySuccess'), 'success', 3200);
      }
    } catch (error) {
      console.warn('Failed to copy image and file formats:', error);
      showToast(t('toast.copyFailed'), 'error', 3200);
    } finally {
      isCopyingRef.current = false;
    }
  }, [
    copyImageAndFileToClipboard,
    isCurrentImageReady,
    loadImageElement,
    showToast,
    state.currentFilePath,
    state.imageSrc,
    t,
  ]);

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
      return clampPanOffsetToViewport(rendered, viewport, panOffset);
    },
    [getRenderedSize, getViewportSize]
  );

  const setZoomWithCenter = useCallback(
    (targetZoom: number) => {
      setState((prev) => {
        const transition = getZoomTransition(
          prev.zoom,
          targetZoom,
          prev.panOffset,
          (zoom, panOffset) =>
            clampPanOffset(prev.naturalSize, zoom, prev.rotation, panOffset)
        );

        return {
          ...prev,
          ...transition,
        };
      });
    },
    [clampPanOffset]
  );

  const scaleZoom = useCallback(
    (direction: ZoomDirection, anchor: ZoomAnchor = { x: 0, y: 0 }) => {
      setState((prev) => {
        const transition = getZoomTransition(
          prev.zoom,
          getNextZoom(prev.zoom, direction),
          prev.panOffset,
          (zoom, panOffset) =>
            clampPanOffset(prev.naturalSize, zoom, prev.rotation, panOffset),
          anchor
        );

        return {
          ...prev,
          ...transition,
        };
      });
    },
    [clampPanOffset]
  );

  const scaleWheelZoom = useCallback(
    (deltaY: number, deltaMode: number, anchor: ZoomAnchor) => {
      setState((prev) => {
        const targetZoom = getWheelZoomTarget(prev.zoom, deltaY, deltaMode);
        if (targetZoom === prev.zoom) return prev;

        const transition = getZoomTransition(
          prev.zoom,
          targetZoom,
          prev.panOffset,
          (zoom, panOffset) =>
            clampPanOffset(prev.naturalSize, zoom, prev.rotation, panOffset),
          anchor
        );

        return { ...prev, ...transition };
      });
    },
    [clampPanOffset]
  );

  // ---- Image loading ----

  const openImage = useCallback(
    async (filePath: string, imageList?: string[], index?: number) => {
      const myRequestId = imageIntentRef.current.begin();
      const shouldInitializeWindowSize = shouldAutoSizeWindowForImage(
        Boolean(viewerStateRef.current.imageSrc),
        centerAfterNextResizeRef.current
      );
      stopPanning();
      hasDraggedRef.current = false;
      setFailedLoad(null);
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
        if (!imageIntentRef.current.isCurrent(myRequestId)) return;

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
        const winW = Math.max(MIN_WINDOW_WIDTH, Math.round(naturalW * initialZoom));
        const winH = Math.max(MIN_WINDOW_HEIGHT, Math.round(naturalH * initialZoom));

        let isFullscreen = false;
        try {
          isFullscreen = await getCurrentWindow().isFullscreen();
        } catch {
          // Fall back to attempting the normal resize below.
        }

        if (!imageIntentRef.current.isCurrent(myRequestId)) return;

        let didResizeWindow = false;
        if (!isFullscreen && shouldInitializeWindowSize) {
          try {
            await invoke('resize_window', { width: winW, height: winH });
            didResizeWindow = true;
          } catch {
            // Continue with the actual viewer size instead of assuming resize success.
          }

          if (didResizeWindow) {
            try {
              await getCurrentWindow().center();
            } catch {
              // The resized window remains usable even if centering fails.
            }
          }
        }

        if (didResizeWindow) {
          await waitForNextFrame();
          await waitForNextFrame();
        }

        // Stale request guard after async window ops
        if (!imageIntentRef.current.isCurrent(myRequestId)) return;

        let isFullscreenAtCommit = isFullscreen;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          let latestFullscreen: boolean;
          try {
            latestFullscreen = await getCurrentWindow().isFullscreen();
          } catch {
            // Retain the last verified native state if the refresh fails.
            break;
          }
          if (!imageIntentRef.current.isCurrent(myRequestId)) return;
          if (latestFullscreen === isFullscreenAtCommit) break;

          isFullscreenAtCommit = latestFullscreen;
          await waitForNextFrame();
          await waitForNextFrame();
          if (!imageIntentRef.current.isCurrent(myRequestId)) return;
        }

        if (shouldInitializeWindowSize) {
          centerAfterNextResizeRef.current = false;
        }

        const viewerRect = viewerRef.current?.getBoundingClientRect();
        const fitViewport = resolveViewportDimensions(
          didResizeWindow && isFullscreenAtCommit === isFullscreen
            ? { width: winW, height: winH }
            : { width: window.innerWidth, height: window.innerHeight },
          viewerRect
            ? { width: viewerRect.width, height: viewerRect.height }
            : null
        );
        const fitZoom = calculateFitZoomForSize(
          naturalW,
          naturalH,
          0,
          fitViewport.width,
          fitViewport.height
        );
        const defaultFitMode = settingsRef.current.defaultFitMode;
        const displayZoom = defaultFitMode === 'original' ? 1 : fitZoom;
        const displayFitMode: FitMode =
          defaultFitMode === 'fit'
            ? 'fit'
            : defaultFitMode === 'original'
              ? 'original'
              : isFullscreenAtCommit
                ? 'fit'
                : 'auto';

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
          zoom: displayZoom,
          fitMode: displayFitMode,
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
        if (!imageIntentRef.current.isCurrent(myRequestId)) return;

        const failedList = imageList ?? state.imageList;
        const failedIndex = index ?? state.currentIndex;
        setFailedLoad({
          filePath,
          imageList: failedList.length > 0 ? failedList : [filePath],
          index: Math.max(0, failedIndex),
        });
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
      stopPanning,
      updateGifPause,
    ]
  );

  const retryFailedImage = useCallback(() => {
    if (!failedLoad) return;
    invalidateImage(failedLoad.filePath);
    void openImage(failedLoad.filePath, failedLoad.imageList, failedLoad.index);
  }, [failedLoad, invalidateImage, openImage]);

  const openImageFromPath = useCallback(
    async (filePath: string) => {
      const scanIntent = imageIntentRef.current.begin();
      try {
        const imageList = await scanFolder(filePath);
        if (!imageIntentRef.current.isCurrent(scanIntent)) return;
        const index = imageList.findIndex(
          (path) => path.toLowerCase() === filePath.toLowerCase()
        );
        if (imageList.length > 0 && index >= 0) {
          await openImage(filePath, imageList, index);
        } else {
          await openImage(filePath, [filePath], 0);
        }
      } catch {
        if (!imageIntentRef.current.isCurrent(scanIntent)) return;
        await openImage(filePath, [filePath], 0);
      }
    },
    [openImage, scanFolder]
  );

  const handleOpenImageDialog = useCallback(async () => {
    try {
      const dialog = await runWithNativeDialogGuard(
        nativeDialogGuardRef.current,
        () =>
          openDialog({
            multiple: false,
            directory: false,
            title: t('dialog.openImageTitle'),
            filters: [
              {
                name: t('dialog.imageFilter'),
                extensions: [...SUPPORTED_IMAGE_EXTENSIONS],
              },
            ],
          })
      );
      if (!dialog.started) return;

      const selected = dialog.value;
      if (typeof selected !== 'string') return;
      await openImageFromPath(selected);
    } catch (error) {
      console.warn('Failed to open the image picker:', error);
      showToast(t('toast.openImageDialogFailed'), 'error', 3200);
    }
  }, [openImageFromPath, showToast, t]);

  const openNextAfterError = useCallback(() => {
    if (!failedLoad || failedLoad.imageList.length <= 1) return;

    let nextIndex = failedLoad.index + 1;
    if (nextIndex >= failedLoad.imageList.length) {
      if (!settingsRef.current.loopNavigation) return;
      nextIndex = 0;
    }
    void openImage(
      failedLoad.imageList[nextIndex],
      failedLoad.imageList,
      nextIndex
    );
  }, [failedLoad, openImage]);

  const revealFailedImage = useCallback(() => {
    if (!failedLoad) return;
    void revealItemInDir(failedLoad.filePath).catch(() => {
      showToast(t('toast.revealFailed'), 'error');
    });
  }, [failedLoad, showToast, t]);

  const refreshCurrentFolder = useCallback(
    async (forceReload = false) => {
      const refreshIntent = folderRefreshIntentRef.current.begin();
      const imageIntent = imageIntentRef.current.snapshot();
      const snapshot = viewerStateRef.current;
      const failed = failedLoadRef.current;
      const currentPath = failed?.filePath ?? snapshot.currentFilePath;
      if (!currentPath) return;

      const isStillCurrent = () => {
        if (!folderRefreshIntentRef.current.isCurrent(refreshIntent)) return false;
        if (!imageIntentRef.current.isCurrent(imageIntent)) return false;
        const latestFailed = failedLoadRef.current;
        const latestPath = latestFailed?.filePath ?? viewerStateRef.current.currentFilePath;
        return latestPath?.toLowerCase() === currentPath.toLowerCase();
      };

      try {
        const imageList = await scanFolder(currentPath);
        if (!isStillCurrent()) return;
        const currentIndex = imageList.findIndex(
          (path) => path.toLowerCase() === currentPath.toLowerCase()
        );

        if (currentIndex < 0) {
          invalidateImage(currentPath);

          if (imageList.length === 0) {
            setFailedLoad({
              filePath: currentPath,
              imageList: [currentPath],
              index: 0,
            });
            setState((previous) => ({
              ...previous,
              isLoading: false,
              errorMessage: t('error.fileNotFound'),
            }));
            return;
          }

          const previousIndex = failed?.index ?? snapshot.currentIndex;
          const fallbackIndex = Math.min(
            Math.max(previousIndex, 0),
            imageList.length - 1
          );
          if (!isStillCurrent()) return;
          await openImage(imageList[fallbackIndex], imageList, fallbackIndex);
          return;
        }

        setState((previous) => {
          if (
            !previous.currentFilePath ||
            previous.currentFilePath.toLowerCase() !== currentPath.toLowerCase()
          ) {
            return previous;
          }

          return {
            ...previous,
            imageList,
            currentIndex,
          };
        });

        const stale = forceReload || (await isImageStale(currentPath));
        if (!isStillCurrent()) return;
        if (stale) {
          if (forceReload) invalidateImage(currentPath);
          await openImage(currentPath, imageList, currentIndex);
        }
      } catch {
        // Keep the current image usable when a background refresh cannot read the folder.
      }
    },
    [invalidateImage, isImageStale, openImage, scanFolder, t]
  );

  useFolderSync({
    filePath: failedLoad?.filePath ?? state.currentFilePath,
    onRefresh: refreshCurrentFolder,
  });

  // ---- Tauri native drag-and-drop ----
  // Use a ref so the listener callback always reads the latest scanFolder/openImage
  // without causing the effect (and thus the Tauri listener) to re-register.

  const fileDropRef = useRef<(paths: string[]) => void>(() => {});
  fileDropRef.current = (paths: string[]) => {
    if (paths.length === 0) return;
    void openImageFromPath(paths[0]);
  };

  // ---- Navigation ----

  const navigateToIndex = useCallback(
    (requestedIndex: number) => {
      if (state.imageList.length === 0) return;

      const index = Math.max(0, Math.min(requestedIndex, state.imageList.length - 1));
      if (index === state.currentIndex) return;

      void openImage(state.imageList[index], state.imageList, index);
    },
    [openImage, state.currentIndex, state.imageList]
  );

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

      navigateToIndex(newIndex);
    },
    [navigateToIndex, state.currentIndex, state.imageList.length]
  );

  // ---- Zoom ----

  const zoomIn = useCallback(() => {
    scaleZoom('in');
  }, [scaleZoom]);

  const zoomOut = useCallback(() => {
    scaleZoom('out');
  }, [scaleZoom]);

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
      const newRotation = getNextRotation(prev.rotation);
      const fitZoom = calculateFitZoom(
        prev.naturalSize.width,
        prev.naturalSize.height,
        newRotation
      );
      return {
        ...prev,
        ...createFittedView(newRotation, fitZoom),
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

      void saveSettingsInOrder(nextSettings).catch((error) => {
        console.warn('Failed to save always-on-top setting.', error);
      });
    } catch (error) {
      console.warn('Failed to change always-on-top state.', error);
      showToast(t('error.windowOperationFailed'), 'error');
    }
  }, [saveSettingsInOrder, showToast, state.isAlwaysOnTop, t]);

  // ---- Background mode ----

  const toggleBackgroundMode = useCallback(() => {
    const nextMode: BackgroundMode = backgroundMode === 'dark' ? 'light' : 'dark';
    const nextSettings: Settings = {
      ...settingsRef.current,
      backgroundMode: nextMode,
    };

    settingsRef.current = nextSettings;
    setBackgroundMode(nextMode);

    void saveSettingsInOrder(nextSettings).catch((error) => {
      console.warn('Failed to save background mode setting.', error);
    });
  }, [backgroundMode, saveSettingsInOrder]);

  const saveViewerSettings = useCallback(
    async (draft: SettingsDraft) => {
      const previousSettings = settingsRef.current;
      const nextSettings: Settings = {
        ...previousSettings,
        ...draft,
        lastWindowBounds: draft.rememberWindowPosition
          ? previousSettings.lastWindowBounds
          : null,
      };
      settingsRef.current = nextSettings;

      try {
        await saveSettingsInOrder(nextSettings);
        setLocale(detectLocale(nextSettings.locale));
        setOverlayHideDelayMs(nextSettings.overlayHideDelayMs);
        setIsSettingsOpen(false);
        showToast(t('toast.settingsSaved'), 'success');
        return true;
      } catch (error) {
        if (settingsRef.current === nextSettings) {
          settingsRef.current = previousSettings;
        }
        showToast(getErrorMessage(error, 'error.settingsSaveFailed'), 'error');
        return false;
      }
    },
    [getErrorMessage, saveSettingsInOrder, showToast, t]
  );

  const {
    checkForAppUpdates,
    openReleasePage,
    openDefaultAppsSettings,
  } = useSystemIntegration({
    currentVersion: packageInfo.version,
    t,
    showError: (message) => showToast(message, 'error'),
  });

  // ---- Window controls ----

  const minimizeApp = useCallback(async () => {
    try {
      await getCurrentWindow().minimize();
    } catch {
      showToast(t('error.windowOperationFailed'));
    }
  }, [showToast, t]);

  const captureCurrentWindowBounds = useCallback(async () => {
    if (!windowBoundsReadyRef.current || !settingsRef.current.rememberWindowPosition) return;

    const bounds = await invoke<WindowBounds | null>('get_restorable_window_bounds');
    if (!bounds) return;
    settingsRef.current = {
      ...settingsRef.current,
      lastWindowBounds: bounds,
    };
  }, []);

  const closeApp = useCallback(async () => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;

    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }

    if (settingsLoadedRef.current) {
      try {
        await captureCurrentWindowBounds();
      } catch {
        // Preserve the last known valid bounds if the window can no longer be inspected.
      }
      try {
        await saveSettingsInOrder(settingsRef.current);
      } catch {
        // Closing remains available even if settings cannot be persisted.
      }
    }
    try {
      await invoke('destroy_window');
    } catch {
      isClosingRef.current = false;
      showToast(t('error.windowOperationFailed'), 'error');
    }
  }, [captureCurrentWindowBounds, saveSettingsInOrder, showToast, t]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        void closeApp();
      })
      .then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      })
      .catch(() => {
        // The custom close controls still use closeApp if this API is absent.
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [closeApp]);

  // ---- Context menu actions ----

  const handleOpenImageFromContextMenu = useCallback(() => {
    closeContextMenu();
    void handleOpenImageDialog();
  }, [closeContextMenu, handleOpenImageDialog]);

  const handleShowAbout = useCallback(() => {
    closeContextMenu();
    setIsAboutOpen(true);
  }, [closeContextMenu]);

  const handleCloseAbout = useCallback(() => {
    setIsAboutOpen(false);
    globalThis.setTimeout(() => {
      viewerRef.current?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const handleRevealInExplorer = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      await revealItemInDir(state.currentFilePath);
    } catch {
      showToast(t('toast.revealFailed'));
    }
  }, [closeContextMenu, showToast, state.currentFilePath, t]);

  const handleCopyFromMenu = useCallback(() => {
    closeContextMenu();
    void handleCopy();
  }, [closeContextMenu, handleCopy]);

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

  const handleOpenWithDialog = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      const dialog = await runWithNativeDialogGuard(
        nativeDialogGuardRef.current,
        () => invoke('show_open_with_dialog', { path: state.currentFilePath })
      );
      if (!dialog.started) return;
    } catch (error) {
      console.warn('Failed to open the Open With dialog:', error);
      showToast(getCommandErrorToast(error, 'toast.openWithFailed'), 'error', 3200);
    }
  }, [
    closeContextMenu,
    getCommandErrorToast,
    showToast,
    state.currentFilePath,
  ]);

  const handleShowFileProperties = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath || !isCurrentImageReady()) return;

    try {
      const dialog = await runWithNativeDialogGuard(
        nativeDialogGuardRef.current,
        () => invoke('show_file_properties', { path: state.currentFilePath })
      );
      if (!dialog.started) return;
    } catch (error) {
      console.warn('Failed to open file properties:', error);
      showToast(getCommandErrorToast(error, 'toast.propertiesFailed'), 'error', 3200);
    }
  }, [
    closeContextMenu,
    getCommandErrorToast,
    isCurrentImageReady,
    showToast,
    state.currentFilePath,
  ]);

  const handleMoveFile = useCallback(async () => {
    closeContextMenu();
    if (
      !state.currentFilePath ||
      state.isLoading ||
      state.errorMessage ||
      isMovingRef.current
    ) {
      if (isMovingRef.current) showToast(t('toast.moveAlreadyRunning'));
      return;
    }

    let selected: string | string[] | null;
    try {
      const dialog = await runWithNativeDialogGuard(
        nativeDialogGuardRef.current,
        () =>
          openDialog({
            multiple: false,
            directory: true,
            title: t('dialog.moveFolderTitle'),
          })
      );
      if (!dialog.started) return;
      selected = dialog.value;
    } catch {
      showToast(t('toast.moveDialogFailed'));
      return;
    }

    if (typeof selected !== 'string') return;

    const filePathAtStart = state.currentFilePath;
    isMovingRef.current = true;
    const moveRequestId = imageIntentRef.current.begin();

    try {
      await invoke<string>('move_file_to_folder', {
        filePath: filePathAtStart,
        targetFolder: selected,
      });

      if (
        !imageIntentRef.current.isCurrent(moveRequestId) ||
        viewerStateRef.current.currentFilePath?.toLowerCase() !==
          filePathAtStart.toLowerCase()
      ) {
        showToast(t('toast.moveSuccess'));
        void refreshCurrentFolder(false);
        return;
      }

      const nextList = state.imageList.filter(
        (path) => path.toLowerCase() !== filePathAtStart.toLowerCase()
      );

      if (nextList.length === 0) {
        imageIntentRef.current.begin();
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
    refreshCurrentFolder,
    showToast,
    state.currentFilePath,
    state.errorMessage,
    state.currentIndex,
    state.imageList,
    state.isLoading,
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
      const dialog = await runWithNativeDialogGuard(
        nativeDialogGuardRef.current,
        () =>
          saveDialog({
            defaultPath: filePathAtStart,
            filters,
          })
      );
      if (!dialog.started) return;
      target = dialog.value;
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
    setIsRenaming(true);

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

      // Discard a folder refresh that may have observed the short interval
      // between the old name disappearing and the new state being committed.
      folderRefreshIntentRef.current.begin();

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
      setIsRenaming(false);
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
    if (
      !state.currentFilePath ||
      state.isLoading ||
      state.errorMessage ||
      isTrashingRef.current ||
      isMovingRef.current
    ) {
      if (isTrashingRef.current) showToast(t('toast.trashAlreadyRunning'));
      if (isMovingRef.current) showToast(t('toast.moveAlreadyRunning'));
      return;
    }

    const previousState = state;
    const previousGifPause = gifPauseRef.current;
    const filePathAtStart = state.currentFilePath;
    const fileNameAtStart =
      state.fileName || filePathAtStart.split(/[\\/]/).pop() || t('app.fileFallback');
    const trashRequestId = imageIntentRef.current.begin();

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
      if (!imageIntentRef.current.isCurrent(trashRequestId)) return;

      const nextList = previousState.imageList.filter(
        (path) => path.toLowerCase() !== filePathAtStart.toLowerCase()
      );

      if (nextList.length === 0) {
        imageIntentRef.current.begin();
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
      if (imageIntentRef.current.isCurrent(trashRequestId)) {
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
      const dialog = await runWithNativeDialogGuard(
        nativeDialogGuardRef.current,
        () =>
          openDialog({
            multiple: false,
            directory: false,
            title: t('dialog.customAppTitle'),
            filters: [{ name: t('dialog.executableFilter'), extensions: ['exe'] }],
          })
      );
      if (!dialog.started) return;

      const selected = dialog.value;
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
    if (!registrationDraft || isRegistrationSavingRef.current) return;

    const draft = registrationDraft;
    const name = draft.name.trim() || draft.defaultName;
    const executablePath = draft.executablePath;
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

    isRegistrationSavingRef.current = true;
    setIsRegistrationSaving(true);

    try {
      await saveCustomOpenApps(nextApps);
      setRegistrationDraft(null);
      showToast(existingIndex >= 0 ? t('toast.customAppUpdated') : t('toast.customAppRegistered'));
    } catch {
      showToast(t('toast.customAppSaveFailed'));
    } finally {
      isRegistrationSavingRef.current = false;
      setIsRegistrationSaving(false);
    }
  }, [createCustomAppId, customOpenApps, registrationDraft, saveCustomOpenApps, showToast, t]);

  const handleRequestRemoveCustomApp = useCallback(
    (app: CustomOpenApp) => {
      closeContextMenu();
      setRemoveTarget(app);
    },
    [closeContextMenu]
  );

  const handleManageCustomApps = useCallback(() => {
    closeContextMenu();
    if (customOpenApps.length === 0) {
      showToast(t('toast.noAppsToManage'));
      return;
    }
    setIsCustomAppManagerOpen(true);
  }, [closeContextMenu, customOpenApps.length, showToast, t]);

  const handleConfirmRemoveCustomApp = useCallback(async () => {
    if (!removeTarget || isRemovingCustomAppRef.current) return;

    const nextApps = customOpenApps.filter((app) => app.id !== removeTarget.id);
    isRemovingCustomAppRef.current = true;
    setIsRemovingCustomApp(true);

    try {
      await saveCustomOpenApps(nextApps);
      setRemoveTarget(null);
      if (nextApps.length === 0) setIsCustomAppManagerOpen(false);
      showToast(t('toast.customAppRemoved'));
    } catch {
      showToast(t('toast.customAppRemoveFailed'));
    } finally {
      isRemovingCustomAppRef.current = false;
      setIsRemovingCustomApp(false);
    }
  }, [customOpenApps, removeTarget, saveCustomOpenApps, showToast, t]);

  const handlePrintFile = useCallback(async () => {
    closeContextMenu();
    if (isPrintingRef.current) {
      showToast(t('toast.printAlreadyRunning'), 'progress');
      return;
    }
    if (!isCurrentImageReady() || !state.imageSrc) {
      showToast(t('toast.printUnavailable'), 'error');
      return;
    }

    const srcAtStart = state.imageSrc;
    const imageElementAtStart = viewerImageRef.current;
    isPrintingRef.current = true;
    showToast(t('toast.printPreparing'), 'progress', 10_000);

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

      const printCanvas = printCanvasRef.current;
      if (!printCanvas) {
        throw new Error('Print canvas is not available.');
      }

      drawImageToCanvas(imageElement, state.rotation, printCanvas);

      showToast(t('toast.printOpening'), 'progress', 4000);
      await waitForNextFrame();
      await waitForNextFrame();
      const printDialog = await runWithNativeDialogGuard(
        nativeDialogGuardRef.current,
        () => window.print()
      );
      if (!printDialog.started) return;
    } catch (error) {
      console.warn('Failed to open print dialog:', error);
      showToast(t('toast.printFailed'), 'error', 3200);
    } finally {
      isPrintingRef.current = false;
    }
  }, [
    closeContextMenu,
    isCurrentImageReady,
    loadImageElement,
    showToast,
    state.imageSrc,
    state.rotation,
    t,
  ]);

  // ---- Mouse wheel zoom ----

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (!state.imageSrc || state.isLoading || state.errorMessage) return;
      if (e.deltaY === 0) return;

      e.preventDefault();
      const viewerRect = viewerRef.current?.getBoundingClientRect();
      const anchor = viewerRect
        ? {
            x: e.clientX - viewerRect.left - viewerRect.width / 2,
            y: e.clientY - viewerRect.top - viewerRect.height / 2,
          }
        : { x: 0, y: 0 };

      scaleWheelZoom(e.deltaY, e.deltaMode, anchor);
    },
    [scaleWheelZoom, state.errorMessage, state.imageSrc, state.isLoading]
  );

  // ---- Drag / Pan ----

  const getDragMode = useCallback(
    (altKey: boolean): DragMode => {
      if (altKey) {
        return windowModeRef.current.isFullscreen ? 'none' : 'window-move';
      }

      const viewport = getViewportSize();
      const rendered = getRenderedSize(
        state.naturalSize.width,
        state.naturalSize.height,
        state.zoom,
        state.rotation
      );

      if (hasPanOverflow(rendered, viewport)) {
        return 'image-pan';
      }
      return 'none';
    },
    [state.naturalSize, state.zoom, state.rotation, getViewportSize, getRenderedSize]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (contextMenu) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.modal-backdrop')) return;
      if (target.closest('.window-resize-handle')) return;
      if (target.closest('.overlay-btn') || target.closest('.overlay-container')) {
        return;
      }
      if (!e.altKey && (!state.imageSrc || state.isLoading || state.errorMessage)) {
        return;
      }
      if (state.imageSrc && target.closest('.image-container') && e.detail > 1) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      hasDraggedRef.current = false;
      const mode =
        e.altKey || target.closest('.image-container')
          ? getDragMode(e.altKey)
          : 'none';
      if (mode === 'none') return;

      dragModeRef.current = mode;
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...state.panOffset };

      if (mode === 'window-move') {
        const appWindow = getCurrentWindow();
        void appWindow.startDragging().catch((error) => {
          console.warn('Failed to start window dragging:', error);
        });
        isDraggingRef.current = false;
        dragModeRef.current = 'none';
      } else {
        activePointerIdRef.current = e.pointerId;
        setIsPanning(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Pointer capture is a progressive enhancement; global loss handlers
          // still reset the drag if the platform declines it.
        }
      }

      e.preventDefault();
    },
    [
      contextMenu,
      getDragMode,
      state.errorMessage,
      state.imageSrc,
      state.isLoading,
      state.panOffset,
    ]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      overlay.handleMouseMove(e.clientX, e.clientY, window.innerWidth, window.innerHeight);

      if (!isDraggingRef.current || dragModeRef.current !== 'image-pan') return;
      if (
        activePointerIdRef.current !== null &&
        e.pointerId !== activePointerIdRef.current
      ) {
        return;
      }
      if (e.pointerType === 'mouse' && (e.buttons & 1) === 0) {
        stopPanning();
        return;
      }

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

      if (!exceedsPanBoundary(rendered.width, viewport.width)) {
        newX = 0;
      } else {
        const maxPanX = (rendered.width - viewport.width) / 2;
        newX = Math.max(-maxPanX, Math.min(maxPanX, newX));
      }

      if (!exceedsPanBoundary(rendered.height, viewport.height)) {
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
    [
      getRenderedSize,
      getViewportSize,
      overlay,
      state.naturalSize,
      state.rotation,
      state.zoom,
      stopPanning,
    ]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const pointerId = activePointerIdRef.current;
      if (pointerId !== null && event.pointerId !== pointerId) return;

      if (
        pointerId !== null &&
        typeof event.currentTarget.hasPointerCapture === 'function' &&
        event.currentTarget.hasPointerCapture(pointerId)
      ) {
        try {
          event.currentTarget.releasePointerCapture(pointerId);
        } catch {
          // The pointer may already have been released by the OS.
        }
      }
      stopPanning();
    },
    [stopPanning]
  );

  const handleMovePointerDown = useCallback(async (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    if (windowModeRef.current.isFullscreen) return;
    if (contextMenu) {
      closeContextMenu();
      return;
    }
    if (isInteractionBlocked()) return;

    event.preventDefault();
    event.stopPropagation();

    try {
      await getCurrentWindow().startDragging();
    } catch (error) {
      console.warn('Failed to start window dragging:', error);
    }
  }, [closeContextMenu, contextMenu, isInteractionBlocked]);

  const handleResizeStart = useCallback(
    (direction: WindowResizeDirection) => {
      const mode = windowModeRef.current;
      if (!canStartWindowResize(mode)) return;
      if (contextMenu) {
        closeContextMenu();
        return;
      }
      if (isInteractionBlocked()) return;

      isDraggingRef.current = false;
      dragModeRef.current = 'none';
      activePointerIdRef.current = null;
      setIsPanning(false);

      void getCurrentWindow().startResizeDragging(direction).catch((error) => {
        console.warn(`Failed to start ${direction} window resize:`, error);
      });
    },
    [closeContextMenu, contextMenu, isInteractionBlocked]
  );

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

  const performFullscreenIntent = useCallback(
    async (intent: FullscreenIntent): Promise<FullscreenResult> => {
      stopPanning();
      let attemptedEntry = false;

      try {
        const appWindow = getCurrentWindow();
        const isFullscreen = await appWindow.isFullscreen();

        if (intent === 'exit-if-active' && !isFullscreen) return 'inactive';

        if (!isFullscreen) {
          const current = viewerStateRef.current;
          if (!current.imageSrc) return 'inactive';

          fullscreenSnapshotRef.current = {
            currentFilePath: current.currentFilePath,
            zoom: current.zoom,
            rotation: current.rotation,
            fitMode: current.fitMode,
            panOffset: { ...current.panOffset },
          };
          attemptedEntry = true;

          await appWindow.setFullscreen(true);
          updateWindowMode({
            ready: true,
            isFullscreen: true,
          });
          await waitForNextFrame();
          await waitForNextFrame();

          const rect = viewerRef.current?.getBoundingClientRect();
          const width = rect && rect.width > 0 ? rect.width : window.innerWidth;
          const height = rect && rect.height > 0 ? rect.height : window.innerHeight;
          setState((prev) => {
            const fitZoom = calculateFitZoomForSize(
              prev.naturalSize.width,
              prev.naturalSize.height,
              prev.rotation,
              width,
              height
            );
            return {
              ...prev,
              ...createFittedView(prev.rotation, fitZoom),
            };
          });
          return 'entered';
        }

        await appWindow.setFullscreen(false);
        let isMaximized = false;
        try {
          isMaximized = await appWindow.isMaximized();
        } catch {
          // A following resize/focus event will refresh this cached state.
        }
        updateWindowMode({ ready: true, isFullscreen: false, isMaximized });

        const snapshot = fullscreenSnapshotRef.current;
        fullscreenSnapshotRef.current = null;

        if (snapshot) {
          setState((prev) => {
            if (snapshot.currentFilePath !== prev.currentFilePath) return prev;
            return {
              ...prev,
              ...restoreViewTransform(snapshot),
            };
          });
        }
        return 'exited';
      } catch {
        if (attemptedEntry) fullscreenSnapshotRef.current = null;
        return 'failed';
      }
    },
    [calculateFitZoomForSize, stopPanning, updateWindowMode]
  );

  const runFullscreenIntent = useCallback(
    (intent: FullscreenIntent): Promise<FullscreenResult> =>
      fullscreenQueueRef.current.run(() => performFullscreenIntent(intent)),
    [performFullscreenIntent]
  );

  const handleViewerDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const gifClickSequence = gifClickSequenceRef.current;
      if (gifClickSequence?.filePath === state.currentFilePath) {
        updateGifPause(gifClickSequence.initialPause);
        gifClickSequenceRef.current = null;
      }

      void runFullscreenIntent('toggle');
    },
    [runFullscreenIntent, state.currentFilePath, updateGifPause]
  );

  const handleEscape = useCallback(async () => {
    const result = await runFullscreenIntent('exit-if-active');
    if (result === 'inactive') {
      await closeApp();
    }
  }, [closeApp, runFullscreenIntent]);

  const saveWindowBounds = useCallback(async () => {
    if (!settingsLoadedRef.current || !settingsRef.current.rememberWindowPosition) return;
    try {
      await captureCurrentWindowBounds();
      await saveSettingsInOrder(settingsRef.current);
    } catch {
      // Ignore
    }
  }, [captureCurrentWindowBounds, saveSettingsInOrder]);

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
    onOpenImage: () => {
      void handleOpenImageDialog();
    },
    onEscape: () => {
      void handleEscape();
    },
    onToggleFullscreen: () => {
      void runFullscreenIntent('toggle');
    },
    onPrevImage: () => navigateImage(-1),
    onNextImage: () => navigateImage(1),
    onFirstImage: () => navigateToIndex(0),
    onLastImage: () => navigateToIndex(state.imageList.length - 1),
    onZoomIn: zoomIn,
    onZoomOut: zoomOut,
    onOriginalSize: setOriginalSize,
    onFitScreen: fitToScreen,
    onToggleAlwaysOnTop: toggleAlwaysOnTop,
    onRotate: rotate,
    onCopy: () => {
      void handleCopy();
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
    onRename: handleRequestRename,
    onPrint: () => {
      void handlePrintFile();
    },
    onShowProperties: () => {
      void handleShowFileProperties();
    },
    onReload: () => {
      void refreshCurrentFolder(true);
    },
    isEnabled: () =>
      !contextMenu &&
      !isInteractionBlocked(),
  });

  useEffect(() => {
    const handleGlobalPointerEnd = (event: PointerEvent) => {
      const pointerId = activePointerIdRef.current;
      if (pointerId === null || event.pointerId !== pointerId) return;
      stopPanning();
    };
    const handleWindowBlur = () => stopPanning();
    window.addEventListener('pointerup', handleGlobalPointerEnd);
    window.addEventListener('pointercancel', handleGlobalPointerEnd);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('pointerup', handleGlobalPointerEnd);
      window.removeEventListener('pointercancel', handleGlobalPointerEnd);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [stopPanning]);

  // Keep DOM resize affordances in sync with native window state. Tauri does
  // not expose a dedicated fullscreen/maximized-changed event, so debounced
  // resize and focus events are used as inexpensive refresh points.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let resizeUnlisten: (() => void) | null = null;
    let focusUnlisten: (() => void) | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let requestId = 0;

    const refreshWindowMode = async () => {
      const currentRequestId = ++requestId;
      const versionAtStart = windowModeVersionRef.current;
      try {
        const [isFullscreen, isMaximized] = await Promise.all([
          appWindow.isFullscreen(),
          appWindow.isMaximized(),
        ]);
        if (
          cancelled ||
          currentRequestId !== requestId ||
          versionAtStart !== windowModeVersionRef.current
        ) {
          return;
        }
        const current = windowModeRef.current;
        if (
          current.ready &&
          current.isFullscreen === isFullscreen &&
          current.isMaximized === isMaximized
        ) {
          return;
        }
        updateWindowMode({ ready: true, isFullscreen, isMaximized });
      } catch {
        // Keep resize handles hidden until native state can be verified.
      }
    };

    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refreshWindowMode();
      }, 120);
    };

    void refreshWindowMode();
    void appWindow.onResized(scheduleRefresh).then((unlisten) => {
      if (cancelled) unlisten();
      else resizeUnlisten = unlisten;
    });
    void appWindow.onFocusChanged(({ payload }) => {
      if (payload) scheduleRefresh();
    }).then((unlisten) => {
      if (cancelled) unlisten();
      else focusUnlisten = unlisten;
    });

    return () => {
      cancelled = true;
      requestId += 1;
      if (refreshTimer) clearTimeout(refreshTimer);
      resizeUnlisten?.();
      focusUnlisten?.();
    };
  }, [updateWindowMode]);

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
          return {
            ...prev,
            zoom: fitZoom,
            panOffset: { x: 0, y: 0 },
          };
        }

        const rendered = getRenderedSize(
          prev.naturalSize.width,
          prev.naturalSize.height,
          prev.zoom,
          prev.rotation
        );
        const panOffset = clampPanOffsetToViewport(
          rendered,
          { width, height },
          prev.panOffset
        );

        if (
          panOffset.x === prev.panOffset.x &&
          panOffset.y === prev.panOffset.y
        ) {
          return prev;
        }

        return { ...prev, panOffset };
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
  }, [calculateFitZoomForSize, closeContextMenu, getRenderedSize, scheduleSaveWindowBounds]);

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
        settingsLoadedRef.current = true;
        setBackgroundMode(normalizedMode);
        setLocale(detectLocale(normalizedSettings.locale));
        setOverlayHideDelayMs(normalizedSettings.overlayHideDelayMs);
        setCustomOpenApps(normalizedSettings.customOpenApps ?? []);

        // Apply always-on-top default
        if (normalizedSettings.alwaysOnTopDefault) {
          try {
            await invoke('set_always_on_top', { onTop: true });
            setState((prev) => ({ ...prev, isAlwaysOnTop: true }));
          } catch {
            // Window placement and image loading should still continue.
          }
        }

        // Saved bounds are physical pixels. Restore them through Rust so mixed-DPI
        // monitor coordinates are never reinterpreted as logical pixels.
        if (normalizedSettings.rememberWindowPosition && normalizedSettings.lastWindowBounds) {
          const bounds = normalizedSettings.lastWindowBounds;
          try {
            const restored = await invoke<boolean>('restore_window_bounds', { bounds });
            centerAfterNextResizeRef.current = !restored;
            if (!restored) {
              settingsRef.current = {
                ...settingsRef.current,
                lastWindowBounds: null,
              };
            }
          } catch {
            centerAfterNextResizeRef.current = true;
          }
        } else {
          centerAfterNextResizeRef.current = true;
        }
      } catch {
        // Continue with the in-memory defaults and allow later window/settings
        // writes to repair a missing or malformed settings file.
        settingsLoadedRef.current = true;
        centerAfterNextResizeRef.current = true;
      }

      // Check CLI args for initial image
      try {
        const args = await getCliArgs();
        if (args.length > 1) {
          await openImageFromPath(args[1]);
          windowBoundsReadyRef.current = true;
          await saveWindowBounds();
          return;
        }
      } catch {
        // No CLI args
      }

      // If no image provided, show empty state
      setState((prev) => ({ ...prev, isLoading: false }));
      windowBoundsReadyRef.current = true;
      await saveWindowBounds();
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Cursor style ----

  const getCursorStyle = useCallback((): string => {
    if (isPanning) return 'grabbing';
    if (!state.imageSrc || state.isLoading || state.errorMessage) return 'default';

    const viewport = getViewportSize();
    const rendered = getRenderedSize(
      state.naturalSize.width,
      state.naturalSize.height,
      state.zoom,
      state.rotation
    );

    if (hasPanOverflow(rendered, viewport)) {
      return 'grab';
    }
    return 'default';
  }, [
    isPanning,
    state.errorMessage,
    state.imageSrc,
    state.isLoading,
    state.naturalSize,
    state.zoom,
    state.rotation,
    getViewportSize,
    getRenderedSize,
  ]);

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
      return (
        <ErrorView
          message={state.errorMessage}
          t={t}
          onClose={closeApp}
          onRetry={failedLoad ? retryFailedImage : undefined}
          onNext={
            failedLoad &&
            failedLoad.imageList.length > 1 &&
            (settingsRef.current.loopNavigation ||
              failedLoad.index < failedLoad.imageList.length - 1)
              ? openNextAfterError
              : undefined
          }
          onReveal={failedLoad ? revealFailedImage : undefined}
        />
      );
    }

    if (!state.imageSrc) {
      return <EmptyView t={t} onOpenImage={() => void handleOpenImageDialog()} />;
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
      ref={appContainerRef}
      className={`app-container theme-${backgroundMode}`}
      style={{ cursor: getCursorStyle() }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={stopPanning}
      onPointerLeave={(event) => {
        if (!isPanning) {
          overlay.handleMouseLeave();
          return;
        }

        const pointerId = activePointerIdRef.current;
        const hasCapture =
          pointerId !== null &&
          typeof event.currentTarget.hasPointerCapture === 'function' &&
          event.currentTarget.hasPointerCapture(pointerId);
        if (!hasCapture) stopPanning();
      }}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
    >
      {canStartWindowResize(windowMode) && (
        <WindowResizeHandles onResizeStart={handleResizeStart} />
      )}

      <div
        ref={viewerRef}
        className="image-container"
        tabIndex={-1}
        onDoubleClick={handleViewerDoubleClick}
      >
        {renderImage()}
      </div>

      <div className="print-surface" aria-hidden="true">
        <canvas ref={printCanvasRef} className="print-canvas" />
      </div>

      {!windowMode.isFullscreen && (
        <div
          className="window-move-zone"
          aria-hidden="true"
          onPointerDown={handleMovePointerDown}
        />
      )}

      {!state.errorMessage && (
        <OverlayControls
          activeRegion={overlay.activeRegion}
          feedbackDurationMs={overlayHideDelayMs}
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
          onMinimize={minimizeApp}
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
          onOpenSettings={() => setIsSettingsOpen(true)}
          onRotate={rotate}
        />
      )}

      {contextMenu &&
        (state.currentFilePath ? (
          <ContextMenu
            menuRef={contextMenuRef}
            x={contextMenu.x}
            y={contextMenu.y}
            submenuDirection={contextMenu.submenuDirection}
            submenuVerticalDirection={contextMenu.submenuVerticalDirection}
            customApps={customOpenApps}
            t={t}
            onCopy={handleCopyFromMenu}
            onCopyPath={handleCopyPath}
            onReveal={handleRevealInExplorer}
            onOpenDefault={handleOpenDefaultApp}
            onOpenWith={handleOpenWithDialog}
            onMoveFile={handleMoveFile}
            onSaveAs={handleSaveAs}
            onRename={handleRequestRename}
            onShowProperties={handleShowFileProperties}
            onMoveToTrash={handleMoveToTrash}
            onOpenCustom={handleOpenCustomApp}
            onRegisterApp={handleRegisterCustomApp}
            onManageApps={handleManageCustomApps}
            onPrint={handlePrintFile}
            onShowAbout={handleShowAbout}
            onDismiss={dismissContextMenu}
          />
        ) : (
          <EmptyContextMenu
            menuRef={contextMenuRef}
            x={contextMenu.x}
            y={contextMenu.y}
            t={t}
            onOpenImage={handleOpenImageFromContextMenu}
            onShowAbout={handleShowAbout}
            onDismiss={dismissContextMenu}
          />
        ))}

      {registrationDraft && (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!isRegistrationSavingRef.current) setRegistrationDraft(null);
          }}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-app-modal-title"
            aria-busy={isRegistrationSaving}
            tabIndex={-1}
            onKeyDown={(event) =>
              handleDialogKeyDown(event, event.currentTarget, () => {
                if (!isRegistrationSavingRef.current) setRegistrationDraft(null);
              })
            }
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="custom-app-modal-title" className="app-modal-title">
              {t('modal.customAppTitle')}
            </h2>
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
              disabled={isRegistrationSaving}
              onChange={(event) =>
                setRegistrationDraft((prev) =>
                  prev ? { ...prev, name: event.target.value } : prev
                )
              }
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleSaveRegistration();
              }}
            />
            <div className="app-modal-actions">
              <button
                type="button"
                className="app-modal-button secondary"
                disabled={isRegistrationSaving}
                onClick={() => setRegistrationDraft(null)}
              >
                {t('button.cancel')}
              </button>
              <button
                type="button"
                className="app-modal-button primary"
                disabled={isRegistrationSaving}
                onClick={() => void handleSaveRegistration()}
              >
                {t('button.save')}
              </button>
            </div>
          </div>
        </div>
      )}

      {renameDraft && (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!isRenamingRef.current) setRenameDraft(null);
          }}
        >
          <div
            className="app-modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="rename-modal-title"
            aria-busy={isRenaming}
            tabIndex={-1}
            onKeyDown={(event) =>
              handleDialogKeyDown(event, event.currentTarget, () => {
                if (!isRenamingRef.current) setRenameDraft(null);
              })
            }
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="rename-modal-title" className="app-modal-title">
              {t('modal.renameTitle')}
            </h2>
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
                disabled={isRenaming}
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) =>
                  setRenameDraft((prev) =>
                    prev ? { ...prev, name: event.target.value } : prev
                  )
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleConfirmRename();
                }}
              />
              {renameDraft.extension && (
                <span className="rename-extension" aria-hidden="true">
                  {renameDraft.extension}
                </span>
              )}
            </div>
            <div className="app-modal-actions">
              <button
                type="button"
                className="app-modal-button secondary"
                disabled={isRenaming}
                onClick={() => setRenameDraft(null)}
              >
                {t('button.cancel')}
              </button>
              <button
                type="button"
                className="app-modal-button primary"
                disabled={isRenaming}
                onClick={() => void handleConfirmRename()}
              >
                {t('button.rename')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isCustomAppManagerOpen && !removeTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={() => setIsCustomAppManagerOpen(false)}
        >
          <div
            className="app-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="manage-apps-title"
            tabIndex={-1}
            autoFocus
            onKeyDown={(event) =>
              handleDialogKeyDown(event, event.currentTarget, () =>
                setIsCustomAppManagerOpen(false)
              )
            }
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="manage-apps-title" className="app-modal-title">
              {t('modal.manageAppsTitle')}
            </h2>
            <p className="app-modal-text">{t('modal.manageAppsDescription')}</p>
            <div className="registered-app-list">
              {customOpenApps.map((app) => (
                <div className="registered-app-row" key={app.id}>
                  <div className="registered-app-details">
                    <span className="registered-app-name">{app.name}</span>
                    <span className="registered-app-path" title={app.executablePath}>
                      {app.executablePath}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="registered-app-remove"
                    onClick={() => handleRequestRemoveCustomApp(app)}
                  >
                    {t('button.remove')}
                  </button>
                </div>
              ))}
            </div>
            <div className="app-modal-actions">
              <button
                type="button"
                className="app-modal-button secondary"
                onClick={() => setIsCustomAppManagerOpen(false)}
              >
                {t('button.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div
          className="modal-backdrop"
          onMouseDown={() => {
            if (!isRemovingCustomAppRef.current) setRemoveTarget(null);
          }}
        >
          <div
            className="app-modal compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="remove-app-modal-title"
            aria-describedby="remove-app-modal-description"
            aria-busy={isRemovingCustomApp}
            tabIndex={-1}
            onKeyDown={(event) =>
              handleDialogKeyDown(event, event.currentTarget, () => {
                if (!isRemovingCustomAppRef.current) setRemoveTarget(null);
              })
            }
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="remove-app-modal-title" className="app-modal-title">
              {t('modal.removeAppTitle')}
            </h2>
            <p id="remove-app-modal-description" className="app-modal-text">
              {t('modal.removeAppMessage', { name: removeTarget.name })}
            </p>
            <div className="app-modal-actions">
              <button
                type="button"
                className="app-modal-button secondary"
                autoFocus
                disabled={isRemovingCustomApp}
                onClick={() => setRemoveTarget(null)}
              >
                {t('button.cancel')}
              </button>
              <button
                type="button"
                className="app-modal-button danger"
                disabled={isRemovingCustomApp}
                onClick={() => void handleConfirmRemoveCustomApp()}
              >
                {t('button.remove')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAboutOpen && (
        <AboutModal
          currentVersion={packageInfo.version}
          t={t}
          onClose={handleCloseAbout}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          currentVersion={packageInfo.version}
          initialSettings={{
            rememberWindowPosition: settingsRef.current.rememberWindowPosition,
            loopNavigation: settingsRef.current.loopNavigation,
            defaultFitMode: settingsRef.current.defaultFitMode,
            locale: settingsRef.current.locale,
            overlayHideDelayMs: settingsRef.current.overlayHideDelayMs,
          }}
          t={t}
          onCheckForUpdates={checkForAppUpdates}
          onOpenRelease={openReleasePage}
          onOpenDefaultAppsSettings={openDefaultAppsSettings}
          onCancel={() => setIsSettingsOpen(false)}
          onSave={saveViewerSettings}
        />
      )}

      {toast && (
        <div
          className={`toast-message toast-${toast.tone}`}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.tone === 'success'
              ? '✓'
              : toast.tone === 'warning' || toast.tone === 'error'
                ? '!'
                : ''}
          </span>
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

export default App;
