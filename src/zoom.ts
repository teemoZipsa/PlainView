// Raster images can require a fitted scale well below 10% (for example long
// scrolling captures). Keep the interactive floor below realistic decoder
// limits so zoom-out never turns into an unexpected zoom-in.
export const MIN_ZOOM = 0.001;
export const MAX_ZOOM = 10;
export const ZOOM_FACTOR = 1.15;
export const ORIGINAL_ZOOM = 1;

const ORIGINAL_ZOOM_EPSILON = 1e-9;

export interface PanOffset {
  x: number;
  y: number;
}

export interface ZoomAnchor {
  x: number;
  y: number;
}

export interface ZoomTransition {
  zoom: number;
  fitMode: 'auto';
  panOffset: PanOffset;
}

export type ZoomDirection = 'in' | 'out';

export const clampZoom = (zoom: number) =>
  Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));

export const isOriginalZoom = (zoom: number) =>
  Math.abs(zoom - ORIGINAL_ZOOM) <= ORIGINAL_ZOOM_EPSILON;

export const getWheelZoomDirection = (deltaY: number): ZoomDirection | null => {
  if (deltaY < 0) return 'in';
  if (deltaY > 0) return 'out';
  return null;
};

/**
 * Convert wheel/trackpad movement into a continuous zoom target. A typical
 * mouse-wheel notch still moves by one ZOOM_FACTOR, while small pixel deltas
 * from a trackpad produce proportionally smaller changes.
 */
export const getWheelZoomTarget = (
  currentZoom: number,
  deltaY: number,
  deltaMode = 0
) => {
  if (!Number.isFinite(deltaY) || deltaY === 0) return clampZoom(currentZoom);

  const normalizedCurrent = Number.isFinite(currentZoom)
    ? clampZoom(currentZoom)
    : ORIGINAL_ZOOM;
  const pixelDelta =
    deltaMode === 1
      ? deltaY * (100 / 3)
      : deltaMode === 2
        ? deltaY * 100
        : deltaY;
  const steps = Math.max(-4, Math.min(4, pixelDelta / 100));
  const candidate = normalizedCurrent * Math.pow(ZOOM_FACTOR, -steps);
  const crossesOriginal =
    (normalizedCurrent < ORIGINAL_ZOOM && candidate > ORIGINAL_ZOOM) ||
    (normalizedCurrent > ORIGINAL_ZOOM && candidate < ORIGINAL_ZOOM);

  return clampZoom(crossesOriginal ? ORIGINAL_ZOOM : candidate);
};

export const formatZoomPercent = (zoom: number) => {
  const normalizedZoom = Number.isFinite(zoom) ? zoom : ORIGINAL_ZOOM;
  const percent = normalizedZoom * 100;
  let rounded = Math.round(percent * 100) / 100;

  // Do not label a fitted value just below/above 1:1 as exactly 100%.
  if (!isOriginalZoom(normalizedZoom) && rounded === 100) {
    rounded = normalizedZoom < ORIGINAL_ZOOM ? 99.99 : 100.01;
  }

  return rounded.toFixed(2).replace(/\.?0+$/, '');
};

/**
 * Move through the image's actual 100% scale as a stable zoom stop. Using
 * reciprocal factors keeps zoom-in followed by zoom-out reversible.
 */
export const getNextZoom = (
  currentZoom: number,
  direction: ZoomDirection
) => {
  const finiteCurrent = Number.isFinite(currentZoom)
    ? clampZoom(currentZoom)
    : ORIGINAL_ZOOM;
  const normalizedCurrent = isOriginalZoom(finiteCurrent)
    ? ORIGINAL_ZOOM
    : finiteCurrent;
  const candidate =
    direction === 'in'
      ? normalizedCurrent * ZOOM_FACTOR
      : normalizedCurrent / ZOOM_FACTOR;

  const crossesOriginal =
    (normalizedCurrent < ORIGINAL_ZOOM && candidate > ORIGINAL_ZOOM) ||
    (normalizedCurrent > ORIGINAL_ZOOM && candidate < ORIGINAL_ZOOM);

  return clampZoom(crossesOriginal ? ORIGINAL_ZOOM : candidate);
};

/**
 * Resolve an interactive zoom change while keeping the image point beneath
 * the supplied anchor stationary. Explicit 1:1 reset/recentering is handled
 * separately by the viewer command that owns that behavior.
 */
export const getZoomTransition = (
  currentZoom: number,
  targetZoom: number,
  currentPanOffset: PanOffset,
  clampPanOffset: (zoom: number, panOffset: PanOffset) => PanOffset,
  anchor: ZoomAnchor = { x: 0, y: 0 }
): ZoomTransition => {
  const clampedZoom = clampZoom(targetZoom);
  const ratio = currentZoom > 0 ? clampedZoom / currentZoom : 1;
  const scaledPanOffset = {
    x: anchor.x - (anchor.x - currentPanOffset.x) * ratio,
    y: anchor.y - (anchor.y - currentPanOffset.y) * ratio,
  };

  return {
    zoom: clampedZoom,
    fitMode: 'auto',
    panOffset: clampPanOffset(clampedZoom, scaledPanOffset),
  };
};
