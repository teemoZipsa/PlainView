export type SubmenuDirection = 'right' | 'left' | 'stacked';

export interface ContextMenuPlacement {
  x: number;
  y: number;
  submenuDirection: SubmenuDirection;
  submenuVerticalDirection: 'down' | 'up';
}

interface InitialPlacementOptions {
  pointerX: number;
  pointerY: number;
  viewportWidth: number;
  viewportHeight: number;
  menuWidth?: number;
  submenuWidth?: number;
  estimatedMenuHeight?: number;
  margin?: number;
}

interface ClampPlacementOptions {
  x: number;
  y: number;
  menuWidth: number;
  menuHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}

export const CONTEXT_MENU_WIDTH = 240;
export const CONTEXT_SUBMENU_WIDTH = 240;
export const CONTEXT_MENU_ESTIMATED_HEIGHT = 390;
export const CONTEXT_MENU_MARGIN = 8;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

export function getInitialContextMenuPlacement({
  pointerX,
  pointerY,
  viewportWidth,
  viewportHeight,
  menuWidth = CONTEXT_MENU_WIDTH,
  submenuWidth = CONTEXT_SUBMENU_WIDTH,
  estimatedMenuHeight = CONTEXT_MENU_ESTIMATED_HEIGHT,
  margin = CONTEXT_MENU_MARGIN,
}: InitialPlacementOptions): ContextMenuPlacement {
  const renderedMenuWidth = Math.min(menuWidth, Math.max(0, viewportWidth - margin * 2));
  const availableHeight = Math.max(0, viewportHeight - margin * 2);
  const renderedMenuHeight = Math.min(estimatedMenuHeight, availableHeight);
  const maxX = Math.max(margin, viewportWidth - renderedMenuWidth - margin);
  const maxY = Math.max(margin, viewportHeight - renderedMenuHeight - margin);
  const anchoredX = clamp(pointerX, margin, maxX);
  const anchoredY = clamp(pointerY, margin, maxY);

  const canOpenSubmenuRight =
    anchoredX + renderedMenuWidth + submenuWidth + margin <= viewportWidth;
  const canOpenSubmenuLeft = anchoredX - submenuWidth - margin >= margin;
  const needsCompactLayout = estimatedMenuHeight > availableHeight;
  const submenuDirection: SubmenuDirection = needsCompactLayout
    ? 'stacked'
    : canOpenSubmenuRight
      ? 'right'
      : canOpenSubmenuLeft
        ? 'left'
        : 'stacked';

  return {
    x: submenuDirection === 'stacked' ? margin : anchoredX,
    y: submenuDirection === 'stacked' ? margin : anchoredY,
    submenuDirection,
    submenuVerticalDirection: pointerY >= viewportHeight / 2 ? 'up' : 'down',
  };
}

export function clampContextMenuToViewport({
  x,
  y,
  menuWidth,
  menuHeight,
  viewportWidth,
  viewportHeight,
  margin = CONTEXT_MENU_MARGIN,
}: ClampPlacementOptions): { x: number; y: number } {
  const availableWidth = Math.max(0, viewportWidth - margin * 2);
  const availableHeight = Math.max(0, viewportHeight - margin * 2);
  const visibleWidth = Math.min(menuWidth, availableWidth);
  const visibleHeight = Math.min(menuHeight, availableHeight);
  const maxX = Math.max(margin, viewportWidth - visibleWidth - margin);
  const maxY = Math.max(margin, viewportHeight - visibleHeight - margin);

  return {
    x: clamp(x, margin, maxX),
    y: clamp(y, margin, maxY),
  };
}
