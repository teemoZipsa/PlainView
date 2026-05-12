import { useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import { Image as TauriImage } from '@tauri-apps/api/image';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeImage } from '@tauri-apps/plugin-clipboard-manager';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import ContextMenu from './components/ContextMenu';
import OverlayControls from './components/OverlayControls';
import ErrorView from './components/ErrorView';
import { useImageLoader } from './hooks/useImageLoader';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useOverlayVisibility } from './hooks/useOverlayVisibility';
import type { ViewerState, Rotation, Settings, DragMode, FitMode, CustomOpenApp } from './types';
import './App.css';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.15;
const SCREEN_FIT_RATIO = 0.92;
const MIN_WINDOW_SIZE = 200;
const CONTEXT_MENU_WIDTH = 240;
const CONTEXT_MENU_MIN_HEIGHT = 190;
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
  submenuDirection: 'right' | 'left';
}

interface AppRegistrationDraft {
  executablePath: string;
  defaultName: string;
  name: string;
}

const waitForNextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

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
  });
  const [viewportSize, setViewportSize] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
  const [customOpenApps, setCustomOpenApps] = useState<CustomOpenApp[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [registrationDraft, setRegistrationDraft] = useState<AppRegistrationDraft | null>(null);
  const [removeTarget, setRemoveTarget] = useState<CustomOpenApp | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

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

  // Race condition prevention: monotonic request counter
  const requestIdRef = useRef(0);

  const { loadImage, preloadImages, scanFolder, loadSettings, saveSettings, getCliArgs } =
    useImageLoader();

  const overlay = useOverlayVisibility();

  // ---- Utility functions ----

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

  const getExecutableDisplayName = useCallback((path: string) => {
    const fileName = path.split(/[\\/]/).pop() || '앱';
    return fileName.replace(/\.exe$/i, '') || '앱';
  }, []);

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
      image.onerror = () => reject(new Error('이미지를 불러올 수 없습니다.'));
      image.src = src;
    });
  }, []);

  const copyImageElementToClipboard = useCallback(async (imageElement: HTMLImageElement) => {
    const width = imageElement.naturalWidth;
    const height = imageElement.naturalHeight;

    if (!width || !height) {
      throw new Error('이미지 크기를 확인할 수 없습니다.');
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
      showToast('이미지를 클립보드에 복사했습니다.');
    } catch (error) {
      console.warn('Failed to copy image:', error);
      showToast('이미지를 복사할 수 없습니다.');
    } finally {
      isCopyingRef.current = false;
    }
  }, [canCopyImage, copyImageElementToClipboard, loadImageElement, showToast, state.imageSrc]);

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

        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          errorMessage: message || '이미지를 불러올 수 없습니다.',
        }));
      }
    },
    [loadImage, preloadImages, calculateFitZoomForSize, state.imageList, state.currentIndex]
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
    setState((prev) => {
      const newZoom = Math.min(MAX_ZOOM, prev.zoom * (1 + ZOOM_STEP));
      return { ...prev, zoom: newZoom, fitMode: 'auto' as const };
    });
  }, []);

  const zoomOut = useCallback(() => {
    setState((prev) => {
      const newZoom = Math.max(MIN_ZOOM, prev.zoom * (1 - ZOOM_STEP));
      return { ...prev, zoom: newZoom, fitMode: 'auto' as const, panOffset: { x: 0, y: 0 } };
    });
  }, []);

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

      settingsRef.current.alwaysOnTopDefault = newValue;
      saveSettings(settingsRef.current);
    } catch {
      // Ignore errors
    }
  }, [state.isAlwaysOnTop, saveSettings]);

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
      const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - CONTEXT_MENU_MIN_HEIGHT - VIEWPORT_MARGIN);
      const x = Math.max(VIEWPORT_MARGIN, Math.min(event.clientX, maxX));
      const y = Math.max(VIEWPORT_MARGIN, Math.min(event.clientY, maxY));
      const submenuDirection =
        x + CONTEXT_MENU_WIDTH + CONTEXT_SUBMENU_WIDTH + VIEWPORT_MARGIN > window.innerWidth
          ? 'left'
          : 'right';

      setContextMenu({ x, y, submenuDirection });
    },
    [closeContextMenu, state.currentFilePath, state.errorMessage, state.isLoading]
  );

  const handleRevealInExplorer = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      await revealItemInDir(state.currentFilePath);
    } catch {
      showToast('탐색기에서 파일을 표시할 수 없습니다.');
    }
  }, [closeContextMenu, showToast, state.currentFilePath]);

  const handleCopyImageFromMenu = useCallback(() => {
    closeContextMenu();
    void handleCopyImage();
  }, [closeContextMenu, handleCopyImage]);

  const handleOpenDefaultApp = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      await openPath(state.currentFilePath);
    } catch {
      showToast('기본 앱으로 열 수 없습니다.');
    }
  }, [closeContextMenu, showToast, state.currentFilePath]);

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
        showToast('앱을 실행할 수 없습니다.');
      }
    },
    [closeContextMenu, showToast, state.currentFilePath]
  );

  const handleRegisterCustomApp = useCallback(async () => {
    closeContextMenu();

    try {
      const selected = await openDialog({
        multiple: false,
        directory: false,
        title: '사용자 정의 앱 선택',
        filters: [{ name: '실행 파일', extensions: ['exe'] }],
      });

      if (typeof selected !== 'string') return;

      const defaultName = getExecutableDisplayName(selected);
      setRegistrationDraft({
        executablePath: selected,
        defaultName,
        name: defaultName,
      });
    } catch {
      showToast('앱 선택 창을 열 수 없습니다.');
    }
  }, [closeContextMenu, getExecutableDisplayName, showToast]);

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
      showToast(existingIndex >= 0 ? '등록 앱을 갱신했습니다.' : '앱을 등록했습니다.');
    } catch {
      showToast('앱 등록을 저장할 수 없습니다.');
    }
  }, [createCustomAppId, customOpenApps, registrationDraft, saveCustomOpenApps, showToast]);

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
      showToast('등록 앱을 제거했습니다.');
    } catch {
      showToast('등록 앱 제거를 저장할 수 없습니다.');
    }
  }, [customOpenApps, removeTarget, saveCustomOpenApps, showToast]);

  const handlePrintFile = useCallback(async () => {
    closeContextMenu();
    if (!state.currentFilePath) return;

    try {
      await invoke('print_file', { path: state.currentFilePath });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      showToast(message || '인쇄를 시작할 수 없습니다.');
    }
  }, [closeContextMenu, showToast, state.currentFilePath]);

  // ---- Mouse wheel zoom ----

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
    },
    [zoomIn, zoomOut]
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
      if (target.closest('.viewer-image') && e.detail > 1) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const mode = getDragMode(e.altKey);
      dragModeRef.current = mode;
      isDraggingRef.current = true;
      dragStartRef.current = { x: e.clientX, y: e.clientY };
      panStartRef.current = { ...state.panOffset };

      if (mode === 'window-move') {
        const appWindow = getCurrentWindow();
        appWindow.startDragging();
        isDraggingRef.current = false;
      }

      e.preventDefault();
    },
    [contextMenu, getDragMode, state.panOffset]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      overlay.handleMouseMove();

      if (!isDraggingRef.current || dragModeRef.current !== 'image-pan') return;

      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;

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

  const handleImageDoubleClick = useCallback(
    async (event: React.MouseEvent<HTMLImageElement>) => {
      event.preventDefault();
      event.stopPropagation();

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
        settingsRef.current = settings;
        setCustomOpenApps(settings.customOpenApps ?? []);

        // Apply always-on-top default
        if (settings.alwaysOnTopDefault) {
          await invoke('set_always_on_top', { onTop: true });
          setState((prev) => ({ ...prev, isAlwaysOnTop: true }));
        }

        // Apply saved window position/size (restored on startup)
        if (settings.rememberWindowPosition && settings.lastWindowBounds) {
          const bounds = settings.lastWindowBounds;
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
      return <ErrorView message={state.errorMessage} onClose={closeApp} />;
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
          <p className="empty-text">이미지를 드래그하여 열기</p>
        </div>
      );
    }

    const transform = `
      translate(${state.panOffset.x}px, ${state.panOffset.y}px)
      rotate(${state.rotation}deg)
      scale(${state.zoom})
    `;

    return (
      <img
        ref={viewerImageRef}
        src={state.imageSrc}
        alt={state.fileName}
        className="viewer-image"
        style={{
          transform,
          transformOrigin: 'center center',
        }}
        onDoubleClick={handleImageDoubleClick}
        draggable={false}
      />
    );
  };

  return (
    <div
      className={`app-container ${state.isAlwaysOnTop ? 'pinned' : ''}`}
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
      <div ref={viewerRef} className="image-container">{renderImage()}</div>

      {isImageOverflowing && (
        <div className="window-move-zone">
          <button
            type="button"
            className="window-move-handle"
            title="창 이동"
            aria-label="창 이동"
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
        currentIndex={state.currentIndex}
        totalImages={state.imageList.length}
        zoom={state.zoom}
        fileName={state.fileName}
        onClose={closeApp}
        onPrevImage={() => navigateImage(-1)}
        onNextImage={() => navigateImage(1)}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onOriginalSize={setOriginalSize}
        onFitScreen={fitToScreen}
        onToggleAlwaysOnTop={toggleAlwaysOnTop}
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
          customApps={customOpenApps}
          onCopyImage={handleCopyImageFromMenu}
          onReveal={handleRevealInExplorer}
          onOpenDefault={handleOpenDefaultApp}
          onOpenCustom={handleOpenCustomApp}
          onRegisterApp={handleRegisterCustomApp}
          onRequestRemoveApp={handleRequestRemoveCustomApp}
          onPrint={handlePrintFile}
        />
      )}

      {registrationDraft && (
        <div className="modal-backdrop" onMouseDown={() => setRegistrationDraft(null)}>
          <div className="app-modal" onMouseDown={(event) => event.stopPropagation()}>
            <h2 className="app-modal-title">사용자 정의 앱 등록</h2>
            <p className="app-modal-path" title={registrationDraft.executablePath}>
              {registrationDraft.executablePath}
            </p>
            <label className="app-modal-label" htmlFor="custom-app-name">
              표시 이름
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
                취소
              </button>
              <button type="button" className="app-modal-button primary" onClick={handleSaveRegistration}>
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {removeTarget && (
        <div className="modal-backdrop" onMouseDown={() => setRemoveTarget(null)}>
          <div className="app-modal compact" onMouseDown={(event) => event.stopPropagation()}>
            <h2 className="app-modal-title">등록 앱 제거</h2>
            <p className="app-modal-text">
              {removeTarget.name} 항목을 제거할까요?
            </p>
            <div className="app-modal-actions">
              <button type="button" className="app-modal-button secondary" onClick={() => setRemoveTarget(null)}>
                취소
              </button>
              <button type="button" className="app-modal-button danger" onClick={handleConfirmRemoveCustomApp}>
                제거
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
