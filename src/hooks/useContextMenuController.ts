import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import {
  clampContextMenuToViewport,
  CONTEXT_MENU_MARGIN,
  getInitialContextMenuPlacement,
  type SubmenuDirection,
} from '../contextMenuGeometry';

export interface ContextMenuState {
  x: number;
  y: number;
  submenuDirection: SubmenuDirection;
  submenuVerticalDirection: 'down' | 'up';
}

interface ContextMenuControllerOptions {
  enabled: boolean;
  focusTargetRef: RefObject<HTMLElement | null>;
}

export function useContextMenuController({
  enabled,
  focusTargetRef,
}: ContextMenuControllerOptions) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const dismissContextMenu = useCallback(() => {
    setContextMenu(null);
    globalThis.setTimeout(() => {
      focusTargetRef.current?.focus({ preventScroll: true });
    }, 0);
  }, [focusTargetRef]);

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (!enabled) {
        closeContextMenu();
        return;
      }

      setContextMenu(
        getInitialContextMenuPlacement({
          pointerX: event.clientX,
          pointerY: event.clientY,
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
        })
      );
    },
    [closeContextMenu, enabled]
  );

  useLayoutEffect(() => {
    if (!contextMenu || !contextMenuRef.current) return;

    const menu = contextMenuRef.current;
    const reposition = () => {
      const rect = menu.getBoundingClientRect();
      const availableHeight = Math.max(
        0,
        window.innerHeight - CONTEXT_MENU_MARGIN * 2
      );
      const needsVerticalScroll = menu.scrollHeight > availableHeight;
      const { x, y } = clampContextMenuToViewport({
        x: contextMenu.x,
        y: contextMenu.y,
        menuWidth: rect.width,
        menuHeight: menu.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      });
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

  return {
    contextMenu,
    contextMenuRef,
    handleContextMenu,
    closeContextMenu,
    dismissContextMenu,
  };
}
