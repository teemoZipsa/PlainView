import { useCallback, useState } from 'react';

export type OverlayRegion = 'none' | 'left' | 'right' | 'bottom' | 'top-right';

const NAV_EDGE_WIDTH = 72;
const TOP_RIGHT_HEIGHT = 132;
const TOP_RIGHT_WIDTH = 224;
const BOTTOM_HEIGHT = 112;
const BOTTOM_MAX_WIDTH = 520;

export function getOverlayRegion(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number
): OverlayRegion {
  if (
    !Number.isFinite(clientX) ||
    !Number.isFinite(clientY) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0
  ) {
    return 'none';
  }

  const topRightWidth = Math.min(TOP_RIGHT_WIDTH, viewportWidth);
  if (
    clientX >= viewportWidth - topRightWidth &&
    clientY <= Math.min(TOP_RIGHT_HEIGHT, viewportHeight)
  ) {
    return 'top-right';
  }

  const bottomWidth = Math.min(BOTTOM_MAX_WIDTH, viewportWidth);
  const bottomLeft = (viewportWidth - bottomWidth) / 2;
  if (
    clientY >= viewportHeight - Math.min(BOTTOM_HEIGHT, viewportHeight) &&
    clientX >= bottomLeft &&
    clientX <= bottomLeft + bottomWidth
  ) {
    return 'bottom';
  }

  if (clientX <= Math.min(NAV_EDGE_WIDTH, viewportWidth / 2)) {
    return 'left';
  }

  if (clientX >= viewportWidth - Math.min(NAV_EDGE_WIDTH, viewportWidth / 2)) {
    return 'right';
  }

  return 'none';
}

export function useOverlayVisibility() {
  const [activeRegion, setActiveRegion] = useState<OverlayRegion>('none');

  const handleMouseMove = useCallback(
    (clientX: number, clientY: number, viewportWidth: number, viewportHeight: number) => {
      setActiveRegion(getOverlayRegion(clientX, clientY, viewportWidth, viewportHeight));
    },
    []
  );

  const handleMouseLeave = useCallback(() => {
    setActiveRegion('none');
  }, []);

  return {
    activeRegion,
    handleMouseMove,
    handleMouseLeave,
  };
}
