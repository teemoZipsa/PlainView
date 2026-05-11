import { useEffect, useState, useCallback, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { invoke } from '@tauri-apps/api/core';
import { LogicalPosition } from '@tauri-apps/api/dpi';
import OverlayControls from './components/OverlayControls';
import ErrorView from './components/ErrorView';
import { useImageLoader } from './hooks/useImageLoader';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useOverlayVisibility } from './hooks/useOverlayVisibility';
import type { ViewerState, Rotation, Settings, DragMode } from './types';
import './App.css';

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 10;
const ZOOM_STEP = 0.15;
const SCREEN_FIT_RATIO = 0.92;
const MIN_WINDOW_SIZE = 200;

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

  const settingsRef = useRef<Settings>({
    rememberWindowPosition: true,
    alwaysOnTopDefault: false,
    loopNavigation: true,
    // Future settings — stored for forward compatibility but not yet applied in UI
    backgroundMode: 'dark',
    defaultFitMode: 'auto',
    lastWindowBounds: null,
  });

  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const dragModeRef = useRef<DragMode>('none');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Race condition prevention: monotonic request counter
  const requestIdRef = useRef(0);

  const { loadImage, preloadImages, scanFolder, loadSettings, saveSettings, getCliArgs } =
    useImageLoader();

  const overlay = useOverlayVisibility();

  // ---- Utility functions ----

  const getViewportSize = useCallback(() => {
    return {
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }, []);

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
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (target.closest('.overlay-btn') || target.closest('.overlay-container')) {
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
    [getDragMode, state.panOffset]
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
  });

  // ---- Window resize handler ----

  useEffect(() => {
    const handleResize = () => {
      setState((prev) => {
        if (prev.fitMode === 'fit') {
          const fitZoom = calculateFitZoom(
            prev.naturalSize.width,
            prev.naturalSize.height,
            prev.rotation
          );
          return { ...prev, zoom: fitZoom, panOffset: { x: 0, y: 0 } };
        }
        return prev;
      });

      scheduleSaveWindowBounds();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [calculateFitZoom, scheduleSaveWindowBounds]);

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
  }, [scheduleSaveWindowBounds]);

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
        src={state.imageSrc}
        alt={state.fileName}
        className="viewer-image"
        style={{
          transform,
          transformOrigin: 'center center',
        }}
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
    >
      <div className="image-container">{renderImage()}</div>

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
    </div>
  );
}

export default App;
